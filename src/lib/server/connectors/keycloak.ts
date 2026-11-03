// Keycloak connector (Admin REST API, Keycloak 26.x). See docs/API_REFERENCE.md section 1.
import { HttpClient, failed, success, toIso, uniqueEmails, type ConnectorOptions, type HttpResponse } from './http.ts';
import type { ActionKind, ActionResult, ApiCallRecord, Connector, ConnectionConfig, HealthResult, NormalizedAccount, VerifyResult } from './types.ts';

const PAGE = 100;
const EMAIL_ATTRIBUTES = ['personalEmail', 'personal_email', 'aliases', 'alias', 'aliasEmail', 'secondaryEmail', 'otherEmails', 'emails'];

type KcUser = Record<string, any>;

export function createKeycloakConnector(config: ConnectionConfig, options: ConnectorOptions = {}): Connector {
	const baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
	const realm = config.realm ?? '';
	const clientId = config.clientId ?? '';
	const clientSecret = config.clientSecret ?? '';
	const http = new HttpClient(baseUrl, {}, options);
	const enc = encodeURIComponent;

	let cached: { value: string; expiresAt: number } | null = null;

	async function token(calls: ApiCallRecord[], force = false): Promise<{ token: string } | { res: HttpResponse }> {
		if (!force && cached && cached.expiresAt - 30_000 > Date.now()) return { token: cached.value };
		const res = await http.request(calls, {
			method: 'POST',
			path: `/realms/${enc(realm)}/protocol/openid-connect/token`,
			form: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }
		});
		const t = res.data?.access_token;
		if (!res.ok || typeof t !== 'string') {
			cached = null;
			return { res: res.ok ? { ...res, ok: false, error: 'Token response had no access_token' } : res };
		}
		cached = { value: t, expiresAt: Date.now() + (Number(res.data.expires_in) || 60) * 1000 };
		return { token: t };
	}

	/** Authenticated admin call. Refreshes the token once on 401. */
	async function kc(calls: ApiCallRecord[], method: string, path: string, o: { query?: Record<string, string | number | boolean>; json?: unknown } = {}): Promise<HttpResponse> {
		for (let pass = 0; pass < 2; pass++) {
			const t = await token(calls, pass === 1);
			if ('res' in t) return t.res;
			const res = await http.request(calls, { method, path: `/admin/realms/${enc(realm)}${path}`, query: o.query, json: o.json, headers: { authorization: `Bearer ${t.token}` } });
			if (res.status !== 401 || pass === 1) return res;
		}
		throw new Error('unreachable');
	}

	function toAccount(u: KcUser): NormalizedAccount {
		const attrs = (u.attributes ?? {}) as Record<string, unknown>;
		const username = String(u.username ?? '');
		const service = username.startsWith('service-account-');
		const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
		return {
			system: 'keycloak',
			externalId: String(u.id),
			kind: service ? 'service' : 'user',
			username: username || null,
			displayName: name || null,
			emails: uniqueEmails([u.email, ...EMAIL_ATTRIBUTES.map((k) => attrs[k])]),
			active: u.enabled !== false,
			createdAt: toIso(u.createdTimestamp),
			lastActiveAt: null, // Keycloak keeps no last-login field
			raw: u
		};
	}

	async function sessions(calls: ApiCallRecord[], id: string): Promise<{ res: HttpResponse; count: number }> {
		const res = await kc(calls, 'GET', `/users/${enc(id)}/sessions`);
		return { res, count: Array.isArray(res.data) ? res.data.length : 0 };
	}

	return {
		system: 'keycloak',

		async test(): Promise<HealthResult> {
			const calls: ApiCallRecord[] = [];
			if (!baseUrl || !realm || !clientId || !clientSecret) return { ok: false, message: 'Keycloak base URL, realm, client ID and client secret are required', calls };
			const res = await kc(calls, 'GET', '/users/count');
			if (res.ok) return { ok: true, message: `Connected to realm ${realm}: ${Number(res.data)} users`, calls };
			if (res.status === 403) return { ok: false, message: `Token works but the service account lacks view-users (${res.error})`, calls };
			return { ok: false, message: `Keycloak check failed: ${res.error}`, calls };
		},

		async listAccounts(): Promise<NormalizedAccount[]> {
			const calls: ApiCallRecord[] = [];
			const out: NormalizedAccount[] = [];
			const ownService = `service-account-${clientId}`.toLowerCase();
			for (let first = 0; ; first += PAGE) {
				const res = await kc(calls, 'GET', '/users', { query: { first, max: PAGE, briefRepresentation: false } });
				if (!res.ok) throw new Error(`Keycloak list users failed: ${res.error}`);
				const page = Array.isArray(res.data) ? (res.data as KcUser[]) : [];
				for (const u of page) {
					if (String(u.username ?? '').toLowerCase() === ownService) continue; // Last Day's own identity
					out.push(toAccount(u));
				}
				if (page.length < PAGE) break;
			}
			return out;
		},

		async getAccount(account) {
			const calls: ApiCallRecord[] = [];
			const res = await kc(calls, 'GET', `/users/${enc(account.externalId)}`);
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`Keycloak get user failed: ${res.error}`);
			return toAccount(res.data);
		},

		async revoke(account, action): Promise<ActionResult> {
			const calls: ApiCallRecord[] = [];
			const id = enc(account.externalId);
			if (action === 'keycloak.disable') {
				let res = await kc(calls, 'PUT', `/users/${id}`, { json: { enabled: false } });
				if (res.status === 400) {
					// Declarative user profile validation: retry with the full representation.
					const cur = await kc(calls, 'GET', `/users/${id}`);
					if (cur.ok) res = await kc(calls, 'PUT', `/users/${id}`, { json: { ...cur.data, enabled: false } });
				}
				if (res.status === 404) return success(calls, { alreadyGone: true });
				return res.ok ? success(calls) : failed(res, calls, 'Disable user');
			}
			if (action === 'keycloak.logout') {
				const res = await kc(calls, 'POST', `/users/${id}/logout`);
				if (res.status === 404) return success(calls, { alreadyGone: true });
				return res.ok ? success(calls) : failed(res, calls, 'End sessions');
			}
			return { ok: false, calls, error: `Keycloak connector cannot perform ${action}`, retryable: false };
		},

		async verify(account, action): Promise<VerifyResult> {
			const calls: ApiCallRecord[] = [];
			const id = enc(account.externalId);
			const user = await kc(calls, 'GET', `/users/${id}`);
			if (user.status === 404) return { confirmed: true, observed: 'user no longer exists (404)', calls };
			if (!user.ok) return { confirmed: false, observed: `read-back failed: ${user.error}`, calls };
			const enabled = user.data.enabled !== false;
			if (action === 'keycloak.disable') return { confirmed: !enabled, observed: `enabled: ${enabled}`, calls };
			if (action === 'keycloak.logout') {
				const s = await sessions(calls, account.externalId);
				if (!s.res.ok) return { confirmed: false, observed: `sessions read-back failed: ${s.res.error}`, calls };
				return { confirmed: s.count === 0, observed: `enabled: ${enabled}, sessions: ${s.count}`, calls };
			}
			return { confirmed: false, observed: `unsupported action ${action}`, calls };
		},

		actionsFor(): ActionKind[] {
			return ['keycloak.disable', 'keycloak.logout'];
		}
	};
}
