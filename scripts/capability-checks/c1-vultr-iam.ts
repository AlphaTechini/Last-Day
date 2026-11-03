/**
 * C1: Vultr IAM leaver loop.
 *
 * Proves the leaver steps through the API: create an API key for a user, check
 * the key works, suspend the user, check the key is refused, delete the key,
 * check it is gone. Two paths:
 *   - invited user: only if the alias address already belongs to an org user
 *     (acceptance of the invitation is a manual step, so this path is PENDING
 *     until someone accepts the invite and reruns with --apply);
 *   - service user: POST /users with service_user=true, always with --apply.
 *
 * Without --apply: read-only probes, plus a suspend id-type probe that uses
 * non-existent ids (no user is affected).
 * With --apply: may invite the alias address, creates a service user and API
 * keys, suspends and restores test accounts. Everything it creates is removed
 * in a finally block.
 */
import {
	addTag,
	arrayIn,
	bearer,
	errMsg,
	isMain,
	newPassword,
	parseFlags,
	registerSecret,
	req,
	runCheck,
	stamp,
	vultrAll,
	vultrApiUrl,
	type Ctx,
	type Outcome,
	type Res,
	type RunFlags,
} from './lib.js';

const NAME = 'c1-vultr-iam';

type Send = (method: string, path: string, body?: unknown) => Promise<Res>;

interface Vc {
	api: string;
	token: string;
	v: Send;
	all: (path: string, ...names: string[]) => Promise<{ items: any[]; first?: Res }>;
}

interface Cleanup {
	label: string;
	run: () => Promise<void>;
}

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C1 Vultr IAM leaver loop (invited user and service user)',
			required: ['VULTR_API_KEY', 'TEST_ALIAS_EMAIL'],
			body: c1,
		},
		flags,
	);
}

async function c1(x: Ctx): Promise<void> {
	const api = vultrApiUrl();
	const token = x.need('VULTR_API_KEY');
	const v: Send = (method, path, body) => req(method, `${api}${path}`, { headers: bearer(token), body });
	const vc: Vc = { api, token, v, all: (path, ...names) => vultrAll(api, token, path, ...names) };
	const cleanup: Cleanup[] = [];
	try {
		await steps(x, vc, cleanup);
	} finally {
		// Undo what this run created, newest first. Each item reports its own result.
		for (const item of cleanup.reverse()) {
			try {
				await item.run();
			} catch (e) {
				x.c.assert(false, `cleanup "${item.label}" threw: ${errMsg(e)}`);
			}
		}
	}
}

