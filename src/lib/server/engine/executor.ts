// Executor: deterministic code that performs approved actions. One in-process queue per system, one item at a
// time per system (different systems run concurrently). Retries with backoff, idempotent per step.
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import type { ActionKind, ApiCallRecord, Connector } from '#lib/server/connectors/types.ts';
import { SYSTEM_NAMES, type ActionStep, type SystemId } from '#lib/types.ts';
import { getConnector } from './connectors.ts';
import { snapshotMonthlyCost } from './cost.ts';
import { finishRunIfDone } from './finish.ts';
import { pendingStep, parseSteps } from './steps.ts';
import { type ExecutorJob, config, errMessage, sleep, state } from './state.ts';
import { type AccountRef, verifyAction } from './verifier.ts';

// ---------- queue ----------

const jobKey = (j: ExecutorJob) => `${j.type}:${j.itemId}`;

export function enqueueJob(system: SystemId, job: ExecutorJob): void {
	const s = state();
	const key = jobKey(job);
	if (s.queuedItemIds.has(key)) return;
	s.queuedItemIds.add(key);
	let q = s.queues.get(system);
	if (!q) s.queues.set(system, (q = { jobs: [], active: false }));
	q.jobs.push(job);
	if (!q.active) {
		q.active = true;
		void worker(system);
	}
}

async function worker(system: SystemId): Promise<void> {
	const s = state();
	const q = s.queues.get(system)!;
	try {
		while (q.jobs.length) {
			const job = q.jobs.shift()!;
			try {
				if (job.type === 'revoke') await processRevoke(job.itemId);
				else await processDestroy(job.itemId);
			} catch (e) {
				console.error(`[executor] ${job.type} ${job.itemId} crashed:`, errMessage(e));
				await failItem(job.itemId, job.type === 'destroy' ? 'awaiting_manager' : 'failed', `Unexpected error: ${errMessage(e)}`).catch(() => {});
			} finally {
				s.queuedItemIds.delete(jobKey(job));
			}
			try {
				await finishRunIfDone(job.runId);
			} catch (e) {
				console.error('[executor] could not finish run:', errMessage(e));
			}
		}
	} finally {
		q.active = false;
		const idle = [...s.queues.values()].every((x) => !x.active && x.jobs.length === 0);
		if (idle) for (const w of s.idleWaiters.splice(0)) w();
	}
}

/** Resolves when no executor job is queued or running. */
export function waitForExecutorIdle(): Promise<void> {
	const s = state();
	const idle = [...s.queues.values()].every((x) => !x.active && x.jobs.length === 0);
	if (idle) return Promise.resolve();
	return new Promise((r) => s.idleWaiters.push(r));
}

// ---------- helpers ----------

interface ItemRow {
	id: string;
	run_id: string;
	account_id: string;
	status: string;
	steps_json: unknown;
	snapshot_id: string | null;
	snapshot_cost_usd_month: string | null;
	system: SystemId;
	kind: string;
	external_id: string;
	username: string | null;
	display_name: string | null;
	parent_external_id: string | null;
	raw_json: Record<string, unknown>;
	employee_id: string;
	approval_id: string | null;
	match_kind: string;
}

async function loadItem(itemId: string): Promise<ItemRow | null> {
	const [r] = await sql`
		SELECT i.id, i.run_id, i.account_id, i.status, i.steps_json, i.snapshot_id, i.snapshot_cost_usd_month, i.approval_id, i.match_kind,
		       a.system, a.kind, a.external_id, a.username, a.display_name, a.parent_external_id, a.raw_json, r.employee_id
		FROM run_items i JOIN accounts a ON a.id = i.account_id JOIN runs r ON r.id = i.run_id WHERE i.id = ${itemId}`;
	return (r as unknown as ItemRow) ?? null;
}

const accountRef = (i: ItemRow): AccountRef => ({ externalId: i.external_id, kind: i.kind as AccountRef['kind'], parentExternalId: i.parent_external_id, username: i.username, raw: i.raw_json ?? {} });
const accountLabel = (i: ItemRow) => i.username ?? i.display_name ?? i.external_id;

