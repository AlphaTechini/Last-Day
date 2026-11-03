// Seed test against the dev sandbox and its own throwaway database (lastday_test_demo), so it cannot collide with
// other integration tests that truncate lastday_test.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_CREDENTIALS, MOCK_REPOS, startMock, type MockServer } from '../../../../scripts/mock-company/server.ts';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://lastday:lastday@localhost:5432/postgres';
const DB = 'lastday_test_demo';
process.env.MASTER_KEY ??= 'test-master-key-0123456789';

let ok = true;
let mock: MockServer;
let sql: postgres.Sql;
const env = { NODE_ENV: 'test', DEMO_EMAIL_DOMAIN: 'northwind.example' } as NodeJS.ProcessEnv;

beforeAll(async () => {
	const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
	try {
		const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB}`;
		if (!exists) await admin.unsafe(`CREATE DATABASE ${DB}`);
	} catch (err) {
		ok = false;
		console.warn('Postgres not available; skipping demo seed test:', (err as Error).message);
	} finally {
		await admin.end({ timeout: 2 });
	}
	if (!ok) return;
	mock = await startMock({ port: 0, latency: 0, snapshotMs: 100 });
	sql = postgres(ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`), { max: 4, onnotice: () => {} });
	const { migrate } = await import('#lib/server/db/migrate.ts');
	await migrate({ sql, log: () => {}, bootstrap: false });
	await sql`TRUNCATE employees, app_users, connections CASCADE`;
	const { encryptJson } = await import('#lib/server/crypto.ts');
	const rows = [
		['keycloak', { baseUrl: `${mock.url}/keycloak`, realm: 'company', clientId: 'last-day' }, { clientSecret: MOCK_CREDENTIALS.keycloak.clientSecret }],
		['mattermost', { baseUrl: `${mock.url}/mattermost` }, { token: MOCK_CREDENTIALS.mattermost.token }],
		['github', { apiUrl: `${mock.url}/github`, org: 'northwind-labs', repos: MOCK_REPOS.slice(0, 2).join(',') }, { token: MOCK_CREDENTIALS.github.token }],
		['vultr', { apiUrl: `${mock.url}/vultr/v2` }, { apiKey: MOCK_CREDENTIALS.vultr.apiKey }]
	] as const;
	for (const [system, config, secrets] of rows) {
		await sql`INSERT INTO connections (system, config_json, credential_ciphertext) VALUES (${system}, ${sql.json(config)}, ${encryptJson(secrets)})`;
	}
});

afterAll(async () => {
	if (!ok) return;
	await sql.end({ timeout: 2 });
	await mock.close();
});

describe('seedDemoCompany', () => {
	it('seeds employees, app users and every target system, and is idempotent', async () => {
		if (!ok) return;
		const { seedDemoCompany } = await import('./seed.ts');
		const { loadAllConnectors, loadConnector } = await import('#lib/server/connectors/index.ts');
		await seedDemoCompany({ sql, env, log: () => {} });
		await seedDemoCompany({ sql, env, log: () => {} });

		const emps = await sql`SELECT e.name, e.status, e.is_demo, e.aliases, m.name AS manager FROM employees e LEFT JOIN employees m ON m.id = e.manager_id`;
		expect(emps).toHaveLength(30);
		expect(emps.every((e) => e.is_demo && e.status === 'active')).toBe(true);
		const dana = emps.find((e) => e.name === 'Dana Okafor')!;
		expect(dana.manager).toBe('Priya Raman');
		expect(dana.aliases).toContain('dana.o@gmail.example');
		const users = await sql`SELECT email, role, employee_id FROM app_users ORDER BY role`;
		expect(users.map((u) => u.role)).toEqual(['hr', 'manager']);
		expect(users[0].email).toBe('hr@northwind.example');
		expect(users[1].employee_id).not.toBeNull();

		const connectors = await loadAllConnectors({ db: sql, retryBaseMs: 1, verifyPollMs: 0 });
		expect(connectors.map((c) => c.system)).toEqual(['keycloak', 'mattermost', 'github', 'vultr']);
		const counts: Record<string, number> = {};
		for (const c of connectors) {
			expect((await c.test()).ok).toBe(true);
			const accts = await c.listAccounts();
			counts[c.system] = accts.length;
		}
		expect(counts).toEqual({ keycloak: 30, mattermost: 32, github: 12, vultr: 5 });

		// An offboarded demo company is brought back: disabled users re-enabled, deactivated users reactivated, leftovers re-created.
		const kc = (await loadConnector('keycloak', { db: sql, retryBaseMs: 1 }))!;
		const mm = (await loadConnector('mattermost', { db: sql, retryBaseMs: 1 }))!;
		const gh = (await loadConnector('github', { db: sql, retryBaseMs: 1 }))!;
		const vu = (await loadConnector('vultr', { db: sql, retryBaseMs: 1, verifyPollMs: 0 }))!;
		for (const c of [kc, mm, gh, vu]) {
			for (const a of await c.listAccounts()) {
				if (/dana|dok|build-runner|proton/i.test(JSON.stringify([a.username, a.displayName, a.emails, a.raw.label]))) {
					for (const action of c.actionsFor(a)) await c.revoke(a, action);
				}
			}
		}
		await sql`UPDATE employees SET status = 'offboarded' WHERE name = 'Dana Okafor'`;
		await seedDemoCompany({ sql, env, log: () => {} });
		const [d] = await sql`SELECT status FROM employees WHERE name = 'Dana Okafor'`;
		expect(d.status).toBe('active');
		const after = { keycloak: await kc.listAccounts(), mattermost: await mm.listAccounts(), github: await gh.listAccounts(), vultr: await vu.listAccounts() };
		expect(after.keycloak.find((a) => a.username === 'dana.okafor')?.active).toBe(true);
		expect(after.mattermost.find((a) => a.username === 'dok')?.active).toBe(true);
		expect(after.github.find((a) => a.username === 'dok-dev' && a.kind === 'user')).toBeTruthy();
		expect(after.github.some((a) => a.kind === 'invitation' && a.emails.includes('dokafor.dev@proton.example'))).toBe(true);
		expect(after.vultr.find((a) => a.username === 'dana-ci')?.active).toBe(true);
		expect(after.vultr.some((a) => a.kind === 'apikey' && a.displayName === 'dana-ci-deploy')).toBe(true);
		expect(after.vultr.find((a) => a.kind === 'instance')?.active).toBe(true);
		expect(after.vultr.filter((a) => a.kind === 'instance')).toHaveLength(1);
	});

	it('does not touch runs or accounts tables, and leaves non-demo employees alone', async () => {
		if (!ok) return;
		const { seedDemoCompany } = await import('./seed.ts');
		await sql`INSERT INTO employees (name, work_email, role, is_demo) VALUES ('Real Person', 'priya.raman@northwind.example', 'Keeper', false) ON CONFLICT (work_email) DO UPDATE SET is_demo = false, name = 'Real Person'`;
		await seedDemoCompany({ sql, env, log: () => {}, systems: [] });
		const [row] = await sql`SELECT name, is_demo FROM employees WHERE work_email = 'priya.raman@northwind.example'`;
		expect(row).toMatchObject({ name: 'Real Person', is_demo: false });
	});
});
