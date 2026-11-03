// GitHub connector (REST, API version 2022-11-28). See docs/API_REFERENCE.md section 3.
import { HttpClient, failed, success, toIso, uniqueEmails, type ConnectorOptions, type HttpResponse } from './http.ts';
import type { ActionKind, ActionResult, ApiCallRecord, Connector, ConnectionConfig, HealthResult, NormalizedAccount, VerifyResult } from './types.ts';

const PER_PAGE = 100;
type Gh = Record<string, any>;

export function createGithubConnector(config: ConnectionConfig, options: ConnectorOptions = {}): Connector {
	const apiUrl = (config.apiUrl || 'https://api.github.com').replace(/\/+$/, '');
	const org = config.org ?? '';
	const repos = (config.repos ?? '')
		.split(/[,\s]+/)
		.map((r) => r.trim())
		.filter((r) => r.includes('/'));
	const http = new HttpClient(
		apiUrl,
		{
			authorization: `Bearer ${config.token ?? ''}`,
			accept: 'application/vnd.github+json',
			'x-github-api-version': '2022-11-28',
			'user-agent': 'last-day'
		},
		options
	);
	const enc = encodeURIComponent;
	const profiles = new Map<string, Gh | null>(); // /users/{login} cache for the lifetime of this connector

	/** Follow Link rel="next" by page number, always staying on our own base URL (the token never leaves it). */
	async function listAll(calls: ApiCallRecord[], path: string, query: Record<string, string | number | boolean> = {}): Promise<{ rows: Gh[]; res: HttpResponse }> {
		const rows: Gh[] = [];
		let page = 1;
		let res: HttpResponse;
		for (;;) {
			res = await http.request(calls, { path, query: { ...query, per_page: PER_PAGE, page } });
			if (!res.ok) return { rows, res };
			rows.push(...(Array.isArray(res.data) ? res.data : []));
			const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers?.get('link') ?? '');
			if (!next) return { rows, res };
			const nextPage = Number(new URL(next[1]).searchParams.get('page'));
			if (!Number.isFinite(nextPage) || nextPage <= page) return { rows, res };
			page = nextPage;
		}
	}

	async function profile(calls: ApiCallRecord[], login: string): Promise<Gh | null> {
		if (profiles.has(login)) return profiles.get(login)!;
		const res = await http.request(calls, { path: `/users/${enc(login)}` });
		const p = res.ok ? (res.data as Gh) : null;
		profiles.set(login, p);
		return p;
	}

	async function userAccount(calls: ApiCallRecord[], u: Gh, role: 'member' | 'outside_collaborator'): Promise<NormalizedAccount> {
		const p = await profile(calls, String(u.login));
		return {
			system: 'github',
			externalId: String(u.login),
			kind: 'user',
			username: String(u.login),
			displayName: p?.name ? String(p.name) : null,
			emails: uniqueEmails([p?.email]),
			active: true,
			createdAt: toIso(p?.created_at),
			lastActiveAt: null, // a GitHub profile exposes no activity timestamp
			raw: { ...u, role, profile: p ? { name: p.name, company: p.company, bio: p.bio, location: p.location, email: p.email, created_at: p.created_at, type: p.type } : null }
		};
	}

	function orgInvitation(i: Gh): NormalizedAccount {
		return {
			system: 'github',
			externalId: String(i.id),
			kind: 'invitation',
			username: i.login ? String(i.login) : null,
			displayName: i.email ? String(i.email) : i.login ? String(i.login) : null,
			emails: uniqueEmails([i.email]),
			active: true,
			createdAt: toIso(i.created_at),
			lastActiveAt: null,
			raw: { ...i, scope: 'organization' }
		};
	}

	function repoInvitation(i: Gh, repo: string): NormalizedAccount {
		const login = i.invitee?.login ? String(i.invitee.login) : null;
		return {
			system: 'github',
			externalId: String(i.id),
			kind: 'invitation',
			username: login,
			displayName: login,
			emails: uniqueEmails([i.invitee?.email]),
			active: !i.expired,
			createdAt: toIso(i.created_at),
			lastActiveAt: null,
			parentExternalId: repo,
			raw: { ...i, scope: 'repository', repository_full_name: repo }
		};
	}

	async function listMembers(calls: ApiCallRecord[]) {
		const r = await listAll(calls, `/orgs/${enc(org)}/members`);
		if (!r.res.ok) throw new Error(`GitHub list members failed: ${r.res.error}`);
		return r.rows;
	}
	async function listOutside(calls: ApiCallRecord[]) {
		const r = await listAll(calls, `/orgs/${enc(org)}/outside_collaborators`);
		if (!r.res.ok) throw new Error(`GitHub list outside collaborators failed: ${r.res.error}`);
		return r.rows;
	}
	async function listOrgInvites(calls: ApiCallRecord[]) {
		const r = await listAll(calls, `/orgs/${enc(org)}/invitations`);
		if (!r.res.ok) throw new Error(`GitHub list invitations failed: ${r.res.error}`);
		return r.rows;
	}
	async function listRepoInvites(calls: ApiCallRecord[], repo: string) {
		const r = await listAll(calls, `/repos/${repo}/invitations`);
		if (!r.res.ok) throw new Error(`GitHub list invitations of ${repo} failed: ${r.res.error}`);
		return r.rows;
	}

	function isOutside(a: { raw?: Record<string, unknown> }): boolean {
		return a.raw?.role === 'outside_collaborator';
	}

	const present = {
		async member(calls: ApiCallRecord[], login: string) {
			return (await listMembers(calls)).some((m) => String(m.login).toLowerCase() === login.toLowerCase());
		},
		async outside(calls: ApiCallRecord[], login: string) {
			return (await listOutside(calls)).some((m) => String(m.login).toLowerCase() === login.toLowerCase());
		},
		async orgInvite(calls: ApiCallRecord[], id: string) {
			return (await listOrgInvites(calls)).some((i) => String(i.id) === id);
		},
		async repoInvite(calls: ApiCallRecord[], repo: string, id: string) {
			return (await listRepoInvites(calls, repo)).some((i) => String(i.id) === id);
		}
	};

	return {
		system: 'github',

		async test(): Promise<HealthResult> {
			const calls: ApiCallRecord[] = [];
			if (!org || !config.token) return { ok: false, message: 'GitHub organization and access token are required', calls };
			const res = await http.request(calls, { path: `/orgs/${enc(org)}` });
			if (res.status === 401) return { ok: false, message: 'GitHub rejected the token (401)', calls };
			if (!res.ok) return { ok: false, message: `GitHub check failed: ${res.error}`, calls };
			const inv = await http.request(calls, { path: `/orgs/${enc(org)}/invitations`, query: { per_page: 1 } });
			if (!inv.ok) return { ok: false, message: `Organization ${org} found, but listing invitations failed (${inv.error}). The token needs Members: read.`, calls };
			const members = await http.request(calls, { path: `/orgs/${enc(org)}/members`, query: { per_page: 1 } });
			const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(members.headers?.get('link') ?? '');
			const count = last ? `${last[1]}+ members` : members.ok ? `${Array.isArray(members.data) ? members.data.length : 0} members` : 'members unknown';
			return { ok: true, message: `Connected to organization ${org} (${count})`, calls };
		},

		async listAccounts(): Promise<NormalizedAccount[]> {
			const calls: ApiCallRecord[] = [];
			const out: NormalizedAccount[] = [];
			const seen = new Set<string>();
			const add = (a: NormalizedAccount) => {
				const k = `${a.kind}:${a.externalId}`;
				if (seen.has(k)) return;
				seen.add(k);
				out.push(a);
			};
			for (const m of await listMembers(calls)) add(await userAccount(calls, m, 'member'));
			for (const m of await listOutside(calls)) add(await userAccount(calls, m, 'outside_collaborator'));
			for (const i of await listOrgInvites(calls)) add(orgInvitation(i));
			for (const repo of repos) for (const i of await listRepoInvites(calls, repo)) add(repoInvitation(i, repo));
			return out;
		},

		async getAccount(account) {
			const calls: ApiCallRecord[] = [];
			if (account.kind === 'invitation') {
				if (account.parentExternalId) {
					const hit = (await listRepoInvites(calls, account.parentExternalId)).find((i) => String(i.id) === account.externalId);
					return hit ? repoInvitation(hit, account.parentExternalId) : null;
				}
				const hit = (await listOrgInvites(calls)).find((i) => String(i.id) === account.externalId);
				return hit ? orgInvitation(hit) : null;
			}
			const login = account.externalId.toLowerCase();
			const m = (await listMembers(calls)).find((u) => String(u.login).toLowerCase() === login);
			if (m) return userAccount(calls, m, 'member');
			const o = (await listOutside(calls)).find((u) => String(u.login).toLowerCase() === login);
			return o ? userAccount(calls, o, 'outside_collaborator') : null;
		},

		async revoke(account, action): Promise<ActionResult> {
			const calls: ApiCallRecord[] = [];
			const login = enc(account.username ?? account.externalId);
			let res: HttpResponse;
			switch (action) {
				case 'github.remove_member':
					res = await http.request(calls, { method: 'DELETE', path: `/orgs/${enc(org)}/memberships/${login}` });
					break;
				case 'github.cancel_invitation':
					res = await http.request(calls, { method: 'DELETE', path: `/orgs/${enc(org)}/invitations/${enc(account.externalId)}` });
					break;
				case 'github.remove_outside_collaborator':
					res = await http.request(calls, { method: 'DELETE', path: `/orgs/${enc(org)}/outside_collaborators/${login}` });
					break;
				case 'github.cancel_repo_invitation':
					if (!account.parentExternalId) return { ok: false, calls, error: 'Repository invitation without a repository', retryable: false };
					res = await http.request(calls, { method: 'DELETE', path: `/repos/${account.parentExternalId}/invitations/${enc(account.externalId)}` });
					break;
				default:
					return { ok: false, calls, error: `GitHub connector cannot perform ${action}`, retryable: false };
			}
			if (res.status === 404) return success(calls, { alreadyGone: true }); // verified by re-listing afterwards
			return res.ok ? success(calls) : failed(res, calls, action);
		},

		async verify(account, action): Promise<VerifyResult> {
			const calls: ApiCallRecord[] = [];
			try {
				switch (action) {
					case 'github.remove_member': {
						const there = await present.member(calls, account.username ?? account.externalId);
						return { confirmed: !there, observed: there ? 'still an organization member' : 'not in organization members', calls };
					}
					case 'github.remove_outside_collaborator': {
						const there = await present.outside(calls, account.username ?? account.externalId);
						return { confirmed: !there, observed: there ? 'still an outside collaborator' : 'not in outside collaborators', calls };
					}
					case 'github.cancel_invitation': {
						const there = await present.orgInvite(calls, account.externalId);
						return { confirmed: !there, observed: there ? 'invitation still pending' : 'invitation no longer listed', calls };
					}
					case 'github.cancel_repo_invitation': {
						if (!account.parentExternalId) return { confirmed: false, observed: 'missing repository', calls };
						const there = await present.repoInvite(calls, account.parentExternalId, account.externalId);
						return { confirmed: !there, observed: there ? `invitation to ${account.parentExternalId} still pending` : `invitation to ${account.parentExternalId} no longer listed`, calls };
					}
					default:
						return { confirmed: false, observed: `unsupported action ${action}`, calls };
				}
			} catch (e) {
				return { confirmed: false, observed: `read-back failed: ${(e as Error).message}`, calls };
			}
		},

		actionsFor(account): ActionKind[] {
			if (account.kind === 'invitation') return [account.parentExternalId ? 'github.cancel_repo_invitation' : 'github.cancel_invitation'];
			return [isOutside(account) ? 'github.remove_outside_collaborator' : 'github.remove_member'];
		}
	};
}