async function saveSteps(itemId: string, steps: ActionStep[]): Promise<void> {
	await sql`UPDATE run_items SET steps_json = ${sql.json(steps as never)} WHERE id = ${itemId}`;
}

async function failItem(itemId: string, status: 'failed' | 'awaiting_manager', error: string): Promise<void> {
	await sql`UPDATE run_items SET status = ${status}, last_error = ${error} WHERE id = ${itemId}`;
}

async function auditCalls(i: ItemRow, action: string, calls: ApiCallRecord[], extra: Record<string, unknown>): Promise<void> {
	for (const c of calls) {
		await audit({
			runId: i.run_id,
			employeeId: i.employee_id,
			system: i.system,
			kind: 'api_call',
			summary: `${c.method} ${c.endpoint} -> ${c.status}`,
			detail: { method: c.method, endpoint: c.endpoint, status: c.status, ms: c.ms, action, itemId: i.id, approvalId: i.approval_id, ...extra }
		});
	}
}

interface StepOutcome {
	ok: boolean;
	error?: string;
	calls: ApiCallRecord[];
	output?: Record<string, unknown>;
}

/** One revoke action with retries: `retryDelaysMs.length` retries after the first attempt, only for retryable failures. */
async function runWithRetry(connector: Connector, i: ItemRow, action: ActionKind, ctx: { snapshotId?: string | null }): Promise<StepOutcome> {
	const delays = config().retryDelaysMs;
	const allCalls: ApiCallRecord[] = [];
	for (let attempt = 0; ; attempt++) {
		let res: Awaited<ReturnType<Connector['revoke']>>;
		try {
			res = await connector.revoke(accountRef(i), action, ctx);
		} catch (e) {
			res = { ok: false, calls: [], error: errMessage(e), retryable: true };
		}
		allCalls.push(...res.calls);
		await auditCalls(i, action, res.calls, { attempt: attempt + 1, ok: res.ok });
		if (res.ok) return { ok: true, calls: allCalls, output: res.output };
		if (!res.retryable || attempt >= delays.length) {
			return { ok: false, calls: allCalls, error: `${res.error ?? 'Action failed'}${attempt > 0 ? ` (after ${attempt + 1} attempts)` : ''}` };
		}
		await sleep(delays[attempt]);
	}
}

const lastCall = (calls: ApiCallRecord[]) => (calls.length ? calls[calls.length - 1] : null);

function applyCall(step: ActionStep, calls: ApiCallRecord[]): void {
	const c = lastCall(calls);
	if (c) {
		step.endpoint = `${c.method} ${c.endpoint}`;
		step.httpStatus = c.status;
	}
	step.at = new Date().toISOString();
}

// ---------- revoke ----------

