// Decides the run status once the executor has drained, and starts the re-check clock.
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import { scheduleRecheck } from './recheck.ts';

const DONE = new Set(['verified', 'awaiting_manager', 'destroying', 'removed']);

/**
 * Status rules (non-rejected items only):
 * - any approved/running: still executing, nothing to do
 * - any failed: 'partial' if something else is done, otherwise 'failed'
 * - any proposed/pending: back to 'review' (waiting for more decisions or approvals)
 * - otherwise: 'verified', employee offboarded, re-check scheduled. Server destroy never blocks this.
 */
export async function finishRunIfDone(runId: string): Promise<string | null> {
	let verified = false;
	let employeeId: string | null = null;
	let secondsToGreen: number | null = null;
	let next: string | null = null;
	await sql.begin(async (tx) => {
		const [run] = await tx`SELECT id, employee_id, status, started_at FROM runs WHERE id = ${runId} FOR UPDATE`;
		if (!run || run.status !== 'executing') return;
		const items = await tx`SELECT status FROM run_items WHERE run_id = ${runId} AND status <> 'rejected'`;
		const statuses = items.map((i) => i.status as string);
		if (statuses.some((s) => s === 'approved' || s === 'running')) return;
		const failed = statuses.filter((s) => s === 'failed').length;
		const done = statuses.filter((s) => DONE.has(s)).length;
		const open = statuses.filter((s) => s === 'proposed' || s === 'pending').length;
		employeeId = run.employee_id;
		if (failed > 0) next = done > 0 ? 'partial' : 'failed';
		else if (open > 0) next = 'review';
		else next = 'verified';
		if (next === 'verified') {
			await tx`UPDATE runs SET status = 'verified', verified_at = now() WHERE id = ${runId}`;
			await tx`UPDATE employees SET status = 'offboarded', end_date = COALESCE(end_date, CURRENT_DATE) WHERE id = ${run.employee_id}`;
			secondsToGreen = Math.max(0, Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000));
			verified = true;
		} else {
			await tx`UPDATE runs SET status = ${next} WHERE id = ${runId}`;
		}
	});
	if (next) {
		await audit({
			runId,
			employeeId,
			kind: 'run',
			summary: verified ? `Run verified: every approved action confirmed by the target systems (${secondsToGreen}s)` : `Run is now ${next}`,
			detail: { status: next, secondsToGreen }
		});
	}
	if (verified) await scheduleRecheck(runId);
	return next;
}
