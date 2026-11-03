// Re-check timer: the only scheduled job. docs/ARCHITECTURE.md section 3.7.
// One setTimeout per pending rechecks row, re-armed from the database on start, claimed atomically when fired.
import { accountLabel } from './labels.ts';
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import type { ActionKind, Connector } from '#lib/server/connectors/types.ts';
import { getSettings } from '#lib/server/settings.ts';
import { SYSTEM_NAMES, type ActionStep, type SystemId } from '#lib/types.ts';
import { getConnector } from './connectors.ts';
import type { Actor } from './index.ts';
import { parseSteps } from './steps.ts';
import { errMessage, state } from './state.ts';
import { verifyAction } from './verifier.ts';

const MAX_TIMER_MS = 2 ** 31 - 1;
const SYSTEM_ACTOR: Actor = { id: null, name: 'system', role: 'system' };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export interface RecheckDiffEntry {
	itemId: string;
	label: string;
	observed: string;
}

/** RECHECK_DELAY_SECONDS (env) wins over the Settings value. */
export async function recheckDelaySeconds(): Promise<number> {
	const env = process.env.RECHECK_DELAY_SECONDS;
	if (env !== undefined && env.trim() !== '' && Number.isFinite(Number(env)) && Number(env) >= 0) return Number(env);
	return (await getSettings()).recheckDelaySeconds;
}

export function clearRecheckTimer(runId: string): void {
	const t = state().timers.get(runId);
	if (t) clearTimeout(t);
	state().timers.delete(runId);
}

function armTimer(runId: string, dueAtMs: number): void {
	clearRecheckTimer(runId);
	const remaining = Math.max(0, dueAtMs - Date.now());
	const t = setTimeout(() => {
		state().timers.delete(runId);
		const left = dueAtMs - Date.now();
		if (left > 50) {
			armTimer(runId, dueAtMs); // the cap on a single timer was hit: wait the rest
			return;
		}
		fireRecheck(runId, SYSTEM_ACTOR).catch((e) => console.error('[recheck] fire failed:', errMessage(e)));
	}, Math.min(remaining, MAX_TIMER_MS));
	t.unref?.();
	state().timers.set(runId, t);
}

/** Called when a run becomes verified: (re)creates the pending row for this run and arms its timer. */
export async function scheduleRecheck(runId: string): Promise<Date> {
	const delay = await recheckDelaySeconds();
	const dueAt = new Date(Date.now() + delay * 1000);
	await sql`
		INSERT INTO rechecks (run_id, due_at, status) VALUES (${runId}, ${dueAt}, 'pending')
		ON CONFLICT (run_id) DO UPDATE SET due_at = EXCLUDED.due_at, status = 'pending', result_json = NULL, fired_at = NULL`;
	armTimer(runId, dueAt.getTime());
	await audit({ runId, kind: 'recheck', summary: `Re-check scheduled in ${delay >= 120 ? `${Math.round(delay / 60)} minutes` : delay === 60 ? '1 minute' : `${delay} seconds`}`, detail: { dueAt: dueAt.toISOString(), delaySeconds: delay } });
	return dueAt;
}

/** On server start: arm every pending row (overdue ones fire immediately). Rows stuck in 'running' by a crash go back to pending. */
export async function armPendingRechecks(): Promise<number> {
	await sql`UPDATE rechecks SET status = 'pending' WHERE status = 'running'`;
	const rows = await sql`SELECT run_id, due_at FROM rechecks WHERE status = 'pending'`;
	for (const r of rows) armTimer(r.run_id, new Date(r.due_at).getTime());
	return rows.length;
}

