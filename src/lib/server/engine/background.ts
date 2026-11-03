import { armPendingRechecks } from './recheck.ts';
import { resumeInterrupted } from './executor.ts';
import { errMessage, state } from './state.ts';

/** Idempotent. Arms re-check timers from the database and resumes executor work left over from a restart. */
export async function startBackgroundImpl(): Promise<void> {
	const s = state();
	if (s.started) return;
	s.started = true;
	try {
		const rechecks = await armPendingRechecks();
		const resumed = await resumeInterrupted();
		if (rechecks || resumed) console.log(`[engine] armed ${rechecks} re-check timer(s), resumed ${resumed} interrupted item(s)`);
	} catch (e) {
		s.started = false; // allow another attempt, e.g. when the database was not ready yet
		throw new Error(`engine background start failed: ${errMessage(e)}`);
	}
}
