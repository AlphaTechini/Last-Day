// Connector tests run against the dev sandbox (scripts/mock-company) started in-process on a random port.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_CREDENTIALS, MOCK_REPOS, startMock, type MockServer } from '../../../../scripts/mock-company/server.ts';
import { seedGithub } from '../demo/systems/github.ts';
import { seedKeycloak } from '../demo/systems/keycloak.ts';
import { seedMattermost } from '../demo/systems/mattermost.ts';
import { seedVultr } from '../demo/systems/vultr.ts';
import type { SeedCtx } from '../demo/systems/common.ts';
import { HttpClient } from './http.ts';
import { createConnector, snapshotMonthlyCost } from './index.ts';
import type { ApiCallRecord, ConnectionConfig, Connector, NormalizedAccount } from './types.ts';

let mock: MockServer;
const opts = { retryBaseMs: 1, verifyPollMs: 0 };
const admin = (path: string, body: unknown = {}) => fetch(`${mock.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const cfg = (): Record<'keycloak' | 'mattermost' | 'github' | 'vultr', ConnectionConfig> => ({
	keycloak: { baseUrl: `${mock.url}/keycloak`, ...MOCK_CREDENTIALS.keycloak },
	mattermost: { baseUrl: `${mock.url}/mattermost`, token: MOCK_CREDENTIALS.mattermost.token },
	github: { apiUrl: `${mock.url}/github`, org: MOCK_CREDENTIALS.github.org, repos: MOCK_REPOS.slice(0, 2).join(','), token: MOCK_CREDENTIALS.github.token },
	vultr: { apiUrl: `${mock.url}/vultr/v2`, apiKey: MOCK_CREDENTIALS.vultr.apiKey }
});
const ctx = (): SeedCtx => ({ log: () => {}, domain: 'northwind.example', env: {}, isMock: true, mockOrigin: mock.url });

beforeAll(async () => {
	mock = await startMock({ port: 0, latency: 0, snapshotMs: 250 });
});
afterAll(async () => {
	await mock.close();
});
beforeEach(() => mock.reset());

const find = (accts: NormalizedAccount[], pred: (a: NormalizedAccount) => boolean) => {
	const a = accts.find(pred);
	if (!a) throw new Error('account not found');
	return a;
};

async function runLoop(c: Connector, a: NormalizedAccount, ctxArg?: { snapshotId?: string | null }) {
	const results = [];
	for (const action of c.actionsFor(a)) {
		const r = await c.revoke(a, action, ctxArg);
		expect(r.ok, `${action}: ${r.error}`).toBe(true);
		expect(r.calls.length).toBeGreaterThan(0);
		const v = await c.verify(a, action, ctxArg);
		expect(v.confirmed, `${action}: ${v.observed}`).toBe(true);
		results.push({ action, r, v });
	}
	return results;
}

describe('keycloak', () => {
	it('lists with paging, disables, ends sessions, verifies; refreshes an expired token', async () => {
		await seedKeycloak(cfg().keycloak, ctx());
		// push past one page of 100
		const tok = await (await fetch(`${mock.url}/keycloak/realms/company/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'last-day', client_secret: MOCK_CREDENTIALS.keycloak.clientSecret }) })).json();
		for (let i = 0; i < 95; i++) await fetch(`${mock.url}/keycloak/admin/realms/company/users`, { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ username: `bulk${i}`, email: `bulk${i}@x.example`, enabled: true }) });

		const kc = createConnector('keycloak', cfg().keycloak, opts);
		const health = await kc.test();
		expect(health.ok).toBe(true);
		expect(health.message).toContain('125 users');
		const accts = await kc.listAccounts();
		expect(accts).toHaveLength(125);
		const dana = find(accts, (a) => a.username === 'dana.okafor');
		expect(dana.emails).toEqual(expect.arrayContaining(['dana.okafor@northwind.example', 'dana.o@gmail.example']));
		expect(dana.kind).toBe('user');
		expect(dana.createdAt).toMatch(/^\d{4}-/);
		expect(kc.actionsFor(dana)).toEqual(['keycloak.disable', 'keycloak.logout']);

		await admin('/__admin/expire-tokens'); // forces a 401 then a transparent token refresh
		const [disable, logout] = await runLoop(kc, dana);
		expect(disable.v.observed).toContain('enabled: false');
		expect(logout.v.observed).toContain('sessions: 0');
		expect(disable.r.calls.some((c) => c.status === 401)).toBe(true);
		expect(disable.r.calls.every((c) => !c.endpoint.includes('?'))).toBe(true);
		expect((await kc.getAccount(dana))?.active).toBe(false);
	});

	it('reports bad credentials as a failed test, not a crash', async () => {
		const kc = createConnector('keycloak', { ...cfg().keycloak, clientSecret: 'wrong' }, opts);
		const h = await kc.test();
		expect(h.ok).toBe(false);
		expect(h.message).toContain('401');
		expect(JSON.stringify(h)).not.toContain('wrong');
		await expect(kc.listAccounts()).rejects.toThrow(/401/);
	});

	it('skips its own service account and labels other service accounts', async () => {
		const c = cfg().keycloak;
		await seedKeycloak(c, ctx());
		const tok = await (await fetch(`${mock.url}/keycloak/realms/company/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'last-day', client_secret: c.clientSecret }) })).json();
		await fetch(`${mock.url}/keycloak/admin/realms/company/users`, { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'service-account-last-day' }) });
		const accts = await createConnector('keycloak', c, opts).listAccounts();
		expect(accts.some((a) => a.username === 'service-account-last-day')).toBe(false);
	});
});

describe('mattermost', () => {
	it('lists active and inactive users across pages, revokes sessions, deactivates, verifies', async () => {
		await seedMattermost(cfg().mattermost, ctx());
		const mm = createConnector('mattermost', cfg().mattermost, opts);
		const h = await mm.test();
		expect(h.ok).toBe(true);
		for (let i = 0; i < 180; i++) {
			await fetch(`${mock.url}/mattermost/api/v4/users`, { method: 'POST', headers: { authorization: `Bearer ${MOCK_CREDENTIALS.mattermost.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ username: `bulk${i}`, email: `bulk${i}@x.example`, password: 'Passw0rd!' }) });
		}
		let accts = await mm.listAccounts();
		expect(accts.length).toBe(32 + 180); // spans two pages of 200
		const dana = find(accts, (a) => a.username === 'dok');
		expect(dana.displayName).toBe('D. O.');
		expect(dana.emails).toEqual(['dana.o@gmail.example']);
		expect(dana.lastActiveAt).toBeTruthy();
		const bot = find(accts, (a) => a.username === 'ops-bot');
		expect(bot.kind).toBe('service');
		expect(bot.displayName).toBe('Ops Bot');

		const [rev, deact] = await runLoop(mm, dana);
		expect(rev.v.observed).toContain('sessions: 0');
		expect(deact.v.observed).toContain('deactivated');
		accts = await mm.listAccounts();
		expect(find(accts, (a) => a.username === 'dok').active).toBe(false); // inactive users are still listed
	});

	it('rejects a wrong token with 401', async () => {
		const mm = createConnector('mattermost', { ...cfg().mattermost, token: 'nope' }, opts);
		const h = await mm.test();
		expect(h.ok).toBe(false);
		expect(h.calls[0].status).toBe(401);
		await expect(mm.listAccounts()).rejects.toThrow();
	});
});