/** Re-run verify for everything the run revoked. Returns the diff (empty = clean). */
async function checkRun(runId: string): Promise<{ diff: RecheckDiffEntry[]; checked: number }> {
	const items = await sql`
		SELECT i.id, i.status, i.steps_json, i.snapshot_id, a.system, a.kind, a.external_id, a.username, a.display_name, a.parent_external_id, a.raw_json
		FROM run_items i JOIN accounts a ON a.id = i.account_id
		WHERE i.run_id = ${runId} AND i.status IN ('verified', 'awaiting_manager', 'removed') ORDER BY i.sort_order`;
	const connectors = new Map<SystemId, Connector | null>();
	const diff: RecheckDiffEntry[] = [];
	let checked = 0;
	for (const it of items) {
		const system = it.system as SystemId;
		if (!connectors.has(system)) connectors.set(system, await getConnector(system).catch(() => null));
		const connector = connectors.get(system);
		const label = `${SYSTEM_NAMES[system]}: ${accountLabel(it)}`;
		const steps: ActionStep[] = parseSteps(it.steps_json).filter((s) => s.status === 'done');
		// A destroyed server only needs to still be gone; halting/snapshot steps no longer apply to it.
		const toCheck = it.status === 'removed' ? steps.filter((s) => s.action === 'vultr.destroy_instance') : steps.filter((s) => s.action !== 'vultr.destroy_instance');
		for (const step of toCheck) {
			checked++;
			if (!connector) {
				diff.push({ itemId: it.id, label: `${label} (${step.label})`, observed: `${SYSTEM_NAMES[system]} connector unavailable; could not re-check` });
				continue;
			}
			const v = await verifyAction(
				connector,
				{ externalId: it.external_id, kind: it.kind, parentExternalId: it.parent_external_id, username: it.username, raw: it.raw_json ?? {} },
				step.action as ActionKind,
				{ snapshotId: it.snapshot_id }
			);
			if (!v.confirmed) diff.push({ itemId: it.id, label: `${label} (${step.label})`, observed: v.observed });
		}
	}
	return { diff, checked };
}

/** Claims the row atomically, re-verifies, records clean/regressed. Returns null when it was not pending (already claimed). */
export async function fireRecheck(runId: string, actor: Actor): Promise<'clean' | 'regressed' | null> {
	const [claimed] = await sql`UPDATE rechecks SET status = 'running' WHERE run_id = ${runId} AND status = 'pending' RETURNING run_id`;
	if (!claimed) return null;
	clearRecheckTimer(runId);
	const [run] = await sql`SELECT r.id, r.status, r.employee_id, e.name AS employee_name FROM runs r JOIN employees e ON e.id = r.employee_id WHERE r.id = ${runId}`;
	try {
		const { diff, checked } = await checkRun(runId);
		const status: 'clean' | 'regressed' = diff.length ? 'regressed' : 'clean';
		await sql`UPDATE rechecks SET status = ${status}, fired_at = now(), result_json = ${sql.json({ diff, checked } as never)} WHERE run_id = ${runId}`;
		if (status === 'regressed') await sql`UPDATE runs SET status = 'regressed' WHERE id = ${runId}`;
		else if (run?.status === 'regressed') await sql`UPDATE runs SET status = 'verified' WHERE id = ${runId}`;
		await audit({
			actorId: actor.id,
			actorName: actor.name,
			runId,
			employeeId: run?.employee_id ?? null,
			kind: 'recheck',
			summary: status === 'clean' ? `Re-check: still clean, all ${checked} checks passed` : `Re-check: ${plural(new Set(diff.map((d) => d.itemId)).size, 'account')} came back (${diff.length} of ${checked} checks failed)`,
			detail: { status, checked, diff }
		});
		return status;
	} catch (e) {
		await sql`UPDATE rechecks SET status = 'pending' WHERE run_id = ${runId} AND status = 'running'`;
		await audit({ actorId: actor.id, actorName: actor.name, runId, kind: 'recheck', summary: `Re-check could not complete: ${errMessage(e)}`, detail: { error: errMessage(e) } }).catch(() => {});
		throw e;
	}
}

/** Re-check now: inserts a row if none exists, resets a finished one, then fires. */
export async function recheckNowImpl(runId: string, actor: Actor): Promise<void> {
	const [run] = await sql`SELECT id FROM runs WHERE id = ${runId}`;
	if (!run) throw new Error('Run not found');
	await sql`
		INSERT INTO rechecks (run_id, due_at, status) VALUES (${runId}, now(), 'pending')
		ON CONFLICT (run_id) DO UPDATE SET
			status = CASE WHEN rechecks.status IN ('clean', 'regressed') THEN 'pending' ELSE rechecks.status END,
			due_at = CASE WHEN rechecks.status IN ('clean', 'regressed') THEN now() ELSE rechecks.due_at END,
			result_json = CASE WHEN rechecks.status IN ('clean', 'regressed') THEN NULL ELSE rechecks.result_json END,
			fired_at = CASE WHEN rechecks.status IN ('clean', 'regressed') THEN NULL ELSE rechecks.fired_at END`;
	await audit({ actorId: actor.id, actorName: actor.name, runId, kind: 'recheck', summary: `${actor.name} requested a re-check now`, detail: {} });
	await fireRecheck(runId, actor);
}
