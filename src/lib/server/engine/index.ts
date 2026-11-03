// Engine API: the only surface route handlers call for workflow behaviour.
// Implemented by the engine agent (connectors, sweep, matcher, resolver, executor, verifier, recheck).
// Route handlers (server agent) must not reach into engine internals; they call these.

export interface Actor {
	id: string | null; // app_users.id, null for system
	name: string;
	role: 'admin' | 'hr' | 'manager' | 'judge' | 'system';
}

/** Pull accounts from every healthy connection, upsert, run rules then AI resolver on unlinked ones. */
export async function sweepAll(actor: Actor): Promise<{ accounts: number; linkedByRules: number; aiSuggested: number; unknown: number }> {
	throw new Error('not implemented');
}

/** Test a connection's credential with a read call; updates connections.status/last_error/last_tested_at. */
export async function testConnection(system: string, actor: Actor): Promise<{ ok: boolean; message: string }> {
	throw new Error('not implemented');
}

/** Offboard now: scoped re-sweep, rules + AI resolve for this employee, create run + run_items with pre-populated steps. Sets employee status 'offboarding'. Returns run id. */
export async function startOffboarding(employeeId: string, actor: Actor): Promise<string> {
	throw new Error('not implemented');
}

/** HR yes/no on a probable match ('proposed' item). yes -> 'pending' and confirms the AI link; no -> 'rejected'. */
export async function decideItem(runId: string, itemId: string, decision: 'yes' | 'no', actor: Actor): Promise<void> {
	throw new Error('not implemented');
}

/** Record approval (hr_revoke) for the given pending items (or all pending when itemIds is 'all') and start the executor in the background. */
export async function approveItems(runId: string, itemIds: string[] | 'all', actor: Actor): Promise<void> {
	throw new Error('not implemented');
}

/** Retry a failed item (re-queues it on the executor). */
export async function retryItem(runId: string, itemId: string, actor: Actor): Promise<void> {
	throw new Error('not implemented');
}

/** Manager approval 2: destroy a halted+snapshotted server (item in 'awaiting_manager'). */
export async function destroyServer(runId: string, itemId: string, actor: Actor): Promise<void> {
	throw new Error('not implemented');
}

/** Re-check now: same path as the timer. Inserts a rechecks row if none exists. */
export async function recheckNow(runId: string, actor: Actor): Promise<void> {
	throw new Error('not implemented');
}

/** Called once at server start (hooks.server.ts init): schedules pending rechecks, resumes interrupted executor work. Idempotent. */
export async function startBackground(): Promise<void> {
	throw new Error('not implemented');
}

/** Reset demo company: re-seed the fictional company through the real APIs and the local DB. */
export async function resetDemo(actor: Actor): Promise<void> {
	throw new Error('not implemented');
}