describe('github', () => {
	it('lists members, outside collaborators and both kinds of invitations; revokes and verifies each kind', async () => {
		await seedGithub(cfg().github, ctx());
		const gh = createConnector('github', cfg().github, opts);
		expect((await gh.test()).ok).toBe(true);
		const accts = await gh.listAccounts();
		const outside = find(accts, (a) => a.username === 'dok-dev');
		expect(outside.raw.role).toBe('outside_collaborator');
		expect(outside.displayName).toBe('Dana O.');
		expect(gh.actionsFor(outside)).toEqual(['github.remove_outside_collaborator']);
		const member = find(accts, (a) => a.username === 'lbrandt');
		expect(member.emails).toEqual(['leo.brandt@northwind.example']);
		expect(gh.actionsFor(member)).toEqual(['github.remove_member']);
		const orgInv = find(accts, (a) => a.kind === 'invitation' && !a.parentExternalId);
		expect(orgInv.emails).toEqual(['dokafor.dev@proton.example']);
		expect(gh.actionsFor(orgInv)).toEqual(['github.cancel_invitation']);
		const repoInv = find(accts, (a) => a.kind === 'invitation' && !!a.parentExternalId);
		expect(repoInv.parentExternalId).toBe('northwind-labs/infra');
		expect(repoInv.username).toBe('dok-dev');
		expect(gh.actionsFor(repoInv)).toEqual(['github.cancel_repo_invitation']);

		for (const a of [outside, member, orgInv, repoInv]) await runLoop(gh, a);
		const after = await gh.listAccounts();
		expect(after.some((a) => a.username === 'dok-dev')).toBe(false);
		expect(after.some((a) => a.username === 'lbrandt')).toBe(false);
		expect(after.filter((a) => a.kind === 'invitation')).toHaveLength(0);
		expect(await gh.getAccount(orgInv)).toBeNull();
		// a second revoke of something already gone is not an error
		expect((await gh.revoke(orgInv, 'github.cancel_invitation')).ok).toBe(true);
	});

	it('follows Link-header pagination', async () => {
		const profiles = Array.from({ length: 130 }, (_, i) => ({ login: `user${i}`, name: `User ${i}` }));
		await admin('/__admin/github/seed', { profiles, members: profiles.map((p) => p.login) });
		const gh = createConnector('github', cfg().github, opts);
		const accts = await gh.listAccounts();
		expect(accts.filter((a) => a.kind === 'user')).toHaveLength(130);
		const members = accts[0].raw;
		expect(members).toBeTruthy();
	});

	it('rejects a wrong token with 401', async () => {
		const gh = createConnector('github', { ...cfg().github, token: 'bad' }, opts);
		const h = await gh.test();
		expect(h.ok).toBe(false);
		expect(h.message).toContain('401');
	});
});