async function processRevoke(itemId: string): Promise<void> {
	const item = await loadItem(itemId);
	if (!item || (item.status !== 'approved' && item.status !== 'running')) return;
	let connector: Connector | null = null;
	try {
		connector = await getConnector(item.system);
	} catch (e) {
		await failItem(itemId, 'failed', `Connector unavailable: ${errMessage(e)}`);
		return;
	}
	if (!connector) {
		await failItem(itemId, 'failed', `${SYSTEM_NAMES[item.system]} is not configured`);
		return;
	}
	await sql`UPDATE run_items SET status = 'running', attempts = attempts + 1, last_error = NULL WHERE id = ${itemId}`;

	const steps = parseSteps(item.steps_json).map((s) => (s.status === 'running' ? { ...s, status: 'pending' as const } : s));
	let snapshotId = item.snapshot_id;
	let snapshotCost = item.snapshot_cost_usd_month === null ? null : Number(item.snapshot_cost_usd_month);
	const label = accountLabel(item);

	for (const step of steps) {
		if (step.status === 'done' || step.status === 'skipped') continue; // idempotent: resume / retry skips finished steps
		step.status = 'running';
		step.at = new Date().toISOString();
		await saveSteps(itemId, steps);
		const out = await runWithRetry(connector, item, step.action as ActionKind, { snapshotId });
		applyCall(step, out.calls);
		if (!out.ok) {
			step.status = 'failed';
			await saveSteps(itemId, steps);
			await failItem(itemId, 'failed', `${step.label}: ${out.error}`);
			await audit({ runId: item.run_id, employeeId: item.employee_id, system: item.system, kind: 'run', summary: `${SYSTEM_NAMES[item.system]} ${label}: "${step.label}" failed: ${out.error}`, detail: { itemId, action: step.action, error: out.error } });
			return;
		}
		step.status = 'done';
		if (step.action === 'vultr.snapshot_instance') {
			const o = out.output ?? {};
			if (typeof o.snapshotId === 'string') snapshotId = o.snapshotId;
			const sizeGb = Number(o.snapshotSizeGb ?? item.raw_json?.disk ?? item.raw_json?.disk_gb ?? 0);
			snapshotCost = snapshotMonthlyCost(sizeGb);
			await sql`UPDATE run_items SET snapshot_id = ${snapshotId}, snapshot_cost_usd_month = ${snapshotCost} WHERE id = ${itemId}`;
		}
		await saveSteps(itemId, steps);
	}

	// Verifier: re-read the system for every action that ran.
	const observed: string[] = [];
	let allConfirmed = true;
	let firstFailure = '';
	for (const step of steps) {
		if (step.status !== 'done') continue;
		const v = await verifyAction(connector, accountRef(item), step.action as ActionKind, { snapshotId });
		const c = lastCall(v.calls);
		await audit({
			runId: item.run_id,
			employeeId: item.employee_id,
			system: item.system,
			kind: 'verify',
			summary: `${SYSTEM_NAMES[item.system]} ${label}: ${step.label} ${v.confirmed ? 'confirmed' : 'NOT confirmed'} (${v.observed})`,
			detail: { itemId, action: step.action, confirmed: v.confirmed, readBack: v.observed, timedOut: v.timedOut, polls: v.attempts, calls: v.calls, ...(c ? { method: c.method, endpoint: c.endpoint, status: c.status } : {}) }
		});
		observed.push(v.observed);
		if (!v.confirmed) {
			allConfirmed = false;
			firstFailure ||= `${step.label}: ${v.observed}`;
			step.status = 'failed'; // so a retry re-runs this step instead of skipping it
		}
	}
	await saveSteps(itemId, steps);
	const verifiedState = observed.join('; ');

	if (!allConfirmed) {
		await sql`UPDATE run_items SET status = 'failed', verified_state = ${verifiedState}, last_error = ${`Not confirmed by the system. ${firstFailure}`} WHERE id = ${itemId}`;
		return;
	}

	if (item.match_kind === 'server') {
		const monthly = Number(item.raw_json?.monthly_cost ?? 0) || 0;
		const snap = snapshotCost ?? 0;
		await sql`
			UPDATE run_items SET status = 'awaiting_manager', verified_state = ${verifiedState}, verified_at = now(), last_error = NULL,
			       snapshot_id = ${snapshotId}, snapshot_cost_usd_month = ${snap}, still_billing_usd_month = ${Math.round((monthly + snap) * 10000) / 10000}
			WHERE id = ${itemId}`;
		await sql`UPDATE accounts SET active = false, raw_json = raw_json || ${sql.json({ power_status: 'stopped' })} WHERE id = ${item.account_id}`;
	} else {
		await sql`UPDATE run_items SET status = 'verified', verified_state = ${verifiedState}, verified_at = now(), last_error = NULL WHERE id = ${itemId}`;
		if (item.kind === 'apikey' || item.kind === 'invitation') await sql`UPDATE accounts SET active = false, gone_at = COALESCE(gone_at, now()) WHERE id = ${item.account_id}`;
		else await sql`UPDATE accounts SET active = false WHERE id = ${item.account_id}`;
	}
}

// ---------- destroy (manager approval) ----------

