import { HttpClient } from '#lib/server/connectors/http.ts';
import type { ConnectionConfig } from '#lib/server/connectors/types.ts';
import { PEOPLE, githubPublicEmail, realGithubTargets } from '../company.ts';
import { Api, mockAdmin, type SeedCtx } from './common.ts';

/**
 * GitHub accounts cannot be created through an API, and we never create fake ones.
 * - Real mode: only what the environment names (real, consenting accounts / addresses):
 *     DEMO_GITHUB_INVITE_EMAILS  org invitations by email (these need no GitHub account)
 *     DEMO_GITHUB_DANA_LOGIN     a real login that plays Dana: invited to the configured repos
 *   Unset = nothing is created.
 * - Sandbox: profiles, memberships and the outside collaborator are registered through the sandbox admin endpoint,
 *   then the invitations are created through the normal endpoints.
 */
export async function seedGithub(config: ConnectionConfig, ctx: SeedCtx): Promise<void> {
	const org = encodeURIComponent(config.org);
	const http = new HttpClient((config.apiUrl || 'https://api.github.com').replace(/\/+$/, ''), {
		authorization: `Bearer ${config.token}`,
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'last-day-seed'
	});
	const api = new Api(http, 'GitHub');
	const repos = (config.repos ?? '').split(/[,\s]+/).filter((r) => r.includes('/'));

	const listAll = async (path: string) => {
		const rows: Record<string, any>[] = [];
		for (let page = 1; page < 50; page++) {
			const r = await api.call('GET', path, { query: { per_page: 100, page } });
			const arr = (r.data ?? []) as Record<string, any>[];
			rows.push(...arr);
			if (arr.length < 100) break;
		}
		return rows;
	};

	let inviteEmails: string[];
	let danaLogin: string | null;

	if (ctx.isMock && ctx.mockOrigin) {
		const withGh = PEOPLE.filter((p) => p.github);
		await mockAdmin(ctx.mockOrigin, '/__admin/github/seed', {
			profiles: withGh.map((p) => ({ login: p.github!.login, name: p.github!.profileName, email: githubPublicEmail(p.github!, ctx.domain) ?? null, created_at: p.github!.createdAt })),
			members: withGh.filter((p) => p.github!.role === 'member').map((p) => p.github!.login),
			outside: withGh.filter((p) => p.github!.role === 'outside_collaborator').map((p) => ({ login: p.github!.login, repos: (p.github!.repos ?? []).map((r) => `${config.org}/${r}`) }))
		});
		const dana = PEOPLE.find((p) => p.key === 'dana.okafor')!;
		inviteEmails = [dana.aliases[1]];
		danaLogin = dana.github?.login ?? null;
	} else {
		const t = realGithubTargets(ctx.env);
		inviteEmails = t.inviteEmails;
		danaLogin = t.login;
		if (!inviteEmails.length && !danaLogin) {
			ctx.log('github: DEMO_GITHUB_DANA_LOGIN and DEMO_GITHUB_INVITE_EMAILS are unset, so no GitHub footprint is created (never fake accounts)');
			return;
		}
	}

	// Org invitations by email.
	const orgInvites = await listAll(`/orgs/${org}/invitations`);
	let invited = 0;
	for (const email of inviteEmails) {
		if (orgInvites.some((i) => String(i.email ?? '').toLowerCase() === email)) continue;
		const r = await api.call('POST', `/orgs/${org}/invitations`, { json: { email, role: 'direct_member' }, ok: [403, 422] });
		if (r.ok) invited++;
		else ctx.log(`github: invitation to ${email} not created (${r.error})`);
	}

	// Repository invitation for the login that plays Dana (mock: dok-dev is already an outside collaborator on platform, so invite to infra).
	let repoInvited = 0;
	if (danaLogin) {
		const collabRepos = ctx.isMock ? repos.filter((r) => r.endsWith('/infra')) : repos.slice(0, 1);
		for (const repo of collabRepos) {
			const r = await api.call('PUT', `/repos/${repo}/collaborators/${encodeURIComponent(danaLogin)}`, { json: { permission: 'push' }, ok: [403, 404, 422] });
			if (r.status === 201) repoInvited++;
			else if (!r.ok) ctx.log(`github: collaborator invitation for ${danaLogin} on ${repo} not created (${r.error})`);
		}
	}
	ctx.log(`github: ${ctx.isMock ? 'sandbox accounts registered, ' : ''}${invited} org invitation(s) and ${repoInvited} repo invitation(s) created`);
}
