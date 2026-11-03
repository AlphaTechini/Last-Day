/**
 * C5: GitHub Free org. Invitations, collaborators, membership.
 *
 * Without --apply: reads the org, members, pending org invitations, outside
 * collaborators and the test repo's invitations. Changes nothing.
 * With --apply:
 *   - invites TEST_ALIAS_EMAIL to the org by email, then cancels the invite;
 *   - if GITHUB_DANA_USERNAME is set (a consenting real account): invites it as
 *     a repo collaborator by username (the only repo-invite form the API
 *     accepts), cancels that invite, and adds it as an org member, removes it
 *     and re-lists.
 * An email cannot be used for a repo invitation (API_REFERENCE 0.9), so that
 * case is reported and skipped rather than faked.
 */
import {
	addTag,
	isMain,
	parseFlags,
	req,
	runCheck,
	stamp,
	type Ctx,
	type Outcome,
	type Res,
	type RunFlags,
} from './lib.js';

const NAME = 'c5-github';
const API = 'https://api.github.com';

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C5 GitHub Free org: invitations, collaborators, membership',
			required: ['GITHUB_TOKEN', 'GITHUB_ORG', 'GITHUB_TEST_REPO', 'TEST_ALIAS_EMAIL'],
			body: c5,
		},
		flags,
	);
}

function ghHeaders(token: string): Record<string, string> {
	return {
		authorization: `Bearer ${token}`,
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'last-day-capability-check',
	};
}

