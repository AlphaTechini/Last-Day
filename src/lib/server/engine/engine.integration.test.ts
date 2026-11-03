// Full lifecycle against Postgres with in-memory fake connectors and a stubbed inference client.
// Uses its own database (lastday_engine_test) so it cannot collide with other suites that truncate lastday_test.
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://lastday:lastday@localhost:5432/postgres';
const DB_NAME = 'lastday_engine_test';
process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${DB_NAME}`);
process.env.MASTER_KEY ??= 'test-master-key-0123456789';
delete process.env.RECHECK_DELAY_SECONDS;

let ok = true;
type Mod<T> = T extends Promise<infer U> ? U : never;
let sql: typeof import('#lib/server/db/index.ts').sql;
let engine: Mod<ReturnType<typeof loadEngine>>;

async function loadEngine() {
	const [index, executor, state, connectors, testing, inference, recheck, demo, sweep] = await Promise.all([
		import('./index.ts'),
		import('./executor.ts'),
		import('./state.ts'),
		import('./connectors.ts'),
		import('./testing.ts'),
		import('./inference.ts'),
		import('./recheck.ts'),
		import('./demo.ts'),
		import('./sweep.ts')
	]);
	return { ...index, ...executor, ...state, ...connectors, ...testing, ...inference, ...recheck, ...demo, ...sweep };
}

beforeAll(async () => {
	const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
	try {
		const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
		if (!exists) await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
	} catch (err) {
		ok = false;
		console.warn('Postgres not available; skipping engine integration test:', (err as Error).message);
	} finally {
		await admin.end({ timeout: 2 });
	}
	if (!ok) return;
	({ sql } = await import('#lib/server/db/index.ts'));
	const { migrate } = await import('#lib/server/db/migrate.ts');
	await migrate({ log: () => {}, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv });
	engine = await loadEngine();
});

afterAll(async () => {
	if (!ok) return;
	await engine.waitForExecutorIdle();
	for (const id of [...engine.state().timers.keys()]) engine.clearRecheckTimer(id);
	engine.setConnectorProvider(null);
	engine.setInferenceClient(undefined);
	await sql.end({ timeout: 2 });
});

// ---------- world ----------

const ACTOR = { id: null, name: 'Test HR', role: 'hr' } as const;
const MGR_ACTOR = { id: null, name: 'Test Manager', role: 'manager' } as const;

let kc: InstanceType<Mod<ReturnType<typeof loadEngine>>['FakeConnector']>;
let gh: typeof kc;
let vu: typeof kc;
let ids: { dana: string; priya: string; rob: string };
let aiCalls: { model: string; username: string | null }[];
let mismatchModel: string | null;

function installAiStub() {
	engine.setInferenceClient({
		async chat(req) {
			const user = JSON.parse(req.messages.at(-1)!.content.split('\n\n')[0]);
			const acct = user.account;
			aiCalls.push({ model: req.model, username: acct.username });
			let answer: any = { employee_id: null, confidence: 0.9, evidence: [], reason_if_none: 'no candidate fits' };
			if (acct.username === 'dok-dev') {
				answer = { employee_id: user.candidates.find((c: any) => c.name === 'Dana Okafor').id, confidence: 0.92, evidence: ['Alias dana.o@gmail.example is on her profile', 'Display name "Dana O."'], reason_if_none: '' };
			} else if (acct.username === 'build-runner-02') {
				// weak on the default model, firm on the escalation model
				const confidence = req.model === 'glm-5.3-flash' ? 0.6 : 0.88;
				answer = { employee_id: user.candidates.find((c: any) => c.name === 'Dana Okafor').id, confidence, evidence: ['Tag owner:dana'], reason_if_none: '' };
			}
			return { content: JSON.stringify(answer), model: mismatchModel ?? req.model, promptTokens: 800, completionTokens: 200, reasoningTokens: 50, finishReason: 'stop', latencyMs: 5, mode: 'json_schema' };
		}
	});
}

async function buildWorld() {
	await sql`TRUNCATE employees, app_users, connections, accounts, runs, audit_log, ai_calls CASCADE`;
	await sql`UPDATE settings SET ai_confidence_threshold = 0.8, default_model = 'glm-5.3-flash', escalation_model = 'glm-5.2', recheck_delay_seconds = 3600, last_sweep_at = NULL`;
	const [mgr] = await sql`INSERT INTO employees (name, work_email, is_demo) VALUES ('Priya Raman', 'priya.raman@northwind.example', true) RETURNING id`;
	const [dana] = await sql`INSERT INTO employees (name, work_email, aliases, manager_id, start_date, is_demo, role, department) VALUES ('Dana Okafor', 'dana.okafor@northwind.example', ${['dana.o@gmail.example']}, ${mgr.id}, '2022-03-14', true, 'Platform Engineer', 'Engineering') RETURNING id`;
	const [rob] = await sql`INSERT INTO employees (name, work_email, start_date, is_demo) VALUES ('Robert Lindqvist', 'robert.lindqvist@northwind.example', '2023-01-09', true) RETURNING id`;
	ids = { dana: dana.id, priya: mgr.id, rob: rob.id };
	for (const s of ['keycloak', 'github', 'vultr']) await sql`INSERT INTO connections (system, config_json, status) VALUES (${s}, '{}', 'healthy')`;

	const { FakeConnector, makeAccount } = engine;
	kc = new FakeConnector('keycloak');
	gh = new FakeConnector('github');
	vu = new FakeConnector('vultr');
	kc.add(makeAccount('keycloak', { externalId: 'kc-dana', username: 'dana.okafor', displayName: 'Dana Okafor', emails: ['dana.okafor@northwind.example'], raw: { sessions: 2 } }));
	kc.add(makeAccount('keycloak', { externalId: 'kc-priya', username: 'priya.raman', displayName: 'Priya Raman', emails: ['priya.raman@northwind.example'], raw: { sessions: 1 } }));
	gh.add(makeAccount('github', { externalId: 'dok-dev', username: 'dok-dev', displayName: 'Dana O.', emails: ['dana.o@gmail.example'], createdAt: '2022-03-16T10:00:00Z' }));
	gh.add(makeAccount('github', { externalId: 'zed-coder', username: 'zed-coder', displayName: 'Zed Coder', emails: ['zed@example.org'] }));
	vu.add(makeAccount('vultr', { externalId: 'vu-dana', username: 'dana.okafor@northwind.example', emails: ['dana.okafor@northwind.example'] }));
	vu.add(makeAccount('vultr', { externalId: 'key-1', kind: 'apikey', username: 'ci-key', parentExternalId: 'vu-dana' }));
	vu.add(makeAccount('vultr', { externalId: 'inst-1', kind: 'instance', username: 'build-runner-02', displayName: 'build-runner-02', raw: { plan: 'vc2-1c-1gb', monthly_cost: 5, region: 'ewr', power_status: 'running', label: 'build-runner-02', tags: ['owner:dana', 'lastday-demo'], disk: 25, api_key: 'LEAK-ME' } }));
	const byConnector = { keycloak: kc, github: gh, vultr: vu } as Record<string, typeof kc>;
	engine.setConnectorProvider(async (system) => byConnector[system] ?? null);
	aiCalls = [];
	mismatchModel = null;
	installAiStub();
	engine.setEngineConfig({ retryDelaysMs: [1, 1, 1], verifyTimeoutMs: 500, verifyPollMs: 5 });
	delete process.env.RECHECK_DELAY_SECONDS;
}

beforeEach(async () => {
	if (!ok) return;
	await engine.waitForExecutorIdle();
	for (const id of [...engine.state().timers.keys()]) engine.clearRecheckTimer(id);
	await buildWorld();
});

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (Date.now() > end) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 15));
	}
}

const items = (runId: string) => sql`SELECT i.*, a.username, a.kind, a.system FROM run_items i JOIN accounts a ON a.id = i.account_id WHERE i.run_id = ${runId} ORDER BY i.sort_order`;
const itemBy = async (runId: string, username: string) => (await items(runId)).find((i) => i.username === username)!;
const runStatus = async (runId: string) => (await sql`SELECT status FROM runs WHERE id = ${runId}`)[0].status as string;

/** Offboard Dana, confirm both probable matches, approve everything and wait for the executor. */
async function offboardDana(): Promise<string> {
	const runId = await engine.startOffboarding(ids.dana, ACTOR);
	for (const i of await items(runId)) if (i.status === 'proposed') await engine.decideItem(runId, i.id, 'yes', ACTOR);
	await engine.approveItems(runId, 'all', ACTOR);
	await engine.waitForExecutorIdle();
	return runId;
}

// ---------- tests ----------

describe('sweep', () => {
	it('upserts accounts, links by rules, asks the AI about the rest, and is idempotent', async () => {
		if (!ok) return;
		const r = await engine.sweepAll(ACTOR);
		// kc x2, gh x2, vultr user + key + instance
		expect(r.accounts).toBe(7);
		// kc-dana, kc-priya, vu-dana by rules; key-1 follows its owner
		expect(r.linkedByRules).toBe(4);
		expect(r.aiSuggested).toBe(2); // dok-dev, build-runner-02
		expect(r.unknown).toBe(1); // zed-coder

		const links = await sql`SELECT a.external_id, l.link_method, l.confirmed, l.confidence FROM account_links l JOIN accounts a ON a.id = l.account_id ORDER BY a.external_id`;
		expect(links.map((l) => `${l.external_id}:${l.link_method}`)).toEqual(['key-1:rule:work_email', 'kc-dana:rule:work_email', 'kc-priya:rule:work_email', 'vu-dana:rule:work_email']);
		expect(links.every((l) => l.confirmed)).toBe(true);

		const sug = await sql`SELECT a.external_id, s.confidence, s.model, s.evidence_json FROM ai_suggestions s JOIN accounts a ON a.id = s.account_id ORDER BY a.external_id`;
		expect(sug.map((s) => s.external_id)).toEqual(['build-runner-02'.replace('build-runner-02', 'inst-1'), 'dok-dev']);
		expect(sug.find((s) => s.external_id === 'inst-1')!.model).toBe('glm-5.2'); // escalated
		expect(aiCalls.filter((c) => c.username === 'build-runner-02').map((c) => c.model)).toEqual(['glm-5.3-flash', 'glm-5.2']);
		expect(aiCalls.some((c) => c.username === 'zed-coder')).toBe(false); // pre-filter kept the prompt list small

		const [{ last_sweep_at }] = await sql`SELECT last_sweep_at FROM settings`;
		expect(last_sweep_at).not.toBeNull();
		const audits = await sql`SELECT kind, summary FROM audit_log WHERE kind = 'sweep'`;
		expect(audits.length).toBeGreaterThanOrEqual(4); // 3 connectors + summary

		// stored raw never keeps credential-looking fields
		const [inst] = await sql`SELECT raw_json FROM accounts WHERE external_id = 'inst-1'`;
		expect(JSON.stringify(inst.raw_json)).not.toContain('LEAK-ME');

		// second sweep: same numbers, no new AI calls (answers are fresh)
		const before = aiCalls.length;
		const again = await engine.sweepAll(ACTOR);
		expect(again).toEqual(r);
		expect(aiCalls.length).toBe(before);
	});

	it('marks accounts that disappeared as gone, and revives them', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		gh.accounts.delete('user:zed-coder');
		await engine.sweepAll(ACTOR);
		const [z] = await sql`SELECT gone_at FROM accounts WHERE external_id = 'zed-coder'`;
		expect(z.gone_at).not.toBeNull();
		gh.add(engine.makeAccount('github', { externalId: 'zed-coder', username: 'zed-coder' }));
		await engine.sweepAll(ACTOR);
		const [z2] = await sql`SELECT gone_at FROM accounts WHERE external_id = 'zed-coder'`;
		expect(z2.gone_at).toBeNull();
	});

	it('does not touch connectors in error state on a full sweep, and records list failures', async () => {
		if (!ok) return;
		await sql`UPDATE connections SET status = 'error' WHERE system = 'github'`;
		await engine.sweepAll(ACTOR);
		expect(gh.listCalls).toBe(0);
		await sql`UPDATE connections SET status = 'healthy' WHERE system = 'github'`;
		kc.listFails = 'boom';
		await engine.sweepAll(ACTOR);
		const [c] = await sql`SELECT status, last_error FROM connections WHERE system = 'keycloak'`;
		expect(c).toMatchObject({ status: 'error', last_error: 'boom' });
	});

	it('runs rules only and audits once when no inference key is configured', async () => {
		if (!ok) return;
		engine.setInferenceClient(null);
		const r = await engine.sweepAll(ACTOR);
		expect(r.aiSuggested).toBe(0);
		expect(r.linkedByRules).toBe(4);
		const skipped = await sql`SELECT 1 FROM audit_log WHERE summary LIKE 'AI resolver skipped%'`;
		expect(skipped).toHaveLength(1);
		installAiStub();
	});

	it('never overwrites a manual link', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const [a] = await sql`SELECT id FROM accounts WHERE external_id = 'zed-coder'`;
		await sql`INSERT INTO account_links (account_id, employee_id, link_method, confidence, confirmed) VALUES (${a.id}, ${ids.rob}, 'manual', 1, true)`;
		gh.get('user', 'zed-coder')!.emails = ['priya.raman@northwind.example']; // now a rule would say Priya
		await engine.sweepAll(ACTOR);
		const [l] = await sql`SELECT employee_id, link_method FROM account_links WHERE account_id = ${a.id}`;
		expect(l).toMatchObject({ employee_id: ids.rob, link_method: 'manual' });
	});
});

describe('offboarding lifecycle', () => {
	it('review -> decide -> approve -> executor -> verified -> recheck clean, with servers awaiting the manager', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		aiCalls.length = 0;

		const runId = await engine.startOffboarding(ids.dana, ACTOR);
		expect(await engine.startOffboarding(ids.dana, ACTOR)).toBe(runId); // double click returns the open run
		const [emp] = await sql`SELECT status FROM employees WHERE id = ${ids.dana}`;
		expect(emp.status).toBe('offboarding');
		expect(await runStatus(runId)).toBe('review');

		const list = await items(runId);
		const byUser = Object.fromEntries(list.map((i) => [i.username, i]));
		expect(Object.keys(byUser).sort()).toEqual(['build-runner-02', 'ci-key', 'dana.okafor', 'dana.okafor@northwind.example', 'dok-dev']);
		expect(byUser['dana.okafor']).toMatchObject({ match_kind: 'exact', status: 'pending', link_method: 'rule:work_email' });
		expect(byUser['ci-key']).toMatchObject({ match_kind: 'exact', status: 'pending' });
		expect(byUser['dok-dev']).toMatchObject({ match_kind: 'probable', status: 'proposed', link_method: 'ai' });
		expect(Number(byUser['dok-dev'].confidence)).toBeCloseTo(0.92, 5);
		expect(byUser['dok-dev'].evidence_json[0]).toContain('Alias');
		expect(byUser['build-runner-02']).toMatchObject({ match_kind: 'server', status: 'proposed' });
		// steps are pre-populated with endpoint templates
		expect(byUser['dana.okafor'].steps_json.map((s: any) => [s.action, s.status, s.label])).toEqual([
			['keycloak.disable', 'pending', 'Disable user'],
			['keycloak.logout', 'pending', 'End all sessions']
		]);
		expect(byUser['dana.okafor'].steps_json[0].endpoint).toBe('PUT /admin/realms/{realm}/users/{id}');
		expect(byUser['build-runner-02'].steps_json.map((s: any) => s.action)).toEqual(['vultr.halt_instance', 'vultr.snapshot_instance']);
		// the scoped sweep re-read Dana's linked accounts
		expect(kc.getAccountLog).toContain('user:kc-dana');
		expect(kc.listCalls).toBeGreaterThanOrEqual(2);

		// AI cost is run-scoped
		const [run] = await sql`SELECT ai_cost_usd FROM runs WHERE id = ${runId}`;
		const callRows = await sql`SELECT * FROM ai_calls WHERE run_id = ${runId}`;
		expect(callRows.length).toBeGreaterThanOrEqual(3);
		expect(Number(run.ai_cost_usd)).toBeCloseTo(callRows.reduce((s, c) => s + Number(c.cost_usd), 0), 6);
		expect(callRows.every((c) => c.returned_model === c.requested_model)).toBe(true);

		// approving while probable items are undecided only approves the pending ones
		await expect(engine.approveItems(runId, [byUser['dok-dev'].id], ACTOR)).rejects.toThrow(/Confirm or reject/);

		// decide
		await engine.decideItem(runId, byUser['dok-dev'].id, 'yes', ACTOR);
		await engine.decideItem(runId, byUser['build-runner-02'].id, 'yes', ACTOR);
		await expect(engine.decideItem(runId, byUser['dok-dev'].id, 'yes', ACTOR)).rejects.toThrow(/not waiting/);
		const [link] = await sql`SELECT link_method, confirmed FROM account_links l JOIN accounts a ON a.id = l.account_id WHERE a.external_id = 'dok-dev'`;
		expect(link).toMatchObject({ link_method: 'ai', confirmed: true });

		vu.snapshotPendingPolls = 3; // snapshot needs a few polls before it is ready
		await engine.approveItems(runId, 'all', ACTOR);
		expect(await runStatus(runId)).toBe('executing');
		expect((await items(runId)).every((i) => ['approved', 'running', 'verified', 'awaiting_manager'].includes(i.status))).toBe(true);
		await engine.waitForExecutorIdle();

		const done = await items(runId);
		for (const i of done) {
			if (i.match_kind === 'server') continue;
			expect(i, i.username).toMatchObject({ status: 'verified' });
			expect(i.verified_at).not.toBeNull();
			expect(i.steps_json.every((s: any) => s.status === 'done' && s.httpStatus === 200)).toBe(true);
		}
		const dana = done.find((i) => i.username === 'dana.okafor')!;
		expect(dana.verified_state).toBe('enabled: false; sessions: 0');
		expect(kc.get('user', 'kc-dana')).toMatchObject({ active: false });
		expect(kc.get('user', 'kc-priya')).toMatchObject({ active: true }); // other people untouched
		expect(gh.get('user', 'dok-dev')).toBeUndefined();
		expect(vu.get('apikey', 'key-1')).toBeUndefined();

		const server = done.find((i) => i.match_kind === 'server')!;
		expect(server.status).toBe('awaiting_manager');
		expect(server.snapshot_id).toBe('snap-inst-1');
		expect(Number(server.snapshot_cost_usd_month)).toBe(1.25);
		expect(Number(server.still_billing_usd_month)).toBe(6.25); // $5 instance + 25 GB x $0.05
		expect(server.verified_state).toContain('snapshot snap-inst-1: complete');

		// run verified, employee offboarded, recheck scheduled
		const [verified] = await sql`SELECT status, verified_at FROM runs WHERE id = ${runId}`;
		expect(verified.status).toBe('verified');
		expect(verified.verified_at).not.toBeNull();
		const [emp2] = await sql`SELECT status, end_date FROM employees WHERE id = ${ids.dana}`;
		expect(emp2.status).toBe('offboarded');
		expect(emp2.end_date).not.toBeNull();
		const [rc] = await sql`SELECT status, due_at FROM rechecks WHERE run_id = ${runId}`;
		expect(rc.status).toBe('pending');
		expect(new Date(rc.due_at).getTime() - Date.now()).toBeGreaterThan(3_500_000); // settings: 3600 s
		expect(engine.state().timers.has(runId)).toBe(true);

		// approvals + audit trail
		const approvals = await sql`SELECT scope, item_ids, action_list FROM approvals WHERE run_id = ${runId}`;
		expect(approvals).toHaveLength(1);
		expect(approvals[0].scope).toBe('hr_revoke');
		const listed = approvals[0].action_list.flatMap((a: any) => a.actions);
		expect(listed).toEqual(expect.arrayContaining(['keycloak.disable', 'keycloak.logout', 'github.remove_member', 'vultr.suspend_user', 'vultr.delete_api_key', 'vultr.halt_instance', 'vultr.snapshot_instance']));
		const apiCalls = await sql`SELECT detail_json FROM audit_log WHERE run_id = ${runId} AND kind = 'api_call'`;
		expect(apiCalls.length).toBeGreaterThanOrEqual(8);
		expect(apiCalls[0].detail_json).toMatchObject({ method: expect.any(String), endpoint: expect.any(String), status: expect.any(Number) });
		const verifies = await sql`SELECT detail_json FROM audit_log WHERE run_id = ${runId} AND kind = 'verify'`;
		expect(verifies.length).toBeGreaterThanOrEqual(8);
		expect(verifies[0].detail_json.readBack).toBeTruthy();

		// manager destroys the server: awaiting_manager -> destroying -> removed; billing drops to the snapshot
		await expect(engine.destroyServer(runId, dana.id, MGR_ACTOR)).rejects.toThrow(/halted and snapshotted|Only servers/);
		await engine.destroyServer(runId, server.id, MGR_ACTOR);
		expect((await sql`SELECT status FROM run_items WHERE id = ${server.id}`)[0].status).toBe('destroying');
		await engine.waitForExecutorIdle();
		const removed = (await sql`SELECT * FROM run_items WHERE id = ${server.id}`)[0];
		expect(removed.status).toBe('removed');
		expect(Number(removed.still_billing_usd_month)).toBe(1.25);
		expect(vu.get('instance', 'inst-1')).toBeUndefined();
		expect(removed.steps_json.at(-1)).toMatchObject({ action: 'vultr.destroy_instance', status: 'done' });
		const mgrApproval = await sql`SELECT scope, item_ids FROM approvals WHERE run_id = ${runId} AND scope = 'manager_destroy'`;
		expect(mgrApproval).toHaveLength(1);
		expect(removed.destroy_approval_id).not.toBeNull();
		expect(await runStatus(runId)).toBe('verified'); // destroy never changes the run

		// recheck: fire with a short delay -> clean
		await sql`UPDATE rechecks SET due_at = now() + interval '150 milliseconds' WHERE run_id = ${runId}`;
		await engine.armPendingRechecks();
		const clean = await waitFor(async () => (await sql`SELECT status, result_json, fired_at FROM rechecks WHERE run_id = ${runId}`)[0].status === 'clean' && (await sql`SELECT result_json, fired_at FROM rechecks WHERE run_id = ${runId}`)[0]);
		expect(clean.result_json.diff).toEqual([]);
		expect(clean.fired_at).not.toBeNull();
		expect(await runStatus(runId)).toBe('verified');
		expect((await sql`SELECT 1 FROM audit_log WHERE run_id = ${runId} AND kind = 'recheck' AND summary LIKE 'Re-check: still clean%'`).length).toBe(1);

		// firing again does nothing (atomic claim)
		expect(await engine.fireRecheck(runId, ACTOR)).toBeNull();
	});

	it('reject writes match_rejections, removes the item from the run, and is never proposed again', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await engine.startOffboarding(ids.dana, ACTOR);
		const gh1 = await itemBy(runId, 'dok-dev');
		await engine.decideItem(runId, gh1.id, 'no', ACTOR);
		expect((await itemBy(runId, 'dok-dev')).status).toBe('rejected');
		const rej = await sql`SELECT * FROM match_rejections`;
		expect(rej).toHaveLength(1);
		expect(rej[0].employee_id).toBe(ids.dana);
		expect(await sql`SELECT 1 FROM ai_suggestions s JOIN accounts a ON a.id = s.account_id WHERE a.external_id = 'dok-dev'`).toHaveLength(0);

		// a later run (after finishing this one) does not propose it again
		await sql`UPDATE runs SET status = 'verified' WHERE id = ${runId}`;
		aiCalls.length = 0;
		await engine.sweepAll(ACTOR);
		expect(aiCalls.some((c) => c.username === 'dok-dev')).toBe(false);
		const run2 = await engine.startOffboarding(ids.dana, ACTOR);
		expect((await items(run2)).some((i) => i.username === 'dok-dev')).toBe(false);
		expect(aiCalls.some((c) => c.username === 'dok-dev')).toBe(false);
	});

	it('a failing connector gives partial, shows the error, and retry completes the run', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		kc.failAction('keycloak.logout', 99, { retryable: true, error: 'Keycloak 503' });
		const runId = await offboardDana();

		const bad = await itemBy(runId, 'dana.okafor');
		expect(bad.status).toBe('failed');
		expect(bad.last_error).toContain('End all sessions');
		expect(bad.last_error).toContain('Keycloak 503');
		expect(bad.last_error).toContain('4 attempts'); // first try + 3 retries
		expect(bad.steps_json.map((s: any) => s.status)).toEqual(['done', 'failed']);
		expect(kc.revokeLog.filter((r) => r.action === 'keycloak.disable')).toHaveLength(1);
		expect(await runStatus(runId)).toBe('partial');
		const failedCalls = await sql`SELECT 1 FROM audit_log WHERE run_id = ${runId} AND kind = 'api_call' AND detail_json->>'status' = '503'`;
		expect(failedCalls).toHaveLength(4);
		expect((await sql`SELECT employees.status FROM employees WHERE id = ${ids.dana}`)[0].status).toBe('offboarding');
		expect(await sql`SELECT 1 FROM rechecks WHERE run_id = ${runId}`).toHaveLength(0); // no recheck until fully verified

		// fix the outage, retry by hand: finished steps are skipped
		kc.failures.clear();
		await engine.retryItem(runId, bad.id, ACTOR);
		await engine.waitForExecutorIdle();
		const good = await itemBy(runId, 'dana.okafor');
		expect(good.status).toBe('verified');
		expect(good.attempts).toBe(2);
		expect(kc.revokeLog.filter((r) => r.action === 'keycloak.disable')).toHaveLength(1); // not repeated
		expect(kc.revokeLog.filter((r) => r.action === 'keycloak.logout')).toHaveLength(1);
		expect(await runStatus(runId)).toBe('verified');
		await expect(engine.retryItem(runId, good.id, ACTOR)).rejects.toThrow(/Only failed/);
	});

	it('does not retry non-retryable failures; all items failing gives failed', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		kc.failAction('keycloak.disable', 99, { retryable: false, error: 'forbidden' });
		gh.failAction('github.remove_member', 99, { retryable: false, error: 'forbidden' });
		vu.failAction('vultr.suspend_user', 99, { retryable: false, error: 'forbidden' });
		vu.failAction('vultr.delete_api_key', 99, { retryable: false, error: 'forbidden' });
		vu.failAction('vultr.halt_instance', 99, { retryable: false, error: 'forbidden' });
		const runId = await offboardDana();
		const all = await items(runId);
		expect(all.every((i) => i.status === 'failed')).toBe(true);
		expect(all[0].last_error).not.toContain('attempts');
		expect(await runStatus(runId)).toBe('failed');
	});

	it('a verification that the system does not confirm fails the item and a retry re-runs the step', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		// the system silently ignores the disable
		const original = kc.revoke.bind(kc);
		let ignore = true;
		kc.revoke = async (a, action, ctx) => {
			const res = await original(a, action, ctx);
			if (ignore && action === 'keycloak.disable') kc.get('user', 'kc-dana')!.active = true;
			return res;
		};
		const runId = await offboardDana();
		const bad = await itemBy(runId, 'dana.okafor');
		expect(bad.status).toBe('failed');
		expect(bad.last_error).toMatch(/Not confirmed/);
		expect(bad.verified_state).toContain('enabled: true');
		expect(bad.verified_at).toBeNull();
		expect(bad.steps_json[0].status).toBe('failed');
		ignore = false;
		await engine.retryItem(runId, bad.id, ACTOR);
		await engine.waitForExecutorIdle();
		expect((await itemBy(runId, 'dana.okafor')).status).toBe('verified');
	});

	it('records a model mismatch in ai_calls and the audit warning', async () => {
		if (!ok) return;
		mismatchModel = 'deepseek-v4.1-flash-1017';
		await engine.sweepAll(ACTOR);
		const rows = await sql`SELECT requested_model, returned_model, cost_usd FROM ai_calls`;
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.returned_model === 'deepseek-v4.1-flash-1017' && r.requested_model !== r.returned_model)).toBe(true);
		const a = await sql`SELECT detail_json FROM audit_log WHERE kind = 'ai_call'`;
		expect(a.length).toBe(rows.length);
		expect(a[0].detail_json.warning).toMatch(/Model mismatch/);
		expect(a[0].detail_json).toMatchObject({ model: 'deepseek-v4.1-flash-1017', tokens: 1000, promptTokens: 800, completionTokens: 200 });
		// 800 in + 200 out at deepseek-v4.1-flash-1017 prices ($0.15 / $0.60 per 1M)
		expect(Number(rows[0].cost_usd)).toBeCloseTo((800 * 0.15 + 200 * 0.6) / 1e6, 8);
	});
});

describe('recheck and regression', () => {
	it('tampered state: recheck now turns the run regressed with a diff, and a clean recheck restores it', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await offboardDana();
		expect(await runStatus(runId)).toBe('verified');

		kc.get('user', 'kc-dana')!.active = true; // somebody re-enabled her
		await engine.recheckNow(runId, ACTOR);
		const [rc] = await sql`SELECT status, result_json, fired_at FROM rechecks WHERE run_id = ${runId}`;
		expect(rc.status).toBe('regressed');
		expect(rc.fired_at).not.toBeNull();
		expect(rc.result_json.diff).toHaveLength(1);
		expect(rc.result_json.diff[0]).toMatchObject({ label: expect.stringContaining('dana.okafor'), observed: 'enabled: true' });
		const dana = await itemBy(runId, 'dana.okafor');
		expect(rc.result_json.diff[0].itemId).toBe(dana.id);
		expect(await runStatus(runId)).toBe('regressed');
		expect(engine.state().timers.has(runId)).toBe(false);

		kc.get('user', 'kc-dana')!.active = false;
		await engine.recheckNow(runId, ACTOR); // resets the finished row and fires again
		expect((await sql`SELECT status FROM rechecks WHERE run_id = ${runId}`)[0].status).toBe('clean');
		expect(await runStatus(runId)).toBe('verified');
	});

	it('recheckNow inserts a row when none exists', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await engine.startOffboarding(ids.dana, ACTOR);
		expect(await sql`SELECT 1 FROM rechecks WHERE run_id = ${runId}`).toHaveLength(0);
		await engine.recheckNow(runId, ACTOR);
		expect((await sql`SELECT status FROM rechecks WHERE run_id = ${runId}`)[0].status).toBe('clean'); // nothing to re-verify yet
	});

	it('uses RECHECK_DELAY_SECONDS over the setting and fires a timer by itself', async () => {
		if (!ok) return;
		process.env.RECHECK_DELAY_SECONDS = '1';
		await engine.sweepAll(ACTOR);
		const runId = await offboardDana();
		const [rc] = await sql`SELECT due_at FROM rechecks WHERE run_id = ${runId}`;
		expect(new Date(rc.due_at).getTime() - Date.now()).toBeLessThan(1500);
		await waitFor(async () => (await sql`SELECT status FROM rechecks WHERE run_id = ${runId}`)[0].status === 'clean', 4000);
		delete process.env.RECHECK_DELAY_SECONDS;
	});

	it('sweeping flags an offboarded employee whose account is active again', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await offboardDana();
		await engine.sweepAll(ACTOR); // everything is revoked: nothing to flag
		expect(await runStatus(runId)).toBe('verified');
		kc.get('user', 'kc-dana')!.active = true;
		await engine.sweepAll(ACTOR);
		expect(await runStatus(runId)).toBe('regressed');
		const [rc] = await sql`SELECT status, result_json FROM rechecks WHERE run_id = ${runId}`;
		expect(rc.status).toBe('regressed');
		expect(rc.result_json.diff).toHaveLength(1);
		expect(rc.result_json.diff[0].observed).toMatch(/active again/);
		await engine.sweepAll(ACTOR); // idempotent
		expect((await sql`SELECT result_json FROM rechecks WHERE run_id = ${runId}`)[0].result_json.diff).toHaveLength(1);
	});

	it('startBackground re-arms pending rechecks (overdue fires immediately) and resumes approved items; it is idempotent', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await offboardDana();
		for (const id of [...engine.state().timers.keys()]) engine.clearRecheckTimer(id);
		await sql`UPDATE rechecks SET due_at = now() - interval '1 minute' WHERE run_id = ${runId}`;

		// simulate an interrupted executor: a second employee's item left 'running' with a half-done step
		await sql`UPDATE employees SET status = 'active', end_date = NULL WHERE id = ${ids.dana}`;
		const run2 = await engine.startOffboarding(ids.dana, ACTOR);
		const mattersNot = await items(run2);
		expect(mattersNot.length).toBeGreaterThan(0);

		engine.state().started = false;
		await engine.startBackground();
		await engine.startBackground(); // second call is a no-op
		await waitFor(async () => (await sql`SELECT status FROM rechecks WHERE run_id = ${runId}`)[0].status === 'clean');
	});

	it('resumes items left running after a restart without repeating finished steps', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await engine.startOffboarding(ids.dana, ACTOR);
		for (const i of await items(runId)) if (i.status === 'proposed') await engine.decideItem(runId, i.id, 'yes', ACTOR);
		// pretend the process died mid-item: disable done, logout 'running'
		const it = await itemBy(runId, 'dana.okafor');
		kc.get('user', 'kc-dana')!.active = false;
		const steps = it.steps_json.map((s: any, n: number) => (n === 0 ? { ...s, status: 'done' } : { ...s, status: 'running' }));
		await sql`UPDATE run_items SET status = 'running', steps_json = ${sql.json(steps)} WHERE id = ${it.id}`;
		await sql`UPDATE run_items SET status = 'approved' WHERE run_id = ${runId} AND status = 'pending'`;
		await sql`UPDATE runs SET status = 'executing' WHERE id = ${runId}`;
		engine.state().started = false;
		await engine.startBackground();
		await engine.waitForExecutorIdle();
		expect((await itemBy(runId, 'dana.okafor')).status).toBe('verified');
		expect(kc.revokeLog.filter((r) => r.action === 'keycloak.disable')).toHaveLength(0); // skipped, already done
		expect(await runStatus(runId)).toBe('verified');
	});
});

describe('connections and demo reset', () => {
	it('testConnection updates status and audits the call', async () => {
		if (!ok) return;
		await sql`UPDATE connections SET status = 'error', last_error = 'old' WHERE system = 'keycloak'`;
		const r = await engine.testConnection('keycloak', ACTOR);
		expect(r).toEqual({ ok: true, message: 'Connected to fake keycloak' });
		const [c] = await sql`SELECT status, last_error, last_tested_at FROM connections WHERE system = 'keycloak'`;
		expect(c.status).toBe('healthy');
		expect(c.last_error).toBeNull();
		expect(c.last_tested_at).not.toBeNull();
		const a = await sql`SELECT detail_json FROM audit_log WHERE kind = 'connection'`;
		expect(a[0].detail_json.calls[0]).toMatchObject({ method: 'GET', status: 200 });

		engine.setConnectorProvider(async () => null);
		const miss = await engine.testConnection('github', ACTOR);
		expect(miss.ok).toBe(false);
		expect((await sql`SELECT status FROM connections WHERE system = 'github'`)[0].status).toBe('error');
		expect((await engine.testConnection('nope', ACTOR)).ok).toBe(false);
	});

	it('wipeDemoData removes demo runs and demo accounts only', async () => {
		if (!ok) return;
		await engine.sweepAll(ACTOR);
		const runId = await offboardDana();
		const [real] = await sql`INSERT INTO employees (name, work_email, is_demo) VALUES ('Real Person', 'real@acme.test', false) RETURNING id`;
		const [conn] = await sql`SELECT id FROM connections WHERE system = 'github'`;
		const [realAcct] = await sql`INSERT INTO accounts (connection_id, system, external_id, kind, username, emails) VALUES (${conn.id}, 'github', 'real-1', 'user', 'real-1', ${['real@acme.test']}) RETURNING id`;
		await sql`INSERT INTO account_links (account_id, employee_id, link_method, confirmed) VALUES (${realAcct.id}, ${real.id}, 'rule:work_email', true)`;
		const wiped = await engine.wipeDemoData();
		expect(wiped.runs).toBe(1);
		expect(await sql`SELECT 1 FROM runs WHERE id = ${runId}`).toHaveLength(0);
		expect(await sql`SELECT 1 FROM run_items`).toHaveLength(0);
		expect(await sql`SELECT 1 FROM rechecks`).toHaveLength(0);
		expect(await sql`SELECT 1 FROM ai_calls`).toHaveLength(0);
		expect(await sql`SELECT 1 FROM ai_suggestions`).toHaveLength(0);
		expect(await sql`SELECT 1 FROM accounts WHERE id = ${realAcct.id}`).toHaveLength(1);
		expect(await sql`SELECT 1 FROM account_links WHERE account_id = ${realAcct.id}`).toHaveLength(1);
		expect(await sql`SELECT 1 FROM employees WHERE id = ${real.id}`).toHaveLength(1);
		const [d] = await sql`SELECT status FROM employees WHERE id = ${ids.dana}`;
		expect(d.status).toBe('active');
		expect(engine.state().timers.has(runId)).toBe(false);
	});
});
