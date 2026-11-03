// Vultr connector: account users, user API keys, instances and snapshots. See docs/API_REFERENCE.md section 4.
import { HttpClient, failed, success, toIso, uniqueEmails, type ConnectorOptions, type HttpResponse } from './http.ts';
import type { ActionKind, ActionResult, ApiCallRecord, Connector, ConnectionConfig, HealthResult, NormalizedAccount, VerifyResult } from './types.ts';

const PER_PAGE = 100;
type V = Record<string, any>;

export const SNAPSHOT_USD_PER_GB_MONTH = 0.05;

/** Snapshot storage estimate: $0.05 per GB per month on the compressed size. Pass bytes (default) or GB. */
export function snapshotMonthlyCost(size: number, unit: 'bytes' | 'gb' = 'bytes'): number {
	if (!Number.isFinite(size) || size <= 0) return 0;
	const gb = unit === 'gb' ? size : size / 1e9;
	return Math.round(gb * SNAPSHOT_USD_PER_GB_MONTH * 10000) / 10000;
}

export function createVultrConnector(config: ConnectionConfig, options: ConnectorOptions = {}): Connector {
	let apiUrl = (config.apiUrl || 'https://api.vultr.com/v2').replace(/\/+$/, '');
	if (!/\/v2$/.test(apiUrl)) apiUrl += '/v2';
	const http = new HttpClient(apiUrl, { authorization: `Bearer ${config.apiKey ?? ''}` }, options);
	const enc = encodeURIComponent;

	let orgId: string | null | undefined; // undefined = not looked up yet, null = none available
	let planCosts: Map<string, number> | null = null;

	/** Cursor pagination: follows meta.links.next. `key` is the array property (first array in the body as a fallback). */
	async function listAll(calls: ApiCallRecord[], path: string, keys: string[], query: Record<string, string | number> = {}): Promise<{ rows: V[]; res: HttpResponse }> {
		const rows: V[] = [];
		let cursor = '';
		let res: HttpResponse;
		for (let guard = 0; guard < 200; guard++) {
			res = await http.request(calls, { path, query: { per_page: PER_PAGE, ...query, ...(cursor ? { cursor } : {}) } });
			if (!res.ok) return { rows, res };
			const body = (res.data ?? {}) as V;
			const arr = keys.map((k) => body[k]).find(Array.isArray) ?? Object.values(body).find(Array.isArray) ?? [];
			rows.push(...(arr as V[]));
			cursor = String(body.meta?.links?.next ?? '');
			if (!cursor) break;
		}
		return { rows, res: res! };
	}

	async function getOrgId(calls: ApiCallRecord[]): Promise<string | null> {
		if (orgId !== undefined) return orgId;
		const r = await listAll(calls, '/organizations', ['orgs', 'organizations']);
		orgId = r.res.ok && r.rows.length ? String(r.rows[0].id) : null;
		if (!r.res.ok) orgId = undefined; // do not cache failures
		return orgId ?? null;
	}

	async function suspendedUsers(calls: ApiCallRecord[]): Promise<{ ids: Set<string>; emails: Set<string>; available: boolean }> {
		const org = await getOrgId(calls);
		if (!org) return { ids: new Set(), emails: new Set(), available: false };
		const r = await listAll(calls, `/organizations/${enc(org)}/suspended-users`, ['users', 'suspended_users']);
		if (!r.res.ok) return { ids: new Set(), emails: new Set(), available: false };
		return { ids: new Set(r.rows.map((u) => String(u.user_id ?? u.id))), emails: new Set(r.rows.map((u) => String(u.email ?? '').toLowerCase()).filter(Boolean)), available: true };
	}

	async function getPlanCosts(calls: ApiCallRecord[]): Promise<Map<string, number>> {
		if (planCosts) return planCosts;
		const r = await listAll(calls, '/plans', ['plans'], { type: 'all', per_page: 500 });
		const m = new Map<string, number>();
		for (const p of r.rows) m.set(String(p.id), Number(p.monthly_cost) || 0);
		if (r.res.ok) planCosts = m;
		return m;
	}

	function userAccount(u: V, suspended: { ids: Set<string>; emails: Set<string>; available: boolean }): NormalizedAccount {
		const isSuspended = suspended.ids.has(String(u.id)) || (!!u.email && suspended.emails.has(String(u.email).toLowerCase()));
		return {
			system: 'vultr',
			externalId: String(u.id),
			kind: u.service_user ? 'service' : 'user',
			username: u.name ? String(u.name) : null,
			displayName: u.name ? String(u.name) : null,
			emails: uniqueEmails([u.email]),
			active: !isSuspended && u.api_enabled !== false,
			createdAt: toIso(u.date_created),
			lastActiveAt: null, // Vultr exposes neither
			raw: { ...u, api_key: undefined, suspended: isSuspended }
		};
	}

	function keyAccount(k: V, userId: string): NormalizedAccount {
		return {
			system: 'vultr',
			externalId: String(k.id ?? k.apikey_id ?? k.key_id),
			kind: 'apikey',
			username: null,
			displayName: k.name ? String(k.name) : null,
			emails: [],
			active: true,
			createdAt: toIso(k.date_created ?? k.created_at ?? k.date),
			lastActiveAt: null,
			parentExternalId: userId,
			raw: { ...k, api_key: undefined, user_id: userId }
		};
	}

	async function instanceAccount(calls: ApiCallRecord[], i: V): Promise<NormalizedAccount> {
		const costs = await getPlanCosts(calls);
		const tags: string[] = Array.isArray(i.tags) ? i.tags.map(String) : i.tag ? [String(i.tag)] : [];
		const ownerTag = tags.find((t) => /^owner:/i.test(t));
		return {
			system: 'vultr',
			externalId: String(i.id),
			kind: 'instance',
			username: ownerTag ? ownerTag.slice(ownerTag.indexOf(':') + 1) : null,
			displayName: i.label ? String(i.label) : i.hostname ? String(i.hostname) : null,
			emails: [],
			active: i.power_status === 'running',
			createdAt: toIso(i.date_created),
			lastActiveAt: null,
			raw: {
				...i,
				plan: i.plan,
				monthly_cost: costs.get(String(i.plan)) ?? 0,
				region: i.region,
				power_status: i.power_status,
				label: i.label,
				tags,
				hostname: i.hostname,
				main_ip: i.main_ip
			}
		};
	}

	/** Keys for one user. `supported:false` when the endpoint does not exist (404/405). */
	async function userKeys(calls: ApiCallRecord[], userId: string): Promise<{ keys: V[]; supported: boolean; res: HttpResponse }> {
		const r = await listAll(calls, `/users/${enc(userId)}/apikeys`, ['api_keys', 'apikeys', 'keys']);
		if (r.res.status === 404 || r.res.status === 405) return { keys: [], supported: false, res: r.res };
		return { keys: r.rows, supported: r.res.ok, res: r.res };
	}

	async function disableApi(calls: ApiCallRecord[], userId: string): Promise<HttpResponse> {
		return http.request(calls, { method: 'PATCH', path: `/users/${enc(userId)}`, json: { api_enabled: false } });
	}

	async function getInstance(calls: ApiCallRecord[], id: string): Promise<HttpResponse> {
		return http.request(calls, { path: `/instances/${enc(id)}` });
	}

	return {
		system: 'vultr',

		async test(): Promise<HealthResult> {
			const calls: ApiCallRecord[] = [];
			if (!config.apiKey) return { ok: false, message: 'Vultr API key is required', calls };
			const res = await http.request(calls, { path: '/account' });
			if (res.status === 401 || res.status === 403) return { ok: false, message: `Vultr rejected the API key (${res.status}). Check the key and its IP allowlist.`, calls };
			if (!res.ok) return { ok: false, message: `Vultr check failed: ${res.error}`, calls };
			const users = await http.request(calls, { path: '/users', query: { per_page: 1 } });
			const org = await getOrgId(calls);
			const total = users.ok ? Number(users.data?.meta?.total) : NaN;
			const name = res.data?.account?.name ?? res.data?.account?.email ?? 'account';
			return { ok: true, message: `Connected to Vultr ${name}${Number.isFinite(total) ? `: ${total} users` : ''}${org ? `, organization ${org.slice(0, 8)}` : ', no organization (suspend falls back to disabling API access)'}`, calls };
		},

		async listAccounts(): Promise<NormalizedAccount[]> {
			const calls: ApiCallRecord[] = [];
			const out: NormalizedAccount[] = [];
			const users = await listAll(calls, '/users', ['users']);
			if (!users.res.ok) throw new Error(`Vultr list users failed: ${users.res.error}`);
			const suspended = await suspendedUsers(calls);
			for (const u of users.rows) {
				out.push(userAccount(u, suspended));
				if (u.api_enabled === false) continue;
				const k = await userKeys(calls, String(u.id));
				for (const key of k.keys) out.push(keyAccount(key, String(u.id)));
			}
			const inst = await listAll(calls, '/instances', ['instances'], { per_page: 500 });
			if (!inst.res.ok) throw new Error(`Vultr list instances failed: ${inst.res.error}`);
			for (const i of inst.rows) out.push(await instanceAccount(calls, i));
			return out;
		},

		async getAccount(account) {
			const calls: ApiCallRecord[] = [];
			if (account.kind === 'instance') {
				const res = await getInstance(calls, account.externalId);
				if (res.status === 404) return null;
				if (!res.ok) throw new Error(`Vultr get instance failed: ${res.error}`);
				return instanceAccount(calls, res.data.instance ?? res.data);
			}
			if (account.kind === 'apikey') {
				if (!account.parentExternalId) return null;
				const k = await userKeys(calls, account.parentExternalId);
				const hit = k.keys.find((x) => String(x.id) === account.externalId);
				return hit ? keyAccount(hit, account.parentExternalId) : null;
			}
			const res = await http.request(calls, { path: `/users/${enc(account.externalId)}` });
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`Vultr get user failed: ${res.error}`);
			return userAccount(res.data.user ?? res.data, await suspendedUsers(calls));
		},

		async revoke(account, action, ctx): Promise<ActionResult> {
			const calls: ApiCallRecord[] = [];
			const id = enc(account.externalId);
			switch (action) {
				case 'vultr.suspend_user': {
					const org = await getOrgId(calls);
					let reason = 'no organization is available';
					if (org) {
						const res = await http.request(calls, { method: 'PUT', path: `/organizations/${enc(org)}/user/${id}/suspend` });
						if (res.ok) return success(calls, { method: 'suspend', organizationId: org });
						if (res.status === 401 || res.status >= 500 || res.status === 429 || res.status === 0) return failed(res, calls, 'Suspend user');
						reason = `suspend returned ${res.status}`;
					}
					const fb = await disableApi(calls, account.externalId);
					if (fb.status === 404) return success(calls, { alreadyGone: true });
					if (!fb.ok) return failed(fb, calls, `Suspend unavailable (${reason}); disabling API access also failed`);
					return success(calls, { method: 'api_disabled', note: `Suspend unavailable (${reason}); disabled API access instead (api_enabled: false)` });
				}
				case 'vultr.delete_api_key': {
					const user = enc(account.parentExternalId ?? '');
					if (!account.parentExternalId) return { ok: false, calls, error: 'API key without an owning user', retryable: false };
					const res = await http.request(calls, { method: 'DELETE', path: `/users/${user}/apikeys/${id}` });
					if (res.ok) return success(calls);
					if (res.status === 404 || res.status === 405) {
						const k = await userKeys(calls, account.parentExternalId);
						if (k.supported && !k.keys.some((x) => String(x.id) === account.externalId)) return success(calls, { alreadyGone: true });
						const fb = await disableApi(calls, account.parentExternalId);
						if (!fb.ok) return failed(fb, calls, 'Delete API key (endpoint unavailable, fallback failed)');
						return success(calls, { method: 'api_disabled', note: 'Key deletion unavailable; disabled all API access for the owning user (api_enabled: false)' });
					}
					return failed(res, calls, 'Delete API key');
				}
				case 'vultr.halt_instance': {
					const res = await http.request(calls, { method: 'POST', path: `/instances/${id}/halt` });
					if (res.status === 404) return { ok: false, calls, error: 'Halt server: instance not found', retryable: false };
					return res.ok ? success(calls) : failed(res, calls, 'Halt server');
				}
				case 'vultr.snapshot_instance': {
					const label = String(account.raw?.label ?? account.raw?.hostname ?? account.externalId);
					const res = await http.request(calls, { method: 'POST', path: '/snapshots', json: { instance_id: account.externalId, description: `Last Day offboarding: ${label}` } });
					if (!res.ok) return failed(res, calls, 'Take snapshot');
					const snap = (res.data?.snapshot ?? res.data) as V;
					if (!snap?.id) return { ok: false, calls, error: 'Take snapshot: response had no snapshot id', retryable: false };
					return success(calls, { snapshotId: String(snap.id), status: snap.status ?? 'pending' });
				}
				case 'vultr.destroy_instance': {
					const res = await http.request(calls, { method: 'DELETE', path: `/instances/${id}` });
					if (res.status === 404) return success(calls, { alreadyGone: true });
					return res.ok ? success(calls) : failed(res, calls, 'Destroy server');
				}
				default:
					return { ok: false, calls, error: `Vultr connector cannot perform ${action}`, retryable: false };
			}
		},

		async verify(account, action, ctx): Promise<VerifyResult> {
			const calls: ApiCallRecord[] = [];
			switch (action) {
				case 'vultr.suspend_user': {
					const s = await suspendedUsers(calls);
					if (s.available && s.ids.has(account.externalId)) return { confirmed: true, observed: 'suspended (listed in organization suspended-users)', calls };
					const res = await http.request(calls, { path: `/users/${enc(account.externalId)}` });
					if (res.status === 404) return { confirmed: true, observed: 'user no longer exists (404)', calls };
					if (res.ok) {
						const u = (res.data?.user ?? res.data) as V;
						if (s.available && s.emails.has(String(u.email ?? '').toLowerCase())) return { confirmed: true, observed: 'suspended (listed in suspended-users, matched by email)', calls };
						if (u.api_enabled === false) return { confirmed: true, observed: `suspend was not possible${s.available ? '' : ' (no organization)'}; API access disabled instead (api_enabled: false)`, calls };
					}
					return { confirmed: false, observed: s.available ? 'not in suspended-users and api_enabled is still true' : 'suspended-users unavailable and api_enabled is still true', calls };
				}
				case 'vultr.delete_api_key': {
					const user = account.parentExternalId ?? '';
					const k = await userKeys(calls, user);
					if (k.supported) {
						const there = k.keys.some((x) => String(x.id) === account.externalId);
						return { confirmed: !there, observed: there ? 'API key still listed' : `key deleted (${k.keys.length} ${k.keys.length === 1 ? 'key remains' : 'keys remain'})`, calls };
					}
					const res = await http.request(calls, { path: `/users/${enc(user)}` });
					if (res.status === 404) return { confirmed: true, observed: 'owning user no longer exists (404)', calls };
					const u = (res.data?.user ?? res.data) as V;
					return res.ok && u?.api_enabled === false
						? { confirmed: true, observed: 'key list unavailable; owning user has api_enabled: false', calls }
						: { confirmed: false, observed: `key list unavailable (${k.res.error ?? k.res.status}) and API access still enabled`, calls };
				}
				case 'vultr.halt_instance': {
					for (let attempt = 0; ; attempt++) {
						const res = await getInstance(calls, account.externalId);
						if (res.status === 404) return { confirmed: true, observed: 'instance no longer exists (404)', calls };
						if (!res.ok) return { confirmed: false, observed: `read-back failed: ${res.error}`, calls };
						const i = (res.data?.instance ?? res.data) as V;
						if (i.power_status === 'stopped') return { confirmed: true, observed: 'stopped', calls };
						if (attempt >= 4) return { confirmed: false, observed: `power_status: ${i.power_status}`, calls };
						await http.pause();
					}
				}
				case 'vultr.snapshot_instance': {
					const sid = ctx?.snapshotId;
					if (!sid) return { confirmed: false, observed: 'no snapshot id recorded for this server', calls };
					const res = await http.request(calls, { path: `/snapshots/${enc(sid)}` });
					if (res.status === 404) return { confirmed: false, observed: 'snapshot not found', calls };
					if (!res.ok) return { confirmed: false, observed: `read-back failed: ${res.error}`, calls };
					const s = (res.data?.snapshot ?? res.data) as V;
					const status = String(s.status ?? 'unknown');
					if (status === 'pending') return { confirmed: false, pending: true, observed: 'snapshot status: pending', calls };
					const compressed = Number(s.compressed_size) || 0;
					const size = Number(s.size) || 0;
					if (status !== 'complete') return { confirmed: false, observed: `snapshot status: ${status}`, calls };
					const cost = snapshotMonthlyCost(compressed || size);
					return {
						confirmed: true,
						observed: `snapshot complete (${((compressed || size) / 1e9).toFixed(2)} GB, about $${cost.toFixed(2)}/month)`,
						calls,
						output: { snapshotId: sid, sizeBytes: size, compressedSizeBytes: compressed, snapshotSizeGb: Math.round(((compressed || size) / 1e9) * 1000) / 1000, snapshotMonthlyCostUsd: cost }
					};
				}
				case 'vultr.destroy_instance': {
					for (let attempt = 0; ; attempt++) {
						const res = await getInstance(calls, account.externalId);
						if (res.status === 404) return { confirmed: true, observed: 'destroyed (instance returns 404)', calls };
						if (!res.ok) return { confirmed: false, observed: `read-back failed: ${res.error}`, calls };
						if (attempt >= 4) return { confirmed: false, observed: 'instance still exists', calls };
						await http.pause();
					}
				}
				default:
					return { confirmed: false, observed: `unsupported action ${action}`, calls };
			}
		},

		actionsFor(account): ActionKind[] {
			if (account.kind === 'apikey') return ['vultr.delete_api_key'];
			if (account.kind === 'instance') return ['vultr.halt_instance', 'vultr.snapshot_instance'];
			return ['vultr.suspend_user'];
		}
	};
}