async function steps(x: Ctx, vc: Vc, cleanup: Cleanup[]): Promise<void> {
	const c = x.c;
	const v = vc.v;
	const alias = x.need('TEST_ALIAS_EMAIL');
	const runId = stamp();

	c.title('Account, organization and users (read-only)');
	const acct = await v('GET', '/account');
	c.assert(acct.status === 200, 'GET /account: API key authenticates', acct);
	c.info(`account ACLs: ${JSON.stringify(acct.json?.account?.acls ?? null)}`);

	const orgs = await v('GET', '/organizations?per_page=100');
	c.assert(orgs.status === 200, 'GET /organizations: IAM organizations readable', orgs);
	const orgList = arrayIn(orgs.json, 'orgs');
	for (const o of orgList) c.info(`org ${o.id} "${o.name}" type=${o.type}`);

	let orgId: string | undefined = x.opt('VULTR_ORG_ID') ?? orgList[0]?.id;
	if (!orgId && x.apply) {
		const created = await v('POST', '/organizations', { name: `last-day-capcheck-${runId}` });
		c.assert(
			created.status === 200 || created.status === 201,
			'POST /organizations: account can create an IAM organization',
			created,
			'no API delete for organizations is documented: remove it in the console',
		);
		orgId = created.json?.org?.id ?? created.json?.organization?.id ?? created.json?.id;
	}
	if (!orgId) {
		c.info('no IAM organization available: rerun with --apply to test creating one, or set VULTR_ORG_ID');
		return;
	}
	c.info(`using organization ${orgId}`);

	const users = await vc.all('/users', 'users');
	c.assert(users.first?.status === 200, `GET /users: ${users.items.length} user(s) in the organization`, users.first);
	c.info(`user fields seen: ${users.items[0] ? Object.keys(users.items[0]).join(', ') : '(none)'}`);

	const suspended = await vc.all(`/organizations/${orgId}/suspended-users`, 'users');
	c.assert(
		suspended.first?.status === 200,
		`GET suspended-users: ${suspended.items.length} suspended`,
		suspended.first,
	);

	const invites = await vc.all('/invitation', 'invites');
	c.assert(invites.first?.status === 200, `GET /invitation: ${invites.items.length} invitation(s)`, invites.first);

	c.title('Suspend endpoint: user id type probe (non-existent ids, no user is affected)');
	const probes: Array<[string, string]> = [
		['UUID', '00000000-0000-0000-0000-000000000000'],
		['integer', '999999999'],
	];
	for (const [kind, id] of probes) {
		const r = await v('PUT', `/organizations/${orgId}/user/${id}/suspend`);
		c.assert(
			r.status > 0 && r.status < 500,
			`suspend endpoint answers for the ${kind} id form: ${interpretProbe(r.status)}`,
			r,
		);
		if (r.status === 204) cleanup.push(unsuspendOnly(x, vc, orgId, id));
	}

	c.title('Plan');
	c.info(
		'1. Invited-user path: if TEST_ALIAS_EMAIL is already an org user, run the leaver loop on it and restore it. Otherwise POST /invitation and stop (acceptance is manual).',
	);
	c.info(
		'2. Service-user path: POST /users (service_user=true), key works, PATCH api_enabled=false then true, leaver loop, delete the user.',
	);
	if (!x.apply) {
		c.info('dry run: nothing created or changed. Rerun with --apply.');
		return;
	}

	c.title('Invited-user path');
	const aliasLower = alias.toLowerCase();
	const existing = users.items.find((u) => String(u.email ?? '').toLowerCase() === aliasLower);
	let invitedOk = false;
	let invitedPending = false;
	let suspendedAny = false;
	if (existing) {
		const userId = String(existing.id);
		c.info(`${alias} is already an org user (${userId}): running the leaver loop on it`);
		cleanup.push(restoreUser(x, vc, orgId, userId));
		const loop = await leaverLoop(x, vc, { userId, orgId, label: 'invited', cleanup });
		invitedOk = loop.ok;
		suspendedAny ||= loop.suspended;
	} else {
		invitedPending = true;
		const pending = invites.items.find((i) => String(i.email_invited ?? '').toLowerCase() === aliasLower);
		if (pending) {
			c.info(`invitation ${pending.id} already pending for ${alias}`);
		} else {
			const inv = await v('POST', '/invitation', { email_invited: alias, permissions: { api_enabled: 'yes' } });
			c.assert(
				inv.status === 200 || inv.status === 201,
				`POST /invitation: invite ${alias}`,
				inv,
				'raw shows email_registered (does the invitee need a Vultr account first?) and the expiry',
			);
		}
		c.info(
			`PENDING (manual): accept the invitation email for ${alias}, then rerun with --apply. Invitations expire after 3 days; this run does not cancel them.`,
		);
	}

	c.title('Service-user path');
	const svcEmail = addTag(alias, `svc-${runId}`);
	const created = await v('POST', '/users', {
		email: svcEmail,
		name: `Dana CI capcheck ${runId}`,
		password: newPassword(),
		api_enabled: true,
		service_user: true,
		acls: [],
	});
	c.assert(
		created.status === 200 || created.status === 201,
		'POST /users (service_user=true, api_enabled=true)',
		created,
		'the response carries api_key once; it is redacted in the log',
	);
	const svc = created.json?.user ?? {};
	const svcId = svc.id !== undefined ? String(svc.id) : undefined;
	let serviceOk = false;
	if (svcId) {
		cleanup.push(deleteUser(x, vc, svcId));
		const svcKey = typeof svc.api_key === 'string' ? svc.api_key : undefined;
		registerSecret(svcKey);
		c.assert(
			!!svcKey,
			'service user: api_key returned on create',
			svcKey ? undefined : created,
			svcKey ? 'key captured, value not logged' : 'no api_key field: check the raw keys above',
		);
		if (svcKey) {
			const works = await keyCall(vc, svcKey);
			c.assert(
				works.status === 200,
				'service key authenticates (GET /account)',
				works,
				'403 here means the user has no ACL for /account, which is not a revoke failure',
			);
			const off = await v('PATCH', `/users/${svcId}`, { api_enabled: false });
			c.assert(off.status === 200 || off.status === 204, 'PATCH api_enabled=false (documented revoke fallback)', off);
			const refusedOff = await keyCall(vc, svcKey);
			c.assert(
				refusedOff.status === 401 || refusedOff.status === 403,
				'key refused while api_enabled=false',
				refusedOff,
			);
			const on = await v('PATCH', `/users/${svcId}`, { api_enabled: true });
			c.assert(on.status === 200 || on.status === 204, 'PATCH api_enabled=true (re-enable for the loop)', on);

			const loop = await leaverLoop(x, vc, { userId: svcId, orgId, label: 'service', cleanup });
			serviceOk = loop.ok;
			suspendedAny ||= loop.suspended;
			// The loop removed its own key. Remove the original create-time key too.
			await deleteAllKeys(x, vc, svcId, 'original create-time key');
		}
	}

	c.title('Fallback ladder decision (CAPABILITY_CHECKS C1)');
	if (invitedOk) c.info('(a) invited users work fully: use them.');
	else if (serviceOk) c.info('(b) only service users work: Dana = her CI service user + its API key + her servers.');
	else if (suspendedAny) c.info('(c) only suspend works: the Vultr connector does read + suspend, and the README says so.');
	else c.info('no leaver path proven: escalate before the main build.');
	if (invitedPending) c.info('the invited-user path is still PENDING manual acceptance, so the ladder decision is open.');
}

