/**
 * C3: Keycloak admin API. Disable a user and end their sessions.
 *
 * Without --apply: gets a client-credentials token and reads the realm and
 * the user list (needs view-users). Changes nothing.
 * With --apply: creates a test user, logs it in once (creates a session),
 * disables it, logs it out, re-reads the user and its sessions, and checks
 * that a new login is refused. The test user is deleted in a finally block.
 */
import {
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

const NAME = 'c3-keycloak';

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C3 Keycloak admin API: disable user, end sessions',
			required: ['KEYCLOAK_BASE_URL', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET'],
			body: c3,
		},
		flags,
	);
}

async function c3(x: Ctx): Promise<void> {
	const c = x.c;
	const base = x.need('KEYCLOAK_BASE_URL').replace(/\/+$/, '');
	const realm = x.opt('KEYCLOAK_REALM') ?? 'company';
	const clientId = x.need('KEYCLOAK_CLIENT_ID');
	const clientSecret = x.need('KEYCLOAK_CLIENT_SECRET');
	// A separate public client with directAccessGrantsEnabled, used only to create a session.
	const loginClient = x.opt('KEYCLOAK_LOGIN_CLIENT_ID') ?? 'demo-login';
	const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;

	c.title('Service-account token (client credentials)');
	const tok = await req('POST', tokenUrl, {
		form: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
	});
	const access: unknown = tok.json?.access_token;
	c.assert(
		tok.status === 200 && typeof access === 'string',
		'client-credentials token issued',
		tok,
		'invalid_client: bad secret. unauthorized_client: service accounts are off for this client',
	);
	if (typeof access !== 'string') return;
	registerSecret(access);
	const admin = (method: string, path: string, body?: unknown) =>
		req(method, `${base}/admin/realms/${realm}${path}`, { headers: bearer(access), body });

	c.title('Read-only: realm and users (needs view-users)');
	const realmRes = await admin('GET', '');
	c.assert(realmRes.status === 200, `realm "${realm}" readable`, realmRes);
	const users = await admin('GET', '/users?max=100');
	c.assert(
		users.status === 200 && Array.isArray(users.json),
		`GET users: ${Array.isArray(users.json) ? users.json.length : 0} listed (max 100)`,
		users,
		'403 means the service account lacks view-users',
	);

	c.title('Plan');
	c.info(
		`would create a test user, log it in once via "${loginClient}" (creates a session), disable it, log it out, re-read the user and sessions, check a new login is refused, then delete the test user`,
	);
	if (!x.apply) {
		c.info('dry run: nothing created or changed. Rerun with --apply.');
		return;
	}

	c.title('Test user lifecycle (--apply)');
	const username = `capcheck-${stamp()}`;
	const password = newPassword();
	let userId: string | undefined;
	try {
		const created = await admin('POST', '/users', {
			username,
			email: `${username}@company.test`,
			firstName: 'Dana',
			lastName: 'CapCheck',
			enabled: true,
			emailVerified: true,
			credentials: [{ type: 'password', value: password, temporary: false }],
		});
		c.assert(created.status === 201, 'POST users: create test user', created);
		userId = created.headers.location?.split('/').pop();
		if (!userId) {
			const found = await admin('GET', `/users?username=${encodeURIComponent(username)}&exact=true`);
			userId = found.json?.[0]?.id;
		}
		if (!userId) {
			c.assert(false, 'test user id resolved');
			return;
		}
		const id = userId;
		c.info(`test user ${id} (${username})`);

		// One password login creates a user session.
		const login = await req('POST', tokenUrl, {
			form: { grant_type: 'password', client_id: loginClient, username, password },
		});
		const loginToken: unknown = login.json?.access_token;
		if (typeof loginToken === 'string') registerSecret(loginToken);
		c.assert(
			login.status === 200 && typeof loginToken === 'string',
			`password login via "${loginClient}" (creates a session)`,
			login,
			'needs directAccessGrantsEnabled on that client',
		);

		const s1 = await admin('GET', `/users/${id}/sessions`);
		c.assert(
			s1.status === 200 && Array.isArray(s1.json) && s1.json.length > 0,
			`sessions before: ${Array.isArray(s1.json) ? s1.json.length : 'n/a'}`,
			s1,
		);

		const u1 = await admin('GET', `/users/${id}`);
		c.assert(u1.status === 200 && u1.json?.enabled === true, 'user enabled before', u1);

		const dis = await admin('PUT', `/users/${id}`, { enabled: false });
		c.assert(dis.status === 204, 'PUT users/{id} enabled=false', dis);

		const out = await admin('POST', `/users/${id}/logout`);
		c.assert(out.status === 204, 'POST users/{id}/logout', out);

		const u2 = await admin('GET', `/users/${id}`);
		c.assert(u2.status === 200 && u2.json?.enabled === false, 'GET user: enabled=false', u2);

		const s2 = await admin('GET', `/users/${id}/sessions`);
		c.assert(s2.status === 200 && Array.isArray(s2.json) && s2.json.length === 0, 'GET sessions: empty', s2);

		const again = await req('POST', tokenUrl, {
			form: { grant_type: 'password', client_id: loginClient, username, password },
		});
		c.assert(
			again.status >= 400 && again.status < 500,
			'new password login refused for the disabled user',
			again,
		);
	} finally {
		if (userId) {
			const del = await admin('DELETE', `/users/${userId}`);
			c.assert(del.status === 204 || del.status === 404, 'cleanup: DELETE test user', del);
		}
	}
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
