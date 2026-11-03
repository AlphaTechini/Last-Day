// Live updates for the run page, per docs/ROUTES_CONTRACT.md:
// - every 1500 ms while the run is executing or any item is approved / running / destroying
// - every 5000 ms while a re-check is pending and due within the next 10 minutes
// - otherwise stop (and wake up again when a far-away re-check enters the 10 minute window)

import type { RunDetail } from '#lib/types.ts';

const BUSY_ITEM = new Set(['approved', 'running', 'destroying']);
const TEN_MINUTES = 10 * 60 * 1000;

export type PollPlan = { delay: number; fetch: boolean } | null;

/** Decide when to look at the run again. Exported for tests and the preview. */
export function pollPlan(run: RunDetail, now = Date.now()): PollPlan {
	if (run.status === 'executing' || run.items.some((i) => BUSY_ITEM.has(i.status))) {
		return { delay: 1500, fetch: true };
	}
	const recheck = run.recheck;
	if (recheck && recheck.status === 'running') return { delay: 1500, fetch: true };
	if (recheck && recheck.status === 'pending') {
		const due = new Date(recheck.dueAt).getTime() - now;
		if (due <= TEN_MINUTES) return { delay: 5000, fetch: true };
		// Sleep until the re-check enters the 10 minute window, then re-evaluate without fetching.
		return { delay: Math.min(due - TEN_MINUTES + 50, 2 ** 31 - 1), fetch: false };
	}
	return null;
}

export interface RunPollerOptions {
	/** Current run (reactive getter). */
	get: () => RunDetail;
	/** Replace local state with the fresh run. */
	set: (run: RunDetail) => void;
	/** Disable polling entirely (preview / fixtures). */
	enabled?: () => boolean;
	fetcher?: typeof fetch;
}

/**
 * Call from a component's script. Starts an effect that schedules the next poll
 * from the current run state, so a status change automatically re-plans.
 */
export function pollRun(opts: RunPollerOptions) {
	let tick = $state(0);
	let failures = 0;

	$effect(() => {
		void tick;
		if (opts.enabled && !opts.enabled()) return;
		const run = opts.get();
		const plan = pollPlan(run);
		if (!plan) return;

		let cancelled = false;
		const controller = new AbortController();
		// Back off gently on network errors so a flaky connection does not hammer the server.
		const delay = plan.delay * Math.min(2 ** failures, 8);

		const timer = setTimeout(async () => {
			if (!plan.fetch) {
				tick++;
				return;
			}
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
				tick++;
				return;
			}
			try {
				const res = await (opts.fetcher ?? fetch)(`/api/runs/${encodeURIComponent(run.id)}`, {
					signal: controller.signal,
					headers: { accept: 'application/json' }
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const fresh = (await res.json()) as RunDetail;
				failures = 0;
				if (!cancelled) opts.set(fresh);
			} catch (err) {
				if ((err as Error).name === 'AbortError') return;
				failures++;
			}
			if (!cancelled) tick++;
		}, delay);

		return () => {
			cancelled = true;
			clearTimeout(timer);
			controller.abort();
		};
	});
}