async function processDestroy(itemId: string): Promise<void> {
	const item = await loadItem(itemId);
	if (!item || item.status !== 'destroying') return;
	const label = accountLabel(item);
	let connector: Connector | null = null;
	try {
		connector = await getConnector(item.system);
	} catch (e) {
		await failItem(itemId, 'awaiting_manager', `Connector unavailable: ${errMessage(e)}`);
		return;
	}
	if (!connector) {
		await failItem(itemId, 'awaiting_manager', `${SYSTEM_NAMES[item.system]} is not configured`);
		return;
	}
	const steps = parseSteps(item.steps_json);
	let step = steps.find((s) => s.action === 'vultr.destroy_instance');
	if (!step) {
		step = pendingStep('vultr.destroy_instance');
		steps.push(step);
	}
	step.status = 'running';
	step.at = new Date().toISOString();
	await saveSteps(itemId, steps);

	const out = await runWithRetry(connector, item, 'vultr.destroy_instance', { snapshotId: item.snapshot_id });
	applyCall(step, out.calls);
	if (!out.ok) {
		step.status = 'failed';
		await saveSteps(itemId, steps);
		await failItem(itemId, 'awaiting_manager', `Destroy server: ${out.error}`);
		return;
	}
	step.status = 'done';
	const v = await verifyAction(connector, accountRef(item), 'vultr.destroy_instance', { snapshotId: item.snapshot_id });
	const c = lastCall(v.calls);
	await audit({
		runId: item.run_id,
		employeeId: item.employee_id,
		system: item.system,
		kind: 'verify',
		summary: `${SYSTEM_NAMES[item.system]} ${label}: destroy ${v.confirmed ? 'confirmed' : 'NOT confirmed'} (${v.observed})`,
		detail: { itemId, action: 'vultr.destroy_instance', confirmed: v.confirmed, readBack: v.observed, calls: v.calls, ...(c ? { method: c.method, endpoint: c.endpoint, status: c.status } : {}) }
	});
	if (!v.confirmed) {
		step.status = 'failed';
		await saveSteps(itemId, steps);
		await failItem(itemId, 'awaiting_manager', `Destroy not confirmed: ${v.observed}`);
		return;
	}
	await saveSteps(itemId, steps);
	const snap = item.snapshot_cost_usd_month === null ? 0 : Number(item.snapshot_cost_usd_month);
	await sql`
		UPDATE run_items SET status = 'removed', verified_state = ${v.observed}, verified_at = now(), last_error = NULL, still_billing_usd_month = ${snap}
		WHERE id = ${itemId}`;
	await sql`UPDATE accounts SET active = false, gone_at = COALESCE(gone_at, now()) WHERE id = ${item.account_id}`;
	await audit({ runId: item.run_id, employeeId: item.employee_id, system: item.system, kind: 'run', summary: `${label} destroyed and verified gone; still billing $${snap.toFixed(2)}/month for the snapshot`, detail: { itemId, stillBillingUsdMonth: snap } });
}

// ---------- resume after restart ----------

export async function resumeInterrupted(): Promise<number> {
	await sql`UPDATE run_items SET status = 'approved' WHERE status = 'running'`;
	const rows = await sql`
		SELECT i.id, i.run_id, i.status, a.system FROM run_items i JOIN accounts a ON a.id = i.account_id
		WHERE i.status IN ('approved', 'destroying') ORDER BY i.run_id, i.sort_order`;
	for (const r of rows) {
		enqueueJob(r.system, { type: r.status === 'destroying' ? 'destroy' : 'revoke', itemId: r.id, runId: r.run_id });
	}
	// Runs whose items are all settled but whose status was never finalised.
	const stuck = await sql`SELECT r.id FROM runs r WHERE r.status = 'executing' AND NOT EXISTS (SELECT 1 FROM run_items i WHERE i.run_id = r.id AND i.status IN ('approved','running'))`;
	for (const r of stuck) await finishRunIfDone(r.id).catch(() => {});
	return rows.length;
}

