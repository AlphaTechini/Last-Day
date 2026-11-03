// ============================================================================
// DEV / TEST SANDBOX ONLY. This is NOT part of the product and never runs in production.
// A single stateful, in-memory HTTP server that emulates the subset of the Keycloak, Mattermost, GitHub and
// Vultr admin APIs (plus an OpenAI-compatible inference endpoint) that Last Day's connectors use, so the whole
// workflow can be developed and tested without any real accounts. Response shapes follow docs/API_REFERENCE.md.
// Run it with `pnpm mock` (port 4010, env MOCK_PORT). See README.md in this folder.
// ============================================================================
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { answer } from './similarity.ts';

type Obj = Record<string, any>;

/** Credentials the sandbox accepts. scripts/connect-mock.ts stores these (encrypted) as the connection secrets. */
export const MOCK_CREDENTIALS = {
	keycloak: { realm: 'company', clientId: 'last-day', clientSecret: 'mock-keycloak-secret' },
	mattermost: { token: 'mock-mattermost-admin-token' },
	github: { org: 'northwind-labs', token: 'mock-github-token' },
	vultr: { apiKey: 'mock-vultr-api-key' },
	inference: { apiKey: 'mock-inference-key' }
} as const;

export const MOCK_REPOS = ['northwind-labs/platform', 'northwind-labs/infra', 'northwind-labs/website'];

