// Verifier: re-read the target system through its own API and report what it says.
import type { ActionKind, ApiCallRecord, Connector, NormalizedAccount } from '#lib/server/connectors/types.ts';
import { config, errMessage, sleep } from './state.ts';

export type AccountRef = Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId' | 'username' | 'raw'>;

export interface VerifyOutcome {
	confirmed: boolean;
	observed: string;
	calls: ApiCallRecord[];
	/** Still `pending` when the time budget ran out. */
	timedOut: boolean;
	attempts: number;
	/** Extra read-back data from the connector, e.g. snapshot size and monthly cost. */
	output?: Record<string, unknown>;
}

/**
 * Calls connector.verify, polling while the connector says `pending` (e.g. a snapshot still being created)
 * until `timeoutMs` (default 60 s). A thrown error is retried a couple of times, then reported as not confirmed.
 */
export async function verifyAction(
	connector: Connector,
	account: AccountRef,
	action: ActionKind,
	ctx: { snapshotId?: string | null } = {},
	opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<VerifyOutcome> {
	const timeoutMs = opts.timeoutMs ?? config().verifyTimeoutMs;
	const pollMs = opts.pollMs ?? config().verifyPollMs;
	const deadline = Date.now() + timeoutMs;
	const calls: ApiCallRecord[] = [];
	let attempts = 0;
	let errors = 0;
	let observed = '';
	let output: Record<string, unknown> | undefined;
	for (;;) {
		attempts++;
		try {
			const r = await connector.verify(account, action, ctx);
			calls.push(...r.calls);
			observed = r.observed;
			output = r.output ?? output;
			if (!r.pending) return { confirmed: r.confirmed, observed, calls, timedOut: false, attempts, output };
			observed = r.observed || 'pending';
		} catch (e) {
			errors++;
			observed = `Verification error: ${errMessage(e)}`;
			if (errors >= 3) return { confirmed: false, observed, calls, timedOut: false, attempts };
		}
		if (Date.now() + pollMs > deadline) return { confirmed: false, observed: `${observed} (timed out waiting for confirmation)`, calls, timedOut: true, attempts };
		await sleep(pollMs);
	}
}
