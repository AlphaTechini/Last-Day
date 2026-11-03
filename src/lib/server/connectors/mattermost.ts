// Mattermost connector (API v4, Team Edition). See docs/API_REFERENCE.md section 2.
import { HttpClient, failed, success, toIso, uniqueEmails, type ConnectorOptions, type HttpResponse } from './http.ts';
import type { ActionKind, ActionResult, ApiCallRecord, Connector, ConnectionConfig, HealthResult, NormalizedAccount, VerifyResult } from './types.ts';

const PER_PAGE = 200; // server maximum
type MmUser = Record<string, any>;

export function createMattermostConnector(config: ConnectionConfig, options: ConnectorOptions = {}): Connector {
	const baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
	const http = new HttpClient(`${baseUrl}/api/v4`, { authorization: `Bearer ${config.token ?? ''}` }, options);
	const enc = encodeURIComponent;

	function toAccount(u: MmUser, bot?: { owner_id?: string; display_name?: string; description?: string }): NormalizedAccount {
		const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
		const raw: Record<string, unknown> = { ...u };
		delete raw.password;
		if (bot) Object.assign(raw, { owner_id: bot.owner_id, bot_display_name: bot.display_name, bot_description: bot.description });
		return {
			system: 'mattermost',
			externalId: String(u.id),
			kind: u.is_bot ? 'service' : 'user',
			username: u.username ? String(u.username) : null,
			displayName: full || (u.nickname ? String(u.nickname) : bot?.display_name || null),
			emails: uniqueEmails([u.email]),
			active: !(Number(u.delete_at) > 0),
			createdAt: toIso(u.create_at),
			lastActiveAt: toIso(u.last_activity_at),
			raw
		};
	}

	async function listPaged(calls: ApiCallRecord[], filter: 'active' | 'inactive'): Promise<MmUser[]> {
		const out: MmUser[] = [];
		for (let page = 0; ; page++) {
			const res = await http.request(calls, { path: '/users', query: { page, per_page: PER_PAGE, [filter]: true } });
			if (!res.ok) throw new Error(`Mattermost list users failed: ${res.error}`);
			const rows = Array.isArray(res.data) ? (res.data as MmUser[]) : [];
			out.push(...rows);
			if (rows.length < PER_PAGE) break;
		}
		return out;
	}

	async function sessionCount(calls: ApiCallRecord[], id: string): Promise<{ res: HttpResponse; count: number }> {
		const res = await http.request(calls, { path: `/users/${enc(id)}/sessions` });
		return { res, count: Array.isArray(res.data) ? res.data.length : 0 };
	}

	return {
		system: 'mattermost',

		async test(): Promise<HealthResult> {
			const calls: ApiCallRecord[] = [];
			if (!baseUrl || !config.token) return { ok: false, message: 'Mattermost base URL and admin token are required', calls };
			const me = await http.request(calls, { path: '/users/me' });
			if (!me.ok) return { ok: false, message: me.status === 401 ? 'Mattermost rejected the token (401)' : `Mattermost check failed: ${me.error}`, calls };
			const roles = String(me.data?.roles ?? '');
			if (!roles.includes('system_admin')) return { ok: false, message: `Token belongs to ${me.data?.username} who is not a system admin (roles: ${roles})`, calls };
			const stats = await http.request(calls, { path: '/users/stats' });
			const total = stats.ok ? Number(stats.data?.total_users_count) : NaN;
			return { ok: true, message: `Connected as ${me.data?.username}${Number.isFinite(total) ? `: ${total} users` : ''}`, calls };
		},

		async listAccounts(): Promise<NormalizedAccount[]> {
			const calls: ApiCallRecord[] = [];
			// Ask for active and inactive explicitly so deactivated users are never silently missing.
			const [active, inactive] = [await listPaged(calls, 'active'), await listPaged(calls, 'inactive')];
			const owners = new Map<string, { owner_id?: string; display_name?: string; description?: string }>();
			const bots = await http.request(calls, { path: '/bots', query: { per_page: PER_PAGE, include_deleted: true } });
			if (bots.ok && Array.isArray(bots.data)) for (const b of bots.data) if (b.user_id) owners.set(String(b.user_id), { owner_id: b.owner_id, display_name: b.display_name, description: b.description });
			const seen = new Set<string>();
			const out: NormalizedAccount[] = [];
			for (const u of [...active, ...inactive]) {
				if (seen.has(u.id)) continue;
				seen.add(u.id);
				out.push(toAccount(u, owners.get(u.id)));
			}
			return out;
		},

		async getAccount(account) {
			const calls: ApiCallRecord[] = [];
			const res = await http.request(calls, { path: `/users/${enc(account.externalId)}` });
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`Mattermost get user failed: ${res.error}`);
			return toAccount(res.data);
		},

		async revoke(account, action): Promise<ActionResult> {
			const calls: ApiCallRecord[] = [];
			const id = enc(account.externalId);
			if (action === 'mattermost.revoke_sessions') {
				const res = await http.request(calls, { method: 'POST', path: `/users/${id}/sessions/revoke/all` });
				if (res.status === 404) return success(calls, { alreadyGone: true });
				return res.ok ? success(calls) : failed(res, calls, 'Revoke sessions');
			}
			if (action === 'mattermost.deactivate') {
				// DELETE without permanent=true archives the user (delete_at set) and revokes sessions.
				const res = await http.request(calls, { method: 'DELETE', path: `/users/${id}` });
				if (res.status === 404) return success(calls, { alreadyGone: true });
				return res.ok ? success(calls) : failed(res, calls, 'Deactivate user');
			}
			return { ok: false, calls, error: `Mattermost connector cannot perform ${action}`, retryable: false };
		},

		async verify(account, action): Promise<VerifyResult> {
			const calls: ApiCallRecord[] = [];
			const user = await http.request(calls, { path: `/users/${enc(account.externalId)}` });
			if (user.status === 404) return { confirmed: true, observed: 'user no longer exists (404)', calls };
			if (!user.ok) return { confirmed: false, observed: `read-back failed: ${user.error}`, calls };
			const deleteAt = Number(user.data.delete_at) || 0;
			if (action === 'mattermost.deactivate') return { confirmed: deleteAt > 0, observed: `delete_at: ${deleteAt}${deleteAt > 0 ? ' (deactivated)' : ''}`, calls };
			if (action === 'mattermost.revoke_sessions') {
				const s = await sessionCount(calls, account.externalId);
				if (!s.res.ok) return { confirmed: false, observed: `sessions read-back failed: ${s.res.error}`, calls };
				return { confirmed: s.count === 0, observed: `delete_at: ${deleteAt}, sessions: ${s.count}`, calls };
			}
			return { confirmed: false, observed: `unsupported action ${action}`, calls };
		},

		actionsFor(): ActionKind[] {
			return ['mattermost.revoke_sessions', 'mattermost.deactivate'];
		}
	};
}