export interface MockOptions {
	port?: number; // 0 = random
	/** 'jitter' (default, 120-700 ms), 0 (none) or a fixed number of ms. Env MOCK_LATENCY mirrors this. */
	latency?: 'jitter' | number;
	snapshotMs?: number; // how long a snapshot stays pending (default 3000, env MOCK_SNAPSHOT_MS)
	log?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hex = (s: string) => createHash('sha1').update(s).digest('hex');
const uuid = (seed: string) => {
	const h = hex(seed);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const mmId = (seed: string) => parseInt(hex(seed).slice(0, 10), 16).toString(36).padStart(8, '0') + hex(seed).slice(10, 28).replace(/[0-9]/g, (d) => 'abcdefghij'[+d]).slice(0, 18);
const num = (seed: string) => parseInt(hex(seed).slice(0, 7), 16);
const nowIso = () => new Date().toISOString();

class HttpErr extends Error {
	constructor(
		public status: number,
		public body: unknown,
		public headers: Record<string, string> = {}
	) {
		super(`HTTP ${status}`);
	}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
function freshState() {
	return {
		seq: { invite: 1000, repoInvite: 9000, snapshot: 0, org: 0 },
		kc: {
			users: new Map<string, Obj>(),
			sessions: new Map<string, Obj[]>(),
			tokens: new Map<string, number>()
		},
		mm: { users: new Map<string, Obj>(), sessions: new Map<string, Obj[]>(), bots: new Map<string, Obj>() },
		gh: {
			profiles: new Map<string, Obj>(),
			members: new Set<string>(),
			outside: new Map<string, Set<string>>(), // login -> repos (full names)
			orgInvites: [] as Obj[],
			repoInvites: [] as Obj[]
		},
		vu: {
			users: new Map<string, Obj>(),
			keys: new Map<string, Obj[]>(),
			instances: new Map<string, Obj>(),
			snapshots: new Map<string, Obj & { completeAt: number }>(),
			suspended: new Map<string, string>(), // user id -> date
			features: { apikeys: true, suspend: true }
		},
		faults: [] as { status: number; retryAfter?: number; remaining: number }[]
	};
}

const PLANS = [
	{ id: 'vc2-1c-0.5gb', vcpu_count: 1, ram: 512, disk: 10, disk_count: 1, bandwidth: 500, monthly_cost: 2.5, type: 'vc2', locations: ['ewr', 'ams', 'fra'] },
	{ id: 'vc2-1c-1gb', vcpu_count: 1, ram: 1024, disk: 25, disk_count: 1, bandwidth: 1024, monthly_cost: 5, type: 'vc2', locations: ['ewr', 'ams', 'fra', 'sjc'] },
	{ id: 'vc2-1c-2gb', vcpu_count: 1, ram: 2048, disk: 55, disk_count: 1, bandwidth: 2048, monthly_cost: 10, type: 'vc2', locations: ['ewr', 'ams', 'fra', 'sjc'] },
	{ id: 'vc2-2c-4gb', vcpu_count: 2, ram: 4096, disk: 80, disk_count: 1, bandwidth: 3072, monthly_cost: 20, type: 'vc2', locations: ['ewr', 'ams', 'fra', 'sjc'] },
	{ id: 'vhf-1c-1gb', vcpu_count: 1, ram: 1024, disk: 32, disk_count: 1, bandwidth: 1024, monthly_cost: 6, type: 'vhf', locations: ['ewr', 'ams'] }
];

const MODELS = [
	['glm-5.3-flash', 'GLM 5.3 Flash', '0.0000001', '0.00000035', 120, 16],
	['glm-5.2', 'GLM 5.2', '0.00000075', '0.000003', 30, 8],
	['deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash', '0.00000015', '0.0000006', 120, 16]
] as const;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
export interface MockServer {
	url: string; // http://127.0.0.1:<port>
	port: number;
	close(): Promise<void>;
	reset(): void;
}

export async function startMock(opts: MockOptions = {}): Promise<MockServer> {
	let S = freshState();
	const latencyEnv = process.env.MOCK_LATENCY;
	const latency: 'jitter' | number = opts.latency ?? (latencyEnv === undefined || latencyEnv === '' ? 'jitter' : Number(latencyEnv));
	const snapshotMs = opts.snapshotMs ?? Number(process.env.MOCK_SNAPSHOT_MS ?? 3000);
	const log = opts.log ?? false;
	let origin = '';

	// ---- helpers ----------------------------------------------------------
	const readBody = async (req: IncomingMessage): Promise<Obj> => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const text = Buffer.concat(chunks).toString('utf8');
		if (!text) return {};
		if ((req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
		try {
			return JSON.parse(text);
		} catch {
			throw new HttpErr(400, { error: 'invalid JSON body' });
		}
	};

	function bearer(req: IncomingMessage): string {
		const h = String(req.headers.authorization ?? '');
		return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
	}

	// Page helpers -------------------------------------------------------------
	function cursorPage<T>(rows: T[], q: URLSearchParams, key: string) {
		const per = Math.min(500, Math.max(1, Number(q.get('per_page') ?? 100)));
		const start = Number(q.get('cursor') ?? 0) || 0;
		const slice = rows.slice(start, start + per);
		const next = start + per < rows.length ? String(start + per) : '';
		return { [key]: slice, meta: { total: rows.length, links: { next, prev: start > 0 ? String(Math.max(0, start - per)) : '' } } };
	}

	// ---- Keycloak ---------------------------------------------------------
	const KC = MOCK_CREDENTIALS.keycloak;
	function kcAuth(req: IncomingMessage) {
		const t = bearer(req);
		const exp = S.kc.tokens.get(t);
		if (!t || !exp || exp < Date.now()) throw new HttpErr(401, { error: 'HTTP 401 Unauthorized' });
	}
	function kcUser(id: string): Obj {
		const u = S.kc.users.get(id);
		if (!u) throw new HttpErr(404, { error: 'User not found' });
		return u;
	}
	function kcRep(u: Obj, brief: boolean): Obj {
		if (!brief) return u;
		const { attributes: _a, ...rest } = u;
		return rest;
	}
	function addKcSession(id: string, ip = '203.0.113.5') {
		const arr = S.kc.sessions.get(id) ?? [];
		arr.push({ id: uuid(`kcs:${id}:${arr.length}:${Date.now()}`), userId: id, username: S.kc.users.get(id)?.username, ipAddress: ip, start: Date.now() - 3_600_000, lastAccess: Date.now() - 60_000, rememberMe: false, clients: { acc: 'account-console' }, transientUser: false });
		S.kc.sessions.set(id, arr);
	}

	async function keycloak(req: IncomingMessage, method: string, path: string, q: URLSearchParams): Promise<[number, unknown, Record<string, string>?]> {
		const m = /^\/realms\/([^/]+)\/protocol\/openid-connect\/token$/.exec(path);
		if (m) {
			if (method !== 'POST') throw new HttpErr(405, {});
			const b = await readBody(req);
			let id = b.client_id;
			let secret = b.client_secret;
			const basic = /^Basic (.+)$/i.exec(String(req.headers.authorization ?? ''));
			if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':');
			if (m[1] !== KC.realm) throw new HttpErr(404, { error: 'Realm does not exist' });
			if (b.grant_type !== 'client_credentials') throw new HttpErr(400, { error: 'unsupported_grant_type' });
			if (id !== KC.clientId || secret !== KC.clientSecret) throw new HttpErr(401, { error: 'invalid_client', error_description: 'Invalid client or Invalid client credentials' });
			const ttl = Number(process.env.MOCK_KC_TOKEN_TTL ?? 300);
			const token = `kc.${hex(`${Date.now()}${Math.random()}`)}`;
			S.kc.tokens.set(token, Date.now() + ttl * 1000);
			return [200, { access_token: token, expires_in: ttl, refresh_expires_in: 0, token_type: 'Bearer', 'not-before-policy': 0, scope: 'profile email' }];
		}
		const a = /^\/admin\/realms\/([^/]+)(\/.*)$/.exec(path);
		if (!a) throw new HttpErr(404, { error: 'Not found' });
		kcAuth(req);
		if (a[1] !== KC.realm) throw new HttpErr(404, { error: 'Realm not found.' });
		const rest = a[2];
		const users = [...S.kc.users.values()].filter((u) => !String(u.username).startsWith('service-account-'));

		if (rest === '/users' && method === 'GET') {
			let rows = users;
			const search = q.get('search')?.toLowerCase();
			if (search) rows = rows.filter((u) => [u.username, u.email, u.firstName, u.lastName].some((f) => String(f ?? '').toLowerCase().includes(search)));
			for (const f of ['email', 'username', 'firstName', 'lastName'] as const) {
				const v = q.get(f)?.toLowerCase();
				if (v) rows = rows.filter((u) => (q.get('exact') === 'true' ? String(u[f] ?? '').toLowerCase() === v : String(u[f] ?? '').toLowerCase().includes(v)));
			}
			if (q.get('enabled')) rows = rows.filter((u) => String(u.enabled) === q.get('enabled'));
			const first = Number(q.get('first') ?? 0);
			const max = Number(q.get('max') ?? 100);
			return [200, rows.slice(first, first + max).map((u) => kcRep(u, q.get('briefRepresentation') === 'true'))];
		}
		if (rest === '/users/count' && method === 'GET') return [200, users.length];
		if (rest === '/users' && method === 'POST') {
			const b = await readBody(req);
			if (!b.username) throw new HttpErr(400, { errorMessage: 'User name is missing' });
			const username = String(b.username).toLowerCase();
			if ([...S.kc.users.values()].some((u) => u.username === username)) throw new HttpErr(409, { errorMessage: 'User exists with same username' });
			if (b.email && [...S.kc.users.values()].some((u) => u.email && u.email.toLowerCase() === String(b.email).toLowerCase())) throw new HttpErr(409, { errorMessage: 'User exists with same email' });
			const id = uuid(`kc:${username}`);
			S.kc.users.set(id, {
				id,
				username,
				firstName: b.firstName ?? null,
				lastName: b.lastName ?? null,
				email: b.email ?? null,
				emailVerified: !!b.emailVerified,
				enabled: b.enabled !== false,
				createdTimestamp: Date.now(),
				attributes: b.attributes ?? {},
				totp: false,
				notBefore: 0,
				requiredActions: [],
				disableableCredentialTypes: []
			});
			if (b.enabled !== false) addKcSession(id);
			return [201, '', { location: `${origin}/keycloak/admin/realms/${KC.realm}/users/${id}` }];
		}
		const um = /^\/users\/([^/]+)(\/.*)?$/.exec(rest);
		if (um) {
			const id = um[1];
			const sub = um[2] ?? '';
			if (sub === '' && method === 'GET') return [200, kcUser(id)];
			if (sub === '' && method === 'PUT') {
				const u = kcUser(id);
				const b = await readBody(req);
				for (const k of ['firstName', 'lastName', 'email', 'enabled', 'emailVerified', 'attributes']) if (k in b) u[k] = b[k];
				return [204, ''];
			}
			if (sub === '' && method === 'DELETE') {
				kcUser(id);
				S.kc.users.delete(id);
				S.kc.sessions.delete(id);
				return [204, ''];
			}
			if (sub === '/logout' && method === 'POST') {
				const u = kcUser(id);
				u.notBefore = Math.floor(Date.now() / 1000);
				S.kc.sessions.set(id, []);
				return [204, ''];
			}
			if (sub === '/sessions' && method === 'GET') {
				kcUser(id);
				return [200, S.kc.sessions.get(id) ?? []];
			}
		}
		throw new HttpErr(404, { error: 'Not found' });
	}

	// ---- Mattermost -------------------------------------------------------
	const MM_ADMIN_ID = 'a'.repeat(26);
	function mmAuth(req: IncomingMessage) {
		if (bearer(req) !== MOCK_CREDENTIALS.mattermost.token) throw new HttpErr(401, { id: 'api.context.session_expired.app_error', message: 'Invalid or expired session, please login again.', detailed_error: '', request_id: 'mock', status_code: 401 });
	}
	function mmUser(id: string): Obj {
		const u = S.mm.users.get(id);
		if (!u) throw new HttpErr(404, { id: 'app.user.missing_account.const', message: 'Unable to find the user.', detailed_error: '', request_id: 'mock', status_code: 404 });
		return u;
	}
	function addMmSession(id: string) {
		const arr = S.mm.sessions.get(id) ?? [];
		arr.push({ id: mmId(`mms:${id}:${arr.length}:${Date.now()}`), create_at: Date.now() - 7_200_000, expires_at: Date.now() + 86_400_000, last_activity_at: Date.now() - 120_000, user_id: id, device_id: '', roles: 'system_user', is_oauth: false, props: {} });
		S.mm.sessions.set(id, arr);
	}
	const mmNew = (b: Obj, extra: Obj = {}): Obj => {
		const id = mmId(`mm:${String(b.username).toLowerCase()}`);
		const created = Date.now();
		return {
			id,
			create_at: created,
			update_at: created,
			delete_at: 0,
			username: String(b.username).toLowerCase(),
			auth_service: '',
			email: String(b.email ?? '').toLowerCase(),
			nickname: b.nickname ?? '',
			first_name: b.first_name ?? '',
			last_name: b.last_name ?? '',
			position: b.position ?? '',
			roles: 'system_user',
			locale: 'en',
			is_bot: false,
			last_activity_at: created - (num(id) % 36) * 3_600_000,
			...extra
		};
	};

	async function mattermost(req: IncomingMessage, method: string, path: string, q: URLSearchParams): Promise<[number, unknown, Record<string, string>?]> {
		const m = /^\/api\/v4(\/.*)$/.exec(path);
		if (!m) throw new HttpErr(404, { message: 'Not found' });
		mmAuth(req);
		const rest = m[1];
		if (rest === '/users/me') return [200, { id: MM_ADMIN_ID, username: 'lastday-admin', email: 'lastday-admin@northwind.example', roles: 'system_admin system_user', delete_at: 0 }];
		if (rest === '/users/stats') return [200, { total_users_count: [...S.mm.users.values()].filter((u) => u.delete_at === 0).length }];
		if (rest === '/users' && method === 'GET') {
			let rows = [...S.mm.users.values()];
			if (q.get('active') === 'true') rows = rows.filter((u) => u.delete_at === 0);
			if (q.get('inactive') === 'true') rows = rows.filter((u) => u.delete_at > 0);
			const per = Math.min(200, Math.max(1, Number(q.get('per_page') ?? 60)));
			const page = Number(q.get('page') ?? 0);
			return [200, rows.slice(page * per, page * per + per)];
		}
		if (rest === '/users' && method === 'POST') {
			const b = await readBody(req);
			if (!b.username || !b.email) throw new HttpErr(400, { id: 'model.user.is_valid.username.app_error', message: 'Invalid username/email', status_code: 400 });
			if ([...S.mm.users.values()].some((u) => u.username === String(b.username).toLowerCase() || u.email === String(b.email).toLowerCase())) throw new HttpErr(400, { id: 'app.user.save.username_exists.app_error', message: 'An account with that username or email already exists.', status_code: 400 });
			const u = mmNew(b);
			S.mm.users.set(u.id, u);
			addMmSession(u.id);
			return [201, u];
		}
		if (rest === '/bots' && method === 'GET') {
			const incl = q.get('include_deleted') === 'true';
			return [200, [...S.mm.bots.values()].filter((b) => incl || b.delete_at === 0)];
		}
		if (rest === '/bots' && method === 'POST') {
			const b = await readBody(req);
			if (!b.username) throw new HttpErr(400, { message: 'username required', status_code: 400 });
			const u = mmNew({ username: b.username, email: `${b.username}@localhost`, nickname: '', first_name: '', last_name: '' }, { is_bot: true, roles: 'system_user', last_activity_at: 0 });
			S.mm.users.set(u.id, u);
			const bot = { user_id: u.id, username: u.username, display_name: b.display_name ?? '', description: b.description ?? '', owner_id: MM_ADMIN_ID, create_at: u.create_at, update_at: u.create_at, delete_at: 0 };
			S.mm.bots.set(u.id, bot);
			return [201, bot];
		}
		const bm = /^\/bots\/([^/]+)\/enable$/.exec(rest);
		if (bm && method === 'POST') {
			const u = mmUser(bm[1]);
			u.delete_at = 0;
			const bot = S.mm.bots.get(bm[1]);
			if (bot) bot.delete_at = 0;
			return [200, bot ?? {}];
		}
		const um = /^\/users\/([^/]+)(\/.*)?$/.exec(rest);
		if (um) {
			const id = um[1];
			const sub = um[2] ?? '';
			if (sub === '' && method === 'GET') return [200, mmUser(id)];
			if (sub === '' && method === 'DELETE') {
				const u = mmUser(id);
				u.delete_at = Date.now();
				u.update_at = Date.now();
				S.mm.sessions.set(id, []);
				const bot = S.mm.bots.get(id);
				if (bot) bot.delete_at = u.delete_at;
				return [200, { status: 'OK' }];
			}
			if (sub === '/active' && method === 'PUT') {
				const u = mmUser(id);
				const b = await readBody(req);
				u.delete_at = b.active ? 0 : Date.now();
				return [200, { status: 'OK' }];
			}
			if (sub === '/patch' && method === 'PUT') {
				const u = mmUser(id);
				Object.assign(u, await readBody(req));
				return [200, u];
			}
			if (sub === '/sessions/revoke/all' && method === 'POST') {
				mmUser(id);
				S.mm.sessions.set(id, []);
				return [200, { status: 'OK' }];
			}
			if (sub === '/sessions' && method === 'GET') {
				mmUser(id);
				return [200, S.mm.sessions.get(id) ?? []];
			}
		}
		throw new HttpErr(404, { id: 'api.context.404.app_error', message: "We couldn't find the page.", status_code: 404 });
	}

	// ---- GitHub -----------------------------------------------------------
	const GH_ORG = MOCK_CREDENTIALS.github.org;
	const simpleUser = (login: string): Obj => ({ login, id: num(`gh:${login}`), node_id: '', avatar_url: '', html_url: `https://github.com/${login}`, type: 'User', site_admin: false });
	function ghPage(rows: Obj[], q: URLSearchParams, pathname: string, headers: Record<string, string>): Obj[] {
		const per = Math.min(100, Math.max(1, Number(q.get('per_page') ?? 30)));
		const page = Math.max(1, Number(q.get('page') ?? 1));
		const last = Math.max(1, Math.ceil(rows.length / per));
		const link = (p: number, rel: string) => `<${origin}/github${pathname}?per_page=${per}&page=${p}>; rel="${rel}"`;
		const links: string[] = [];
		if (page < last) links.push(link(page + 1, 'next'), link(last, 'last'));
		if (page > 1) links.push(link(page - 1, 'prev'), link(1, 'first'));
		if (links.length) headers.link = links.join(', ');
		return rows.slice((page - 1) * per, page * per);
	}
	const ghInvite = (email: string | null, login: string | null, role = 'direct_member'): Obj => ({
		id: ++S.seq.invite,
		node_id: '',
		login,
		email,
		role,
		created_at: nowIso(),
		failed_at: null,
		failed_reason: null,
		inviter: simpleUser('lastday-admin'),
		team_count: 0,
		invitation_teams_url: '',
		invitation_source: 'member'
	});

	async function github(req: IncomingMessage, method: string, path: string, q: URLSearchParams): Promise<[number, unknown, Record<string, string>?]> {
		if (bearer(req) !== MOCK_CREDENTIALS.github.token) throw new HttpErr(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' });
		const headers: Record<string, string> = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' };
		const notFound = () => new HttpErr(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' });
		const um = /^\/users\/([^/]+)$/.exec(path);
		if (um && method === 'GET') {
			const p = S.gh.profiles.get(um[1].toLowerCase());
			if (!p) throw notFound();
			return [200, p, headers];
		}
		let m = /^\/orgs\/([^/]+)(\/.*)?$/.exec(path);
		if (m) {
			if (m[1].toLowerCase() !== GH_ORG) throw notFound();
			const rest = m[2] ?? '';
			if (rest === '' && method === 'GET') return [200, { login: GH_ORG, id: num('org'), name: 'Northwind Labs', plan: { name: 'free' }, members_can_create_repositories: false }, headers];
			if (rest === '/members' && method === 'GET') return [200, ghPage([...S.gh.members].sort().map(simpleUser), q, path, headers), headers];
			if (rest === '/outside_collaborators' && method === 'GET') return [200, ghPage([...S.gh.outside.keys()].sort().map(simpleUser), q, path, headers), headers];
			if (rest === '/invitations' && method === 'GET') return [200, ghPage(S.gh.orgInvites, q, path, headers), headers];
			if (rest === '/invitations' && method === 'POST') {
				const b = await readBody(req);
				if (!b.email && !b.invitee_id) throw new HttpErr(422, { message: 'Validation Failed', status: '422' });
				const email = b.email ? String(b.email).toLowerCase() : null;
				if (email && S.gh.orgInvites.some((i) => i.email === email)) throw new HttpErr(422, { message: 'Validation Failed: Invitation already exists', status: '422' });
				const inv = ghInvite(email, null, b.role ?? 'direct_member');
				S.gh.orgInvites.push(inv);
				return [201, inv, headers];
			}
			const iv = /^\/invitations\/(\d+)$/.exec(rest);
			if (iv && method === 'DELETE') {
				const i = S.gh.orgInvites.findIndex((x) => String(x.id) === iv[1]);
				if (i < 0) throw notFound();
				S.gh.orgInvites.splice(i, 1);
				return [204, '', headers];
			}
			const mem = /^\/(?:memberships|members)\/([^/]+)$/.exec(rest);
			if (mem) {
				const login = mem[1].toLowerCase();
				if (method === 'GET') {
					if (!S.gh.members.has(login)) throw notFound();
					return [200, { state: 'active', role: 'member', user: simpleUser(login), organization: { login: GH_ORG } }, headers];
				}
				if (method === 'PUT') {
					// The real API sends an invitation to an existing GitHub user. The sandbox adds them straight away.
					if (!S.gh.profiles.has(login)) throw notFound();
					S.gh.members.add(login);
					return [200, { state: 'active', role: 'member', user: simpleUser(login), organization: { login: GH_ORG } }, headers];
				}
				if (method === 'DELETE') {
					const had = S.gh.members.delete(login);
					const before = S.gh.orgInvites.length;
					S.gh.orgInvites = S.gh.orgInvites.filter((i) => i.login !== login);
					if (!had && before === S.gh.orgInvites.length) throw notFound();
					return [204, '', headers];
				}
			}
			const oc = /^\/outside_collaborators\/([^/]+)$/.exec(rest);
			if (oc && method === 'DELETE') {
				const login = oc[1].toLowerCase();
				if (S.gh.members.has(login)) throw new HttpErr(422, { message: 'User is an organization member, not an outside collaborator', status: '422' });
				if (!S.gh.outside.delete(login)) throw notFound();
				return [204, '', headers];
			}
			if (rest === '/repos' && method === 'GET') return [200, MOCK_REPOS.map((full_name) => ({ id: num(full_name), name: full_name.split('/')[1], full_name, private: true, owner: { login: GH_ORG }, archived: false })), headers];
		}
		m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
		if (m) {
			const full = `${m[1]}/${m[2]}`.toLowerCase();
			if (!MOCK_REPOS.includes(full)) throw notFound();
			const rest = m[3] ?? '';
			if (rest === '/invitations' && method === 'GET') return [200, ghPage(S.gh.repoInvites.filter((i) => i.repository.full_name === full), q, path, headers), headers];
			const iv = /^\/invitations\/(\d+)$/.exec(rest);
			if (iv && method === 'DELETE') {
				const i = S.gh.repoInvites.findIndex((x) => String(x.id) === iv[1] && x.repository.full_name === full);
				if (i < 0) throw notFound();
				S.gh.repoInvites.splice(i, 1);
				return [204, '', headers];
			}
			const col = /^\/collaborators\/([^/]+)$/.exec(rest);
			if (col && method === 'PUT') {
				const login = col[1].toLowerCase();
				if (!S.gh.profiles.has(login)) throw notFound();
				if (S.gh.members.has(login) || S.gh.outside.get(login)?.has(full)) return [204, '', headers];
				if (S.gh.repoInvites.some((i) => i.invitee.login === login && i.repository.full_name === full)) return [204, '', headers];
				const b = await readBody(req);
				const inv = { id: ++S.seq.repoInvite, node_id: '', invitee: simpleUser(login), inviter: simpleUser('lastday-admin'), permissions: b.permission === 'push' || !b.permission ? 'write' : b.permission, created_at: nowIso(), expired: false, repository: { full_name: full }, url: '', html_url: '' };
				S.gh.repoInvites.push(inv);
				return [201, inv, headers];
			}
		}
		throw notFound();
	}

	// ---- Vultr ------------------------------------------------------------
	const VU_ORG = uuid('vultr-org');
	function vuAuth(req: IncomingMessage) {
		if (bearer(req) !== MOCK_CREDENTIALS.vultr.apiKey) throw new HttpErr(401, { error: 'Invalid API token', status: 401 });
	}
	function vuUser(id: string): Obj {
		const u = S.vu.users.get(id);
		if (!u) throw new HttpErr(404, { error: 'Invalid user.', status: 404 });
		return u;
	}
	function vuInstance(id: string): Obj {
		const i = S.vu.instances.get(id);
		if (!i) throw new HttpErr(404, { error: 'Invalid instance ID.', status: 404 });
		return i;
	}
	const publicUser = (u: Obj) => {
		const { password: _p, api_key: _k, ...rest } = u;
		return rest;
	};
	const snapPublic = (s: Obj) => {
		const { completeAt, ...rest } = s;
		const done = Date.now() >= completeAt;
		return { ...rest, status: s.status === 'deleted' ? 'deleted' : done ? 'complete' : 'pending', compressed_size: done ? s.compressed_final : 0 };
	};

	async function vultr(req: IncomingMessage, method: string, path: string, q: URLSearchParams): Promise<[number, unknown, Record<string, string>?]> {
		const m = /^\/v2(\/.*)$/.exec(path);
		if (!m) throw new HttpErr(404, { error: 'Not found' });
		vuAuth(req);
		const rest = m[1];
		if (rest === '/account') return [200, { account: { name: 'Northwind Labs', email: 'billing@northwind.example', acls: ['manage_users', 'subscriptions', 'billing', 'provisioning'], balance: -200, pending_charges: 1.23, last_payment_date: '', last_payment_amount: 0 } }];
		if (rest === '/plans') return [200, cursorPage(PLANS, q, 'plans')];
		if (rest === '/regions') return [200, cursorPage(['ewr', 'ams', 'fra', 'sjc'].map((id) => ({ id, city: id, country: 'XX', continent: 'X', options: [] })), q, 'regions')];
		if (rest === '/os') return [200, cursorPage([{ id: 2284, name: 'Ubuntu 24.04 LTS x64', arch: 'x64', family: 'ubuntu' }], q, 'os')];
		if (rest === '/organizations' && method === 'GET') return [200, cursorPage([{ id: VU_ORG, name: 'Northwind Labs', type: 'Business', date_created: '2026-01-05T10:00:00+00:00' }], q, 'orgs')];

		const org = /^\/organizations\/([^/]+)(\/.*)?$/.exec(rest);
		if (org) {
			if (!S.vu.features.suspend) throw new HttpErr(403, { error: 'Forbidden', message: 'Not allowed to use IAM endpoints' });
			if (org[1] !== VU_ORG) throw new HttpErr(404, { error: 'Invalid organization.' });
			const sub = org[2] ?? '';
			if (sub === '/suspended-users' && method === 'GET') {
				const rows = [...S.vu.suspended].map(([id, date]) => ({ user_id: id, name: S.vu.users.get(id)?.name ?? '', email: S.vu.users.get(id)?.email ?? '', date_suspended: date }));
				return [200, cursorPage(rows, q, 'users')];
			}
			const sm = /^\/user\/([^/]+)\/(suspend|unsuspend)$/.exec(sub);
			if (sm && method === 'PUT') {
				vuUser(sm[1]);
				if (sm[2] === 'suspend') S.vu.suspended.set(sm[1], nowIso());
				else S.vu.suspended.delete(sm[1]);
				return [204, ''];
			}
			throw new HttpErr(404, { error: 'Not found' });
		}

		if (rest === '/users' && method === 'GET') return [200, cursorPage([...S.vu.users.values()].map(publicUser), q, 'users')];
		if (rest === '/users' && method === 'POST') {
			const b = await readBody(req);
			if (!b.email || !b.name) throw new HttpErr(400, { error: 'email and name are required', status: 400 });
			if ([...S.vu.users.values()].some((u) => u.email.toLowerCase() === String(b.email).toLowerCase())) throw new HttpErr(400, { error: 'A user with that email already exists.', status: 400 });
			const id = uuid(`vu:${String(b.email).toLowerCase()}`);
			const u: Obj = { id, name: b.name, email: b.email, api_enabled: b.api_enabled !== false, acls: b.acls ?? [], service_user: !!b.service_user };
			S.vu.users.set(id, u);
			S.vu.keys.set(id, []);
			const out = publicUser(u);
			if (u.api_enabled) out.api_key = `MOCKKEY${hex(`k:${id}`).slice(0, 28).toUpperCase()}`;
			return [201, { user: out }];
		}
		const um = /^\/users\/([^/]+)(\/.*)?$/.exec(rest);
		if (um) {
			const id = um[1];
			const sub = um[2] ?? '';
			if (sub === '' && method === 'GET') return [200, { user: publicUser(vuUser(id)) }];
			if (sub === '' && method === 'PATCH') {
				const u = vuUser(id);
				const b = await readBody(req);
				for (const k of ['email', 'name', 'api_enabled', 'acls']) if (k in b) u[k] = b[k];
				return [204, ''];
			}
			if (sub === '' && method === 'DELETE') {
				vuUser(id);
				S.vu.users.delete(id);
				S.vu.keys.delete(id);
				S.vu.suspended.delete(id);
				return [204, ''];
			}
			if (sub.startsWith('/apikeys')) {
				if (!S.vu.features.apikeys) throw new HttpErr(404, { error: 'Not found' });
				vuUser(id);
				const keys = S.vu.keys.get(id) ?? [];
				const km = /^\/apikeys(?:\/([^/]+))?$/.exec(sub);
				if (!km) throw new HttpErr(404, { error: 'Not found' });
				if (!km[1] && method === 'GET') return [200, cursorPage(keys, q, 'api_keys')];
				if (!km[1] && method === 'POST') {
					const b = await readBody(req);
					const key = { id: uuid(`vk:${id}:${b.name}`), name: b.name ?? 'key', api_key: `MOCKKEY${hex(`kk:${id}:${b.name}`).slice(0, 28).toUpperCase()}`, expire: !!b.expire, date_expire: b.date_expire ?? null, date_created: nowIso() };
					keys.push(key);
					S.vu.keys.set(id, keys);
					return [202, { api_key: key }];
				}
				if (km[1] && method === 'GET') {
					const k = keys.find((x) => x.id === km[1]);
					if (!k) throw new HttpErr(404, { error: 'Invalid API key.' });
					return [200, { api_key: k }];
				}
				if (km[1] && method === 'DELETE') {
					const i = keys.findIndex((x) => x.id === km[1]);
					if (i < 0) throw new HttpErr(404, { error: 'Invalid API key.' });
					keys.splice(i, 1);
					return [204, ''];
				}
			}
		}

		if (rest === '/instances' && method === 'GET') {
			let rows = [...S.vu.instances.values()];
			if (q.get('label')) rows = rows.filter((i) => i.label === q.get('label'));
			if (q.get('tag')) rows = rows.filter((i) => i.tags.includes(q.get('tag')));
			return [200, cursorPage(rows, q, 'instances')];
		}
		if (rest === '/instances' && method === 'POST') {
			const b = await readBody(req);
			const plan = PLANS.find((p) => p.id === b.plan);
			if (!plan || !b.region || !b.os_id) throw new HttpErr(400, { error: 'Invalid plan, region or os_id.', status: 400 });
			const id = uuid(`vi:${b.label}:${Date.now()}`);
			const i: Obj = {
				id,
				label: b.label ?? '',
				hostname: b.hostname ?? b.label ?? '',
				tags: b.tags ?? [],
				plan: plan.id,
				region: b.region,
				main_ip: `203.0.113.${(num(id) % 200) + 20}`,
				os: 'Ubuntu 24.04 LTS x64',
				date_created: nowIso(),
				status: 'active',
				power_status: 'running',
				server_status: 'ok',
				vcpu_count: plan.vcpu_count,
				ram: plan.ram,
				disk: plan.disk,
				allowed_bandwidth: plan.bandwidth,
				features: []
			};
			S.vu.instances.set(id, i);
			return [202, { instance: i }];
		}
		const im = /^\/instances\/([^/]+)(\/.*)?$/.exec(rest);
		if (im) {
			const id = im[1];
			const sub = im[2] ?? '';
			if (sub === '' && method === 'GET') return [200, { instance: vuInstance(id) }];
			if (sub === '' && method === 'DELETE') {
				vuInstance(id);
				S.vu.instances.delete(id);
				return [204, ''];
			}
			if (sub === '/halt' && method === 'POST') {
				vuInstance(id).power_status = 'stopped';
				return [204, ''];
			}
			if (sub === '/start' && method === 'POST') {
				vuInstance(id).power_status = 'running';
				return [204, ''];
			}
		}
		if (rest === '/snapshots' && method === 'GET') return [200, cursorPage([...S.vu.snapshots.values()].map(snapPublic), q, 'snapshots')];
		if (rest === '/snapshots' && method === 'POST') {
			const b = await readBody(req);
			const inst = vuInstance(String(b.instance_id));
			const id = uuid(`vs:${++S.seq.snapshot}:${inst.id}`);
			const size = inst.disk * 1_073_741_824;
			S.vu.snapshots.set(id, { id, date_created: nowIso(), description: b.description ?? '', size, compressed_size: 0, compressed_final: Math.round(size * 0.13), status: 'pending', os_id: 2284, app_id: 0, completeAt: Date.now() + snapshotMs });
			return [201, { snapshot: snapPublic(S.vu.snapshots.get(id)!) }];
		}
		const sm = /^\/snapshots\/([^/]+)$/.exec(rest);
		if (sm) {
			const s = S.vu.snapshots.get(sm[1]);
			if (!s) throw new HttpErr(404, { error: 'Invalid snapshot ID.', status: 404 });
			if (method === 'GET') return [200, { snapshot: snapPublic(s) }];
			if (method === 'DELETE') {
				S.vu.snapshots.delete(sm[1]);
				return [204, ''];
			}
		}
		throw new HttpErr(404, { error: 'Not found', status: 404 });
	}

	// ---- Inference --------------------------------------------------------
	function modelDoc(m: (typeof MODELS)[number]) {
		return {
			id: m[0],
			name: m[1],
			created: 1788837087,
			context_length: 1_048_576,
			architecture: { input_modalities: ['text'], output_modalities: ['text'] },
			pricing: { prompt: m[2], completion: m[3] },
			top_provider: { context_length: 1_048_576, max_completion_tokens: 1_048_576 },
			supported_parameters: ['temperature', 'max_completion_tokens', 'seed', 'response_format', 'structured_outputs', 'reasoning', 'reasoning_effort'],
			rate_limits: { text: { requests_per_minute: m[4], concurrent_requests: m[5] } }
		};
	}
	async function inference(req: IncomingMessage, method: string, path: string): Promise<[number, unknown, Record<string, string>?]> {
		if (path === '/v1/models' && method === 'GET') return [200, { data: MODELS.map(modelDoc), total_count: MODELS.length, links: { next: null } }];
		if (bearer(req) !== MOCK_CREDENTIALS.inference.apiKey && String(req.headers['x-api-key'] ?? '') !== MOCK_CREDENTIALS.inference.apiKey) {
			throw new HttpErr(401, { error: { code: 401, message: 'Invalid API key', type: 'auth_error', metadata: { error_type: 'authentication' } } });
		}
		if (path === '/v1/chat/completions' && method === 'POST') {
			const b = await readBody(req);
			const msgs: Obj[] = Array.isArray(b.messages) ? b.messages : [];
			if (!msgs.length) throw new HttpErr(400, { error: { code: 400, message: 'messages is required', type: 'invalid_request_error', metadata: { error_type: 'bad_request' } } });
			// Like the real gateway: an unknown model id silently falls back to the default and says so in `model`.
			const model = MODELS.some((m) => m[0] === b.model) ? String(b.model) : 'deepseek-v4.1-flash-1017';
			const userText = msgs
				.filter((x) => x.role === 'user')
				.map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content)))
				.join('\n');
			const result = answer(userText, model);
			const content = JSON.stringify(result);
			const promptTokens = Math.ceil(msgs.map((x) => JSON.stringify(x.content ?? '')).join('').length / 4) + 24;
			const reasoning = 60 + (num(userText) % 140);
			const completion = Math.ceil(content.length / 3.6) + reasoning;
			return [
				200,
				{
					id: `chatcmpl-${hex(userText + model).slice(0, 20)}`,
					object: 'chat.completion',
					created: Math.floor(Date.now() / 1000),
					model,
					choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, reasoning: 'Compared names, handles and addresses.' } }],
					usage: { prompt_tokens: promptTokens, completion_tokens: completion, total_tokens: promptTokens + completion, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: reasoning } }
				}
			];
		}
		throw new HttpErr(404, { error: { code: 404, message: 'Not found', type: 'not_found' } });
	}

	// ---- Admin ------------------------------------------------------------
	async function admin(req: IncomingMessage, method: string, path: string): Promise<[number, unknown]> {
		if (path === '/__admin/ping') return [200, { ok: true, sandbox: true }];
		if (path === '/__admin/state') {
			return [
				200,
				{
					keycloak: { users: S.kc.users.size },
					mattermost: { users: S.mm.users.size, bots: S.mm.bots.size },
					github: { members: S.gh.members.size, outside: S.gh.outside.size, orgInvites: S.gh.orgInvites.length, repoInvites: S.gh.repoInvites.length },
					vultr: { users: S.vu.users.size, instances: S.vu.instances.size, snapshots: S.vu.snapshots.size, suspended: S.vu.suspended.size, features: S.vu.features }
				}
			];
		}
		if (method !== 'POST') throw new HttpErr(405, { error: 'POST only' });
		const b = await readBody(req);
		if (path === '/__admin/reset') {
			S = freshState();
			return [200, { ok: true }];
		}
		if (path === '/__admin/expire-tokens') {
			S.kc.tokens.clear();
			return [200, { ok: true }];
		}
		if (path === '/__admin/fail') {
			// Make the next `count` API requests answer with `status` (optionally with Retry-After seconds). For retry tests.
			S.faults.push({ status: Number(b.status ?? 500), retryAfter: b.retryAfter, remaining: Number(b.count ?? 1) });
			return [200, { ok: true }];
		}
		if (path === '/__admin/vultr/features') {
			Object.assign(S.vu.features, b);
			return [200, S.vu.features];
		}
		if (path === '/__admin/github/seed') {
			// Sandbox only: GitHub accounts cannot be created through any API, so the sandbox registers them directly.
			for (const p of (b.profiles ?? []) as Obj[]) {
				const login = String(p.login).toLowerCase();
				S.gh.profiles.set(login, { login: p.login, id: num(`gh:${login}`), name: p.name ?? null, company: null, blog: '', location: null, email: p.email ?? null, bio: null, created_at: p.created_at ?? '2018-01-01T00:00:00Z', updated_at: nowIso(), public_repos: 3, followers: 1, following: 1, type: 'User' });
			}
			for (const l of (b.members ?? []) as string[]) S.gh.members.add(l.toLowerCase());
			for (const o of (b.outside ?? []) as Obj[]) {
				const set = S.gh.outside.get(String(o.login).toLowerCase()) ?? new Set<string>();
				for (const r of o.repos ?? []) set.add(String(r).toLowerCase());
				S.gh.outside.set(String(o.login).toLowerCase(), set);
			}
			return [200, { ok: true }];
		}
		if (path === '/__admin/tamper') {
			// Undo a revocation so the re-check regresses. Body: { system, username?|login?|label?|email? }. Default: Dana's Keycloak user.
			const system = String(b.system ?? 'keycloak');
			const who = String(b.username ?? b.login ?? b.label ?? 'dana.okafor').toLowerCase();
			if (system === 'keycloak') {
				const u = [...S.kc.users.values()].find((x) => x.username === who);
				if (!u) throw new HttpErr(404, { error: `no keycloak user ${who}` });
				u.enabled = true;
				addKcSession(u.id, '198.51.100.23');
				return [200, { ok: true, system, re_enabled: u.username, id: u.id }];
			}
			if (system === 'mattermost') {
				const u = [...S.mm.users.values()].find((x) => x.username === (b.username ?? 'dok'));
				if (!u) throw new HttpErr(404, { error: 'no such mattermost user' });
				u.delete_at = 0;
				addMmSession(u.id);
				return [200, { ok: true, system, reactivated: u.username, id: u.id }];
			}
			if (system === 'github') {
				const login = String(b.login ?? 'dok-dev').toLowerCase();
				if (!S.gh.profiles.has(login)) throw new HttpErr(404, { error: 'no such github user' });
				const set = S.gh.outside.get(login) ?? new Set<string>();
				set.add('northwind-labs/platform');
				S.gh.outside.set(login, set);
				return [200, { ok: true, system, readded_outside_collaborator: login }];
			}
			if (system === 'vultr') {
				if (b.label || b.what === 'instance') {
					const i = [...S.vu.instances.values()].find((x) => x.label === (b.label ?? 'build-runner-02'));
					if (!i) throw new HttpErr(404, { error: 'no such instance' });
					i.power_status = 'running';
					return [200, { ok: true, system, powered_on: i.label }];
				}
				const u = [...S.vu.users.values()].find((x) => x.name === (b.username ?? 'dana-ci'));
				if (!u) throw new HttpErr(404, { error: 'no such vultr user' });
				S.vu.suspended.delete(u.id);
				u.api_enabled = true;
				if (!(S.vu.keys.get(u.id) ?? []).length) S.vu.keys.set(u.id, [{ id: uuid(`vk:${u.id}:tamper`), name: 'dana-ci-restored', api_key: 'MOCKKEYRESTORED', expire: false, date_expire: null, date_created: nowIso() }]);
				return [200, { ok: true, system, unsuspended: u.name }];
			}
			throw new HttpErr(400, { error: 'unknown system' });
		}
		throw new HttpErr(404, { error: 'Not found' });
	}

	// ---- Dispatch ---------------------------------------------------------
	async function handle(req: IncomingMessage, res: ServerResponse) {
		const started = Date.now();
		const url = new URL(req.url ?? '/', 'http://x');
		const method = (req.method ?? 'GET').toUpperCase();
		let status = 500;
		try {
			const send = (s: number, body: unknown, headers: Record<string, string> = {}) => {
				status = s;
				const text = body === '' || body === undefined ? '' : JSON.stringify(body);
				res.writeHead(s, { ...(text ? { 'content-type': 'application/json' } : {}), ...headers });
				res.end(s === 204 ? undefined : text);
			};
			try {
				if (url.pathname.startsWith('/__admin/')) {
					const [s, body] = await admin(req, method, url.pathname);
					return send(s, body);
				}
				if (latency === 'jitter') await sleep(120 + Math.floor(Math.random() * 580));
				else if (latency > 0) await sleep(latency);

				const fault = S.faults[0];
				if (fault) {
					if (--fault.remaining <= 0) S.faults.shift();
					throw new HttpErr(fault.status, { message: 'injected fault' }, fault.retryAfter !== undefined ? { 'retry-after': String(fault.retryAfter) } : {});
				}
				const pick = /^\/(keycloak|mattermost|github|vultr|inference)(\/.*)?$/.exec(url.pathname);
				if (!pick) throw new HttpErr(404, { error: 'Unknown prefix. Use /keycloak, /mattermost, /github, /vultr/v2 or /inference/v1.' });
				const sub = pick[2] ?? '/';
				const handler = { keycloak, mattermost, github, vultr, inference }[pick[1] as 'keycloak'];
				const [s, body, headers] = await (handler as typeof keycloak)(req, method, sub, url.searchParams);
				return send(s, body, headers ?? {});
			} catch (e) {
				if (e instanceof HttpErr) return send(e.status, e.body, e.headers);
				throw e;
			}
		} catch (e) {
			if (!res.headersSent) {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: `mock server error: ${(e as Error).message}` }));
			}
			status = 500;
		} finally {
			if (log) console.log(`[mock] ${method} ${url.pathname} -> ${status} (${Date.now() - started} ms)`);
		}
	}

	const server: Server = createServer((req, res) => void handle(req, res));
	await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
	const port = (server.address() as AddressInfo).port;
	origin = `http://127.0.0.1:${port}`;
	return {
		url: origin,
		port,
		reset: () => {
			S = freshState();
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			})
	};
}

// CLI: `pnpm mock`
const invoked = /mock-company[\\/]server\.ts$/.test(process.argv[1] ?? '');
if (invoked) {
	const port = Number(process.env.MOCK_PORT ?? 4010);
	const s = await startMock({ port, log: true });
	console.log(`[mock] Northwind sandbox listening on ${s.url}  (DEV/TEST ONLY)`);
	console.log('[mock] prefixes: /keycloak /mattermost /github /vultr/v2 /inference/v1   admin: POST /__admin/reset | /__admin/tamper');
	const stop = () => void s.close().then(() => process.exit(0));
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
