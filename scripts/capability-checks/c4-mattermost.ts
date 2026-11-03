/**
 * C4: Mattermost admin API. Revoke sessions and deactivate a user.
 *
 * Without --apply: checks the admin token (system_admin), and lists users with
 * paging. Changes nothing.
 * With --apply: creates a test user, logs it in once, revokes all its sessions,
 * deactivates it (DELETE /users/{id}, not permanent), re-reads it and checks a
 * new login fails. The test user is deactivated in a finally block if it is
 * still active. It is not hard-deleted: permanent delete is a non-goal and
 * needs EnableAPIUserDeletion.
 */
import {
	addTag,
	bearer,
	isMain,
	newPassword,
	parseFlags,
	registerSecret,
	req,
	runCheck,
	stamp,
	type Ctx,
	type Outcome,
	type RunFlags,
} from './lib.js';

const NAME = 'c4-mattermost';

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C4 Mattermost admin API: revoke sessions, deactivate user',
			required: ['MATTERMOST_BASE_URL', 'MATTERMOST_ADMIN_TOKEN'],
			body: c4,
		},
		flags,
	);
}

async function c4(x: Ctx): Promise<void> {
	const c = x.c;
	const base = `${x.need('MATTERMOST_BASE_URL').replace(/\/+$/, '')}/api/v4`;
	const adminToken = x.need('MATTERMOST_ADMIN_TOKEN');
	const mm = (method: string, path: string, body?: unknown, token = adminToken) =>
		req(method, `${base}${path}`, { headers: bearer(token), body });

	c.title('Admin token, users and paging (read-only)');
	const me = await mm('GET', '/users/me');
	c.assert(
		me.status === 200,
		'GET /users/me: token authenticates',
		me,
		'401: enable personal access tokens in the System Console (ServiceSettings.EnableUserAccessTokens), or check the token',
	);
	const roles = String(me.json?.roles ?? '');
	c.assert(roles.includes('system_admin'), `token user is a system admin (roles: ${roles || 'none'})`);

	let total = 0;
	let pages = 0;
	for (let page = 0; page < 25; page++) {
		const res = await mm('GET', `/users?page=${page}&per_page=200`);
		if (page === 0) c.assert(res.status === 200, 'GET /users (page 0, per_page=200)', res);
		if (res.status !== 200 || !Array.isArray(res.json)) break;
		pages++;
		total += res.json.length;
		if (res.json.length < 200) break;
	}
	c.info(`${total} user(s) over ${pages} page(s)`);

	c.title('Plan');
	c.info(
		'would create a test user, log it in once, revoke all its sessions, deactivate it, re-read delete_at, and check a login is refused',
	);
	if (!x.apply) {
		c.info('dry run: nothing created or changed. Rerun with --apply.');
		return;
	}

	c.title('Test user lifecycle (--apply)');
	const runId = stamp();
	const username = `capcheck-${runId}`;
	const email = x.opt('TEST_ALIAS_EMAIL')
		? addTag(x.need('TEST_ALIAS_EMAIL'), `mm-${runId}`)
		: `${username}@company.test`;
	const password = newPassword();
	let userId: string | undefined;
	try {
		const created = await mm('POST', '/users', { email, username, password, first_name: 'Dana', last_name: 'CapCheck' });
		c.assert(created.status === 201, 'POST /users: create test user', created);
		userId = created.json?.id;
		if (!userId) return;
		const id = userId;

		// One login creates a session. The Token header is the session token.
		const login = await req('POST', `${base}/users/login`, { body: { login_id: username, password } });
		const sessionToken = login.headers.token;
		registerSecret(sessionToken);
		c.assert(login.status === 200, 'login once (creates a session)', login);

		const s1 = await mm('GET', `/users/${id}/sessions`);
		c.assert(
			s1.status === 200 && Array.isArray(s1.json) && s1.json.length > 0,
			`sessions before revoke: ${Array.isArray(s1.json) ? s1.json.length : 'n/a'}`,
			s1,
		);

		const revoke = await mm('POST', `/users/${id}/sessions/revoke/all`);
		c.assert(revoke.status === 200, 'POST /users/{id}/sessions/revoke/all', revoke);

		const s2 = await mm('GET', `/users/${id}/sessions`);
		c.assert(s2.status === 200 && Array.isArray(s2.json) && s2.json.length === 0, 'sessions after revoke: empty', s2);

		if (sessionToken) {
			const old = await req('GET', `${base}/users/me`, { headers: bearer(sessionToken) });
			c.assert(old.status === 401, 'revoked session token rejected', old);
		}

		const deact = await mm('DELETE', `/users/${id}`);
		c.assert(deact.status === 200, 'DELETE /users/{id}: deactivate (not permanent)', deact);

		const u = await mm('GET', `/users/${id}`);
		c.assert(u.status === 200 && Number(u.json?.delete_at) > 0, 'GET user: delete_at > 0', u);

		const relogin = await req('POST', `${base}/users/login`, { body: { login_id: username, password } });
		c.assert(relogin.status >= 400, 'login after deactivation refused', relogin);
		c.info('test user left deactivated (hard delete is a non-goal)');
	} finally {
		if (userId) {
			const cur = await mm('GET', `/users/${userId}`);
			if (cur.status === 200 && Number(cur.json?.delete_at) === 0) {
				const d = await mm('DELETE', `/users/${userId}`);
				c.assert(d.status === 200, 'cleanup: deactivate test user', d);
			}
		}
	}
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