interface LoopInput {
	userId: string;
	orgId: string;
	label: string;
	cleanup: Cleanup[];
}

interface LoopResult {
	/** No assertion failed in the loop. */
	ok: boolean;
	/** The suspend endpoint itself worked (not the PATCH fallback). */
	suspended: boolean;
}

/** Create key, verify, suspend (fallback PATCH), verify, key refused, delete key, verify. */
async function leaverLoop(x: Ctx, vc: Vc, input: LoopInput): Promise<LoopResult> {
	const c = x.c;
	const v = vc.v;
	const { userId, orgId, label } = input;
	const before = c.failureCount;
	let suspended = false;
	c.title(`Leaver loop: ${label} user ${userId}`);

	// 1. Create a key. Try with an expiry (safety net if cleanup fails), retry without on 400.
	const name = `capcheck-${stamp()}`;
	let created = await v('POST', `/users/${userId}/apikeys`, {
		name,
		expire: true,
		date_expire: new Date(Date.now() + 3_600_000).toISOString(),
	});
	if (created.status === 400) {
		c.info('expiry fields rejected: retrying with a key that does not expire');
		created = await v('POST', `/users/${userId}/apikeys`, { name, expire: false });
	}
	const createdOk = [200, 201, 202].includes(created.status);
	c.assert(
		createdOk,
		`POST /users/${userId}/apikeys: key created`,
		created,
		'202 means accepted: the key may appear in the list before the value does',
	);
	if (!createdOk) return { ok: false, suspended };

	const extracted = extractKey(created.json);
	registerSecret(extracted.value);
	if (!extracted.value) {
		c.assert(false, 'key value returned once on create', created);
		return { ok: false, suspended };
	}
	const keyValue = extracted.value;
	input.cleanup.push(deleteAllKeysCleanup(x, vc, userId));

	// 2. The key is listed, with the fields the docs describe (UNVERIFIED shapes).
	const listed = await listKeys(vc, userId);
	c.assert(
		listed.status === 200 && listed.items.length > 0,
		`GET /users/${userId}/apikeys: ${listed.items.length} key(s) listed`,
		listed.res,
	);
	c.info(`key list item fields: ${listed.items[0] ? Object.keys(listed.items[0]).join(', ') : '(none)'}`);
	const keyId: string | undefined =
		extracted.id ??
		listed.items.find((item) => item.name === name)?.id?.toString() ??
		(listed.items.length === 1 ? String(listed.items[0].id) : undefined);

	// 3. The new key authenticates.
	const auth = await keyCall(vc, keyValue);
	c.assert(
		auth.status === 200,
		'new key authenticates (GET /account)',
		auth,
		'403 here means no ACL for /account, which is not a revoke failure',
	);

	// 4. Suspend with the uuid. Fall back to PATCH api_enabled=false on failure.
	const sus = await v('PUT', `/organizations/${orgId}/user/${userId}/suspend`);
	const suspendWorked = c.assert(
		sus.status === 204,
		`PUT suspend with uuid ${userId}`,
		sus,
		'a 400 or 404 here is the id-type conflict (API_REFERENCE 0.2); the PATCH fallback follows',
	);
	let verifyBySuspendList = suspendWorked;
	if (suspendWorked) {
		suspended = true;
	} else {
		const patch = await v('PATCH', `/users/${userId}`, { api_enabled: false });
		c.assert(patch.status === 200 || patch.status === 204, 'fallback PATCH api_enabled=false', patch);
		verifyBySuspendList = false;
	}

	// 5. Re-read the state: suspended list (suspend route) or the user's flag (fallback).
	if (verifyBySuspendList) {
		const list = await vc.all(`/organizations/${orgId}/suspended-users`, 'users');
		c.assert(
			list.items.some((u) => String(u.user_id) === userId),
			'GET suspended-users lists the user',
			list.first,
		);
	} else {
		const u = await v('GET', `/users/${userId}`);
		c.assert(u.json?.user?.api_enabled === false, 'GET user: api_enabled=false', u);
	}

	// 6. The key is refused.
	const refused = await keyCall(vc, keyValue);
	c.assert(refused.status === 401 || refused.status === 403, 'key refused after suspend or disable', refused);

	// 7. Delete the key.
	const targets = keyId ? [keyId] : listed.items.map((item) => String(item.id));
	for (const target of targets) {
		const del = await v('DELETE', `/users/${userId}/apikeys/${target}`);
		c.assert(del.status === 204 || del.status === 200, `DELETE /users/${userId}/apikeys/${target}`, del);
	}

	// 8. Re-read the key list.
	const after = await listKeys(vc, userId);
	const stillThere = keyId ? after.items.some((item) => String(item.id) === keyId) : after.items.length > 0;
	c.assert(!stillThere, `GET apikeys after delete: key gone (${after.items.length} key(s) left)`, after.res);

	// 9. The deleted key is refused.
	const gone = await keyCall(vc, keyValue);
	c.assert(gone.status === 401 || gone.status === 403, 'deleted key refused', gone);

	return { ok: c.failureCount === before, suspended };
}