describe('vultr', () => {
	it('revokes and verifies every Vultr action kind', async () => {
		await seedVultr(cfg().vultr, ctx());
		const v = createConnector('vultr', cfg().vultr, opts);
		const h = await v.test();
		expect(h.ok).toBe(true);
		const accts = await v.listAccounts();

		const inst = find(accts, (a) => a.kind === 'instance');
		expect(inst.username).toBe('dana');
		expect(inst.displayName).toBe('build-runner-02');
		expect(inst.emails).toEqual([]);
		expect(inst.raw).toMatchObject({ plan: 'vc2-1c-0.5gb', monthly_cost: 2.5, region: 'ewr', power_status: 'running', label: 'build-runner-02', hostname: 'build-runner-02' });
		expect(inst.raw.tags).toEqual(expect.arrayContaining(['owner:dana']));
		expect(v.actionsFor(inst)).toEqual(['vultr.halt_instance', 'vultr.snapshot_instance']);

		const user = find(accts, (a) => a.username === 'dana-ci');
		expect(user.kind).toBe('service');
		const key = find(accts, (a) => a.kind === 'apikey' && a.parentExternalId === user.externalId);
		expect(key.displayName).toBe('dana-ci-deploy');

		// suspend
		const [s] = await runLoop(v, user);
		expect(s.r.output?.method).toBe('suspend');
		expect(s.v.observed).toContain('suspended-users');
		expect(find(await v.listAccounts(), (a) => a.externalId === user.externalId).active).toBe(false);

		// api key
		await runLoop(v, key);
		expect((await v.listAccounts()).some((a) => a.kind === 'apikey' && a.externalId === key.externalId)).toBe(false);

		// halt + snapshot (pending first, then complete with a size)
		const halt = await v.revoke(inst, 'vultr.halt_instance');
		expect(halt.ok).toBe(true);
		expect((await v.verify(inst, 'vultr.halt_instance')).confirmed).toBe(true);
		const snap = await v.revoke(inst, 'vultr.snapshot_instance');
		expect(snap.ok).toBe(true);
		const snapshotId = String(snap.output?.snapshotId);
		expect(snapshotId).toBeTruthy();
		const pending = await v.verify(inst, 'vultr.snapshot_instance', { snapshotId });
		expect(pending).toMatchObject({ confirmed: false, pending: true });
		await new Promise((r) => setTimeout(r, 400));
		const done = await v.verify(inst, 'vultr.snapshot_instance', { snapshotId });
		expect(done.confirmed).toBe(true);
		expect(done.output?.compressedSizeBytes).toBeGreaterThan(0);
		expect(done.output?.snapshotMonthlyCostUsd).toBe(snapshotMonthlyCost(Number(done.output?.compressedSizeBytes)));

		// destroy after approval
		const d = await v.revoke(inst, 'vultr.destroy_instance');
		expect(d.ok).toBe(true);
		const dv = await v.verify(inst, 'vultr.destroy_instance');
		expect(dv.confirmed).toBe(true);
		expect(await v.getAccount(inst)).toBeNull();
	});

	it('falls back to disabling API access when suspend and key deletion are unavailable', async () => {
		await seedVultr(cfg().vultr, ctx());
		const v = createConnector('vultr', cfg().vultr, opts);
		const accts = await v.listAccounts();
		const user = find(accts, (a) => a.username === 'dana-ci');
		const key = find(accts, (a) => a.kind === 'apikey' && a.parentExternalId === user.externalId);
		await admin('/__admin/vultr/features', { suspend: false, apikeys: false });

		const fresh = createConnector('vultr', cfg().vultr, opts); // no cached org id
		const sus = await fresh.revoke(user, 'vultr.suspend_user');
		expect(sus.ok).toBe(true);
		expect(sus.output?.method).toBe('api_disabled');
		expect(String(sus.output?.note)).toContain('api_enabled: false');
		const sv = await fresh.verify(user, 'vultr.suspend_user');
		expect(sv.confirmed).toBe(true);
		expect(sv.observed).toContain('API access disabled');

		const kdel = await fresh.revoke(key, 'vultr.delete_api_key');
		expect(kdel.ok).toBe(true);
		expect(kdel.output?.method).toBe('api_disabled');
		expect((await fresh.verify(key, 'vultr.delete_api_key')).confirmed).toBe(true);
	});

	it('rejects a wrong key with 401', async () => {
		const v = createConnector('vultr', { ...cfg().vultr, apiKey: 'nope' }, opts);
		const h = await v.test();
		expect(h.ok).toBe(false);
		expect(h.message).toContain('401');
	});

	it('computes snapshot storage cost on compressed size', () => {
		expect(snapshotMonthlyCost(3_221_225_472)).toBeCloseTo(0.1611, 4);
		expect(snapshotMonthlyCost(10, 'gb')).toBe(0.5);
		expect(snapshotMonthlyCost(0)).toBe(0);
	});
});