async function c5(x: Ctx): Promise<void> {
	const c = x.c;
	const token = x.need('GITHUB_TOKEN');
	const org = x.need('GITHUB_ORG');
	const repoEnv = x.need('GITHUB_TEST_REPO');
	const repo = repoEnv.includes('/') ? repoEnv : `${org}/${repoEnv}`;
	const alias = x.need('TEST_ALIAS_EMAIL');
	const dana = x.opt('GITHUB_DANA_USERNAME');

	const gh = (method: string, path: string, body?: unknown) =>
		req(method, `${API}${path}`, { headers: ghHeaders(token), body });

	// Follows page numbers until a short page. `first` is the first response.
	const listAll = async (path: string): Promise<{ items: any[]; first?: Res }> => {
		const items: any[] = [];
		let first: Res | undefined;
		for (let page = 1; page <= 50; page++) {
			const sep = path.includes('?') ? '&' : '?';
			const res = await gh('GET', `${path}${sep}per_page=100&page=${page}`);
			first ??= res;
			if (res.status !== 200 || !Array.isArray(res.json)) break;
			items.push(...res.json);
			if (res.json.length < 100) break;
		}
		return { items, first };
	};

	c.title('Org, members, invitations, collaborators (read-only)');
	const org0 = await gh('GET', `/orgs/${org}`);
	c.assert(org0.status === 200, `GET /orgs/${org}`, org0, `plan: ${org0.json?.plan?.name ?? 'not shown'}`);
	c.info(`rate limit remaining: ${org0.headers['x-ratelimit-remaining'] ?? 'n/a'}`);

	const members = await listAll(`/orgs/${org}/members`);
	c.assert(members.first?.status === 200, `GET members: ${members.items.length}`, members.first, 'needs Organization Members: read');

	const invites = await listAll(`/orgs/${org}/invitations`);
	c.assert(invites.first?.status === 200, `GET org invitations: ${invites.items.length} pending`, invites.first);

	const outside = await listAll(`/orgs/${org}/outside_collaborators`);
	c.assert(outside.first?.status === 200, `GET outside collaborators: ${outside.items.length}`, outside.first);

	const repoInv = await listAll(`/repos/${repo}/invitations`);
	c.assert(
		repoInv.first?.status === 200,
		`GET /repos/${repo}/invitations: ${repoInv.items.length} pending`,
		repoInv.first,
		'needs Repository Administration: read',
	);

	c.info(
		'Invitation limit: a new free org can send 50 org invitations per 24 hours (500 once the org is a month old or on a paid plan). Check docs.github.com before seeding (API_REFERENCE 0.10).',
	);

	c.title('Plan');
	c.info('org invite by email, then cancel it');
	c.info(
		dana
			? `repo invite by username (${dana}), then cancel; org membership add, remove, re-list`
			: 'repo invite and membership steps need GITHUB_DANA_USERNAME (a consenting real account); skipped',
	);
	if (!x.apply) {
		c.info('dry run: nothing invited or changed. Rerun with --apply (sends real invitation emails to the addresses used).');
		return;
	}

	c.title('Org invitation by email, then cancel (--apply)');
	const email = addTag(alias, `gh-${stamp()}`);
	const inv = await gh('POST', `/orgs/${org}/invitations`, { email, role: 'direct_member' });
	c.assert(
		inv.status === 201,
		'POST /orgs/{org}/invitations (email)',
		inv,
		'422 may mean the email already has a pending invite, or the org invitation limit is hit',
	);
	const invId: number | undefined = inv.json?.id;
	if (invId !== undefined) {
		try {
			const listed = await listAll(`/orgs/${org}/invitations`);
			c.assert(
				listed.items.some((i) => i.id === invId),
				'GET org invitations: the new invite is listed',
				listed.first,
			);
		} finally {
			const cancel = await gh('DELETE', `/orgs/${org}/invitations/${invId}`);
			c.assert(cancel.status === 204 || cancel.status === 404, `DELETE /orgs/${org}/invitations/${invId}`, cancel);
		}
		const after = await listAll(`/orgs/${org}/invitations`);
		c.assert(!after.items.some((i) => i.id === invId), 'org invitations: the invite is gone after cancel', after.first);
	}

	c.title('Repo collaborator invitation by username');
	if (!dana) {
		c.info(
			'skipped: GitHub repo invitations take a username, not an email (API_REFERENCE 0.9). Set GITHUB_DANA_USERNAME to a consenting account to test it.',
		);
	} else {
		const put = await gh('PUT', `/repos/${repo}/collaborators/${dana}`, { permission: 'pull' });
		c.assert(
			put.status === 201 || put.status === 204,
			`PUT collaborator ${dana}: ${put.status === 204 ? 'already a collaborator, no invite made' : 'invitation sent'}`,
			put,
		);
		if (put.status === 201) {
			const invs = await listAll(`/repos/${repo}/invitations`);
			const hit = invs.items.find((i) => i.invitee?.login === dana);
			c.assert(!!hit, `GET repo invitations: the invite for ${dana} is listed`, invs.first);
			if (hit) {
				const del = await gh('DELETE', `/repos/${repo}/invitations/${hit.id}`);
				c.assert(del.status === 204 || del.status === 404, `DELETE /repos/${repo}/invitations/${hit.id}`, del);
			}
		}
	}

	c.title('Consenting account: add as org member, remove, re-list');
	if (!dana) {
		c.info('skipped: set GITHUB_DANA_USERNAME (a consenting real account) to run this step');
		return;
	}
	try {
		const add = await gh('PUT', `/orgs/${org}/memberships/${dana}`, { role: 'member' });
		c.assert(add.status === 200, `PUT memberships/${dana}: added (state ${add.json?.state ?? 'not shown'})`, add);
		const st = await gh('GET', `/orgs/${org}/memberships/${dana}`);
		c.assert(st.status === 200, `GET memberships/${dana}: state ${st.json?.state ?? st.status}`, st);
	} finally {
		const rm = await gh('DELETE', `/orgs/${org}/memberships/${dana}`);
		c.assert(rm.status === 204 || rm.status === 404, `DELETE memberships/${dana}`, rm);
	}
	const gone = await gh('GET', `/orgs/${org}/memberships/${dana}`);
	c.assert(gone.status === 404, `GET memberships/${dana} after removal: 404`, gone);
	const members2 = await listAll(`/orgs/${org}/members`);
	const invites2 = await listAll(`/orgs/${org}/invitations`);
	const present = members2.items.some((m) => m.login === dana) || invites2.items.some((i) => i.login === dana);
	c.assert(!present, 'org members and invitations: no trace of the account', invites2.first);
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