// ---------------------------------------------------------------- helpers

function interpretProbe(status: number): string {
	switch (status) {
		case 404:
			return 'id format accepted, user not found';
		case 400:
			return 'id format rejected (type conflict, API_REFERENCE 0.2)';
		case 401:
		case 403:
			return 'no permission for the suspend route';
		case 204:
			return 'succeeded for a non-existent id (unexpected): unsuspend queued as cleanup';
		default:
			return `unexpected HTTP ${status}`;
	}
}

/** The plain key appears only in the create response. Accepts several plausible shapes. */
function extractKey(json: any): { id?: string; value?: string } {
	const node = json?.api_key ?? json?.apikey ?? json ?? {};
	if (typeof node === 'string') return { value: node };
	return {
		id: node?.id !== undefined ? String(node.id) : undefined,
		value: typeof node?.api_key === 'string' ? node.api_key : undefined,
	};
}

async function listKeys(vc: Vc, userId: string): Promise<{ status: number; items: any[]; res: Res }> {
	const res = await vc.v('GET', `/users/${userId}/apikeys`);
	return { status: res.status, items: arrayIn(res.json, 'api_keys', 'apikeys', 'keys'), res };
}

/** Uses the key itself: GET /account. 200 means it authenticates; 401/403 means refused. */
function keyCall(vc: Vc, key: string): Promise<Res> {
	return req('GET', `${vc.api}/account`, { headers: bearer(key) });
}