describe('http wrapper', () => {
	const make = (extra: Partial<ConstructorParameters<typeof HttpClient>[2]> = {}) => new HttpClient(`${mock.url}/github`, { authorization: `Bearer ${MOCK_CREDENTIALS.github.token}` }, { retryBaseMs: 1, ...extra });

	it('records method, path without query/host, status and timing', async () => {
		const calls: ApiCallRecord[] = [];
		const r = await make().request(calls, { path: '/orgs/northwind-labs', query: { secret: 'abc' } });
		expect(r.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'GET', endpoint: '/github/orgs/northwind-labs', status: 200 });
		expect(calls[0].ms).toBeGreaterThanOrEqual(0);
	});

	it('retries 429 honouring Retry-After, and classifies exhausted 5xx as retryable', async () => {
		const calls: ApiCallRecord[] = [];
		await admin('/__admin/fail', { status: 429, retryAfter: 0, count: 1 });
		const ok = await make().request(calls, { path: '/orgs/northwind-labs' });
		expect(ok.ok).toBe(true);
		expect(calls.map((c) => c.status)).toEqual([429, 200]);

		const calls2: ApiCallRecord[] = [];
		await admin('/__admin/fail', { status: 503, count: 5 });
		const bad = await make().request(calls2, { path: '/orgs/northwind-labs' });
		expect(bad).toMatchObject({ ok: false, status: 503, retryable: true });
		expect(calls2).toHaveLength(3); // 1 + 2 retries
		mock.reset();
	});

	it('does not retry a non-idempotent POST on 5xx, and 4xx is never retryable', async () => {
		const calls: ApiCallRecord[] = [];
		await admin('/__admin/fail', { status: 500, count: 1 });
		const r = await make().request(calls, { method: 'POST', path: '/orgs/northwind-labs/invitations', json: { email: 'a@b.example' } });
		expect(r).toMatchObject({ status: 500, retryable: true });
		expect(calls).toHaveLength(1);
		const r2 = await make().request([], { path: '/orgs/nope' });
		expect(r2).toMatchObject({ status: 404, retryable: false });
		const r3 = await make().request([], { method: 'POST', path: '/orgs/northwind-labs/invitations', json: {} });
		expect(r3).toMatchObject({ status: 422, retryable: false });
	});

	it('treats network failure as retryable status 0 and surfaces long Retry-After without sleeping', async () => {
		const down = new HttpClient('http://127.0.0.1:1', {}, { retryBaseMs: 1, maxRetries: 1 });
		const calls: ApiCallRecord[] = [];
		const r = await down.request(calls, { path: '/x' });
		expect(r).toMatchObject({ status: 0, retryable: true });
		expect(calls).toHaveLength(2);

		await admin('/__admin/fail', { status: 429, retryAfter: 120, count: 1 });
		const calls2: ApiCallRecord[] = [];
		const long = await make().request(calls2, { path: '/orgs/northwind-labs' });
		expect(long).toMatchObject({ status: 429, retryable: true, retryAfterMs: 120_000 });
		expect(calls2).toHaveLength(1);
	});

	it('surfaces failed revokes as retryable ActionResults', async () => {
		await seedKeycloak(cfg().keycloak, ctx());
		const kc = createConnector('keycloak', cfg().keycloak, opts);
		const dana = find(await kc.listAccounts(), (a) => a.username === 'dana.okafor');
		await admin('/__admin/fail', { status: 503, count: 10 });
		const r = await kc.revoke(dana, 'keycloak.disable');
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		mock.reset();
	});
});
