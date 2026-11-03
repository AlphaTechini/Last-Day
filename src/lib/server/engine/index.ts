// Engine API: the only surface route handlers call for workflow behaviour.
// Route handlers must not reach into engine internals; they call these.
import { testConnectionImpl } from './connection.ts';
import { resetDemoImpl } from './demo.ts';
import { startBackgroundImpl } from './background.ts';
import { recheckNowImpl } from './recheck.ts';
import { approveItemsImpl, decideItemImpl, destroyServerImpl, retryItemImpl, startOffboardingImpl } from './runs.ts';
import { sweepAllImpl } from './sweep.ts';

export interface Actor {
	id: string | null; // app_users.id, null for system
	name: string;
	role: 'admin' | 'hr' | 'manager' | 'judge' | 'system';
}

/** Pull accounts from every healthy connection, upsert, run rules then AI resolver on unlinked ones. */
export async function sweepAll(actor: Actor): Promise<{ accounts: number; linkedByRules: number; aiSuggested: number; unknown: number }> {
	return sweepAllImpl(actor);
}

/** Test a connection's credential with a read call; updates connections.status/last_error/last_tested_at. */
export async function testConnection(system: string, actor: Actor): Promise<{ ok: boolean; message: string }> {
	return testConnectionImpl(system, actor);
}

/** Offboard now: scoped re-sweep, rules + AI resolve for this employee, create run + run_items with pre-populated steps. Sets employee status 'offboarding'. Returns run id. */
export async function startOffboarding(employeeId: string, actor: Actor): Promise<string> {
	return startOffboardingImpl(employeeId, actor);
}

/** HR yes/no on a probable match ('proposed' item). yes -> 'pending' and confirms the AI link; no -> 'rejected'. */
export async function decideItem(runId: string, itemId: string, decision: 'yes' | 'no', actor: Actor): Promise<void> {
	return decideItemImpl(runId, itemId, decision, actor);
}

/** Record approval (hr_revoke) for the given pending items (or all pending when itemIds is 'all') and start the executor in the background. */
export async function approveItems(runId: string, itemIds: string[] | 'all', actor: Actor): Promise<void> {
	return approveItemsImpl(runId, itemIds, actor);
}

/** Retry a failed item (re-queues it on the executor). */
export async function retryItem(runId: string, itemId: string, actor: Actor): Promise<void> {
	return retryItemImpl(runId, itemId, actor);
}

/** Manager approval 2: destroy a halted+snapshotted server (item in 'awaiting_manager'). */
export async function destroyServer(runId: string, itemId: string, actor: Actor): Promise<void> {
	return destroyServerImpl(runId, itemId, actor);
}

/** Re-check now: same path as the timer. Inserts a rechecks row if none exists. */
export async function recheckNow(runId: string, actor: Actor): Promise<void> {
	return recheckNowImpl(runId, actor);
}

/** Called once at server start (hooks.server.ts init): schedules pending rechecks, resumes interrupted executor work. Idempotent. */
export async function startBackground(): Promise<void> {
	return startBackgroundImpl();
}

/** Reset demo company: re-seed the fictional company through the real APIs and the local DB. */
export async function resetDemo(actor: Actor): Promise<void> {
	return resetDemoImpl(actor);
}