async function deleteAllKeys(x: Ctx, vc: Vc, userId: string, label: string): Promise<void> {
	const c = x.c;
	const listed = await listKeys(vc, userId);
	if (listed.status !== 200) {
		c.assert(false, `${label}: key list for ${userId}`, listed.res);
		return;
	}
	if (listed.items.length === 0) {
		c.info(`${label}: no keys left on ${userId}`);
		return;
	}
	for (const item of listed.items) {
		const del = await vc.v('DELETE', `/users/${userId}/apikeys/${item.id}`);
		c.assert(del.status === 204 || del.status === 200, `${label}: DELETE key ${item.id}`, del);
	}
}

// ---------------------------------------------------------------- cleanup items (run in finally)

function deleteAllKeysCleanup(x: Ctx, vc: Vc, userId: string): Cleanup {
	return { label: `keys of ${userId}`, run: () => deleteAllKeys(x, vc, userId, 'cleanup') };
}

function deleteUser(x: Ctx, vc: Vc, userId: string): Cleanup {
	return {
		label: `delete user ${userId}`,
		run: async () => {
			const c = x.c;
			const current = await vc.v('GET', `/users/${userId}`);
			if (current.status === 404) {
				c.info(`cleanup: user ${userId} already gone`);
				return;
			}
			const del = await vc.v('DELETE', `/users/${userId}`);
			c.assert(del.status === 204 || del.status === 200, `cleanup: DELETE /users/${userId} (test user)`, del);
			const after = await vc.v('GET', `/users/${userId}`);
			c.assert(after.status === 404, `cleanup: user ${userId} gone`, after);
		},
	};
}

/** Puts an existing account back the way it was: unsuspend, falling back to api_enabled=true. */
function restoreUser(x: Ctx, vc: Vc, orgId: string, userId: string): Cleanup {
	return {
		label: `restore ${userId}`,
		run: async () => {
			const c = x.c;
			const un = await vc.v('PUT', `/organizations/${orgId}/user/${userId}/unsuspend`);
			if (un.status === 204 || un.status === 200) {
				c.info(`cleanup: unsuspended ${userId}`);
				return;
			}
			const patch = await vc.v('PATCH', `/users/${userId}`, { api_enabled: true });
			c.assert(
				patch.status === 200 || patch.status === 204,
				`cleanup: unsuspend returned HTTP ${un.status}; PATCH api_enabled=true instead`,
				patch,
			);
		},
	};
}

function unsuspendOnly(x: Ctx, vc: Vc, orgId: string, userId: string): Cleanup {
	return {
		label: `unsuspend probe id ${userId}`,
		run: async () => {
			const un = await vc.v('PUT', `/organizations/${orgId}/user/${userId}/unsuspend`);
			x.c.info(`cleanup: unsuspend of probe id ${userId} returned HTTP ${un.status}`);
		},
	};
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
