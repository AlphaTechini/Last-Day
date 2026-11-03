import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '#lib/types.ts';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://lastday:lastday@localhost:5432/postgres';
const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, '/lastday_test');

// Must be set before the db module is first imported.
process.env.DATABASE_URL = TEST_URL;
process.env.MASTER_KEY ??= 'test-master-key-0123456789';

let ok = true;
let sql: typeof import('#lib/server/db/index.ts').sql;

beforeAll(async () => {
	const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
	try {
		const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = 'lastday_test'`;
		if (!exists) await admin.unsafe('CREATE DATABASE lastday_test');
	} catch (err) {
		ok = false;
		console.warn('Postgres not available; skipping integration test:', (err as Error).message);
	} finally {
		await admin.end({ timeout: 2 });
	}
	if (!ok) return;
	({ sql } = await import('#lib/server/db/index.ts'));
	const { migrate } = await import('#lib/server/db/migrate.ts');
	await migrate({ log: () => {}, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv });
	await sql`TRUNCATE employees, app_users, connections, runs, audit_log CASCADE`;
});

afterAll(async () => {
	if (ok) await sql.end({ timeout: 2 });
});

const admin: SessionUser = { id: 'x', email: 'a@x.co', name: 'Admin', role: 'admin', employeeId: null };

describe('read models', () => {
	it('migrations are idempotent', async () => {
		if (!ok) return;
		const { migrate } = await import('#lib/server/db/migrate.ts');
		const r = await migrate({ log: () => {}, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv });
		expect(r.applied).toEqual([]);
	});

	it('maps a run fixture to RunDetail', async () => {
		if (!ok) return;
		const { getRunDetail, listRuns } = await import('#lib/server/queries/runs.ts');
		const { getDashboard } = await import('#lib/server/queries/dashboard.ts');
		const { listUnknownAccounts } = await import('#lib/server/queries/unknown.ts');
		const { listConnectionCards } = await import('#lib/server/queries/connections.ts');
		const { listAudit } = await import('#lib/server/queries/audit.ts');
		const { listEmployees, listEmployeeAccounts } = await import('#lib/server/queries/employees.ts');

		const [mgr] = await sql`INSERT INTO employees (name, work_email, is_demo) VALUES ('Mia Manager', 'mia@c.co', true) RETURNING id`;
		const [emp] = await sql`INSERT INTO employees (name, work_email, manager_id, aliases, start_date, is_demo) VALUES ('Dana Okafor', 'dana@c.co', ${mgr.id}, ${['dok-dev']}, '2024-03-04', true) RETURNING id`;
		const [conn] = await sql`INSERT INTO connections (system, config_json, status) VALUES ('vultr', ${sql.json({ apiUrl: 'https://x/v2' })}, 'healthy') RETURNING id`;
		const [gh] = await sql`INSERT INTO connections (system) VALUES ('github') RETURNING id`;
		const [kc] = await sql`INSERT INTO accounts (connection_id, system, external_id, kind, username, emails) VALUES (${gh.id}, 'github', 'g1', 'user', 'dok-dev', ${['dana.o@gmail.com']}) RETURNING id`;
		const [srv] = await sql`INSERT INTO accounts (connection_id, system, external_id, kind, display_name, raw_json)
			VALUES (${conn.id}, 'vultr', 'i1', 'instance', 'build-runner-02', ${sql.json({ plan: 'vc2-1c-1gb', monthly_cost: 5, region: 'ewr', power_status: 'stopped' })}) RETURNING id`;
		const [unk] = await sql`INSERT INTO accounts (connection_id, system, external_id, kind, username) VALUES (${gh.id}, 'github', 'g2', 'user', 'mystery') RETURNING id`;
		await sql`INSERT INTO account_links (account_id, employee_id, link_method, confidence, evidence_json, confirmed) VALUES (${kc.id}, ${emp.id}, 'ai', 0.91, ${sql.json(['display name matches'])}, true)`;
		await sql`INSERT INTO ai_suggestions (account_id, employee_id, confidence, evidence_json, model) VALUES (${unk.id}, ${emp.id}, 0.4, ${sql.json(['weak'])}, 'glm-5.3-flash')`;
		const [run] = await sql`INSERT INTO runs (employee_id, status, started_at, verified_at, ai_cost_usd) VALUES (${emp.id}, 'verified', '2026-01-01T00:00:00Z', '2026-01-01T00:00:42Z', 0.0012) RETURNING id`;
		await sql`INSERT INTO run_items (run_id, account_id, match_kind, link_method, confidence, evidence_json, steps_json, status, verified_state, sort_order)
			VALUES (${run.id}, ${kc.id}, 'probable', 'ai', 0.91, ${sql.json(['display name matches'])}, ${sql.json([{ action: 'github.remove', label: 'Remove from org', status: 'done', endpoint: 'DELETE /orgs/x/memberships/dok-dev', httpStatus: 204, at: '2026-01-01T00:00:10Z' }])}, 'verified', 'not a member', 0)`;
		await sql`INSERT INTO run_items (run_id, account_id, match_kind, status, steps_json, snapshot_id, snapshot_cost_usd_month, still_billing_usd_month, sort_order)
			VALUES (${run.id}, ${srv.id}, 'server', 'awaiting_manager', '[]', 'snap1', 0.05, 5, 1)`;
		await sql`INSERT INTO approvals (run_id, scope, item_ids) VALUES (${run.id}, 'hr_revoke', ${[kc.id]})`;
		await sql`INSERT INTO ai_calls (run_id, requested_model, prompt_tokens, completion_tokens) VALUES (${run.id}, 'glm-5.3-flash', 100, 20)`;
		await sql`INSERT INTO rechecks (run_id, due_at, status, result_json, fired_at) VALUES (${run.id}, now(), 'regressed', ${sql.json({ diff: [{ itemId: 'i', label: 'GitHub', observed: 'member: true' }] })}, now())`;
		await sql`INSERT INTO audit_log (actor_name, run_id, employee_id, system, kind, summary, detail_json) VALUES ('Admin', ${run.id}, ${emp.id}, 'github', 'api_call', 'DELETE membership', ${sql.json({ method: 'DELETE', status: 204 })})`;

		const detail = await getRunDetail(run.id, admin);
		expect(detail).not.toBeNull();
		expect(detail).toMatchObject({
			id: run.id,
			employeeName: 'Dana Okafor',
			status: 'verified',
			aiCostUsd: 0.0012,
			itemCount: 2,
			verifiedCount: 2,
			canApprove: true,
			canDestroy: true,
			stats: { foundByRules: 0, foundByAi: 1, servers: 1, secondsToGreen: 42, aiCalls: 1, aiTokens: 120 },
			employee: { name: 'Dana Okafor', managerName: 'Mia Manager', managerId: mgr.id, aliases: ['dok-dev'], startDate: '2024-03-04', accountCount: 1, systems: ['github'] },
			recheckResult: { status: 'regressed', diff: [{ itemId: 'i', label: 'GitHub', observed: 'member: true' }] }
		});
		expect(detail!.items).toHaveLength(2);
		expect(detail!.items[0]).toMatchObject({ matchKind: 'probable', status: 'verified', verifiedState: 'not a member', account: { system: 'github', linkMethod: 'ai', confidence: 0.91, evidence: ['display name matches'] } });
		expect(detail!.items[0].actions[0]).toMatchObject({ action: 'github.remove', status: 'done', httpStatus: 204, at: '2026-01-01T00:00:10.000Z' });
		expect(detail!.items[1]).toMatchObject({ matchKind: 'server', snapshotId: 'snap1', snapshotCostUsdMonth: 0.05, stillBillingUsdMonth: 5, account: { kind: 'instance', plan: 'vc2-1c-1gb', monthlyCostUsd: 5, region: 'ewr', powerStatus: 'stopped' } });
		expect(detail!.approvals).toHaveLength(1);
		expect(detail!.approvals[0]).toMatchObject({ scope: 'hr_revoke', itemCount: 1 });

		// manager of the leaver may destroy, but not approve
		const managerUser: SessionUser = { id: 'm', email: 'm', name: 'Mia', role: 'manager', employeeId: mgr.id };
		const asManager = await getRunDetail(run.id, managerUser);
		expect(asManager).toMatchObject({ canApprove: false, canDestroy: true });
		const otherManager = await getRunDetail(run.id, { ...managerUser, employeeId: emp.id });
		expect(otherManager!.canDestroy).toBe(false);

		expect((await listRuns())[0].id).toBe(run.id);

		const dash = await getDashboard(admin);
		expect(dash.isDemo).toBe(true);
		expect(dash.stats).toMatchObject({ employees: 2, openRuns: 0, needsAttention: 0, unknownAccounts: 2, monthlyServerSpendUsd: 5 });
		expect(dash.pendingDestroys).toEqual([{ runId: run.id, itemId: expect.any(String), employeeName: 'Dana Okafor', serverLabel: 'build-runner-02', stillBillingUsdMonth: 5, snapshotCostUsdMonth: 0.05 }]);
		expect(dash.connections).toHaveLength(4);
		expect(dash.recentActivity[0].summary).toBe('DELETE membership');
		expect((await getDashboard(managerUser)).pendingDestroys).toHaveLength(1);
		expect((await getDashboard({ ...managerUser, employeeId: emp.id })).pendingDestroys).toHaveLength(0);

		const unknown = await listUnknownAccounts();
		expect(unknown).toHaveLength(2); // the unlinked instance counts too
		expect(unknown.find((a) => a.username === 'mystery')).toMatchObject({ username: 'mystery', flag: 'unlinked', aiSuggestion: { employeeName: 'Dana Okafor', confidence: 0.4, evidence: ['weak'] } });

		const cards = await listConnectionCards(admin);
		expect(cards.map((c) => c.system)).toEqual(['keycloak', 'mattermost', 'github', 'vultr']);
		expect(cards.find((c) => c.system === 'keycloak')).toMatchObject({ id: null, status: 'not_configured', hasSecret: false, accountCount: 0 });
		expect(cards.find((c) => c.system === 'vultr')).toMatchObject({ status: 'healthy', accountCount: 1, config: { apiUrl: 'https://x/v2' }, canEdit: true });
		expect(JSON.stringify(cards)).not.toContain('ciphertext');

		const audit = await listAudit({ system: 'github', runId: run.id }, 1);
		expect(audit.total).toBe(1);
		expect(audit.entries[0]).toMatchObject({ actor: 'Admin', employeeName: 'Dana Okafor', system: 'github', kind: 'api_call', detail: { method: 'DELETE', status: 204 } });
		expect((await listAudit({ runId: 'not-a-uuid' }, 1)).total).toBeGreaterThan(0); // invalid filter ignored

		const employees = await listEmployees();
		expect(employees.find((e) => e.name === 'Dana Okafor')).toMatchObject({ managerName: 'Mia Manager', accountCount: 1 });
		expect(await listEmployeeAccounts(emp.id)).toHaveLength(1);
	});
});
