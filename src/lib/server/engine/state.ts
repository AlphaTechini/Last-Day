// Process-wide engine state, kept on globalThis so Vite dev HMR (module reloads) does not duplicate timers or queues.
import type { SystemId } from '#lib/types.ts';

export interface ExecutorJob {
	type: 'revoke' | 'destroy';
	itemId: string;
	runId: string;
}

export interface SystemQueue {
	jobs: ExecutorJob[];
	active: boolean;
}

export interface EngineState {
	started: boolean;
	timers: Map<string, ReturnType<typeof setTimeout>>;
	queues: Map<SystemId | 'unknown', SystemQueue>;
	queuedItemIds: Set<string>;
	idleWaiters: Array<() => void>;
	sweepInFlight: Promise<unknown> | null;
	resetInFlight: boolean;
}

const KEY = '__lastdayEngineState';

export function state(): EngineState {
	const g = globalThis as unknown as Record<string, EngineState | undefined>;
	return (g[KEY] ??= {
		started: false,
		timers: new Map(),
		queues: new Map(),
		queuedItemIds: new Set(),
		idleWaiters: [],
		sweepInFlight: null,
		resetInFlight: false
	});
}

/** Tunables. Tests shrink the delays. */
export interface EngineConfig {
	/** Backoff before retry 1, 2, 3 of a retryable connector failure. */
	retryDelaysMs: number[];
	verifyTimeoutMs: number;
	verifyPollMs: number;
	/** Max parallel chat-completion requests. */
	inferenceConcurrency: number;
	/** AI calls per sweep, a cost safety net. */
	maxAiCallsPerSweep: number;
	/** Days between an account's creation and an employee's start date that count as a coincidence. */
	startDateWindowDays: number;
}

const CONFIG_KEY = '__lastdayEngineConfig';
const DEFAULTS: EngineConfig = {
	retryDelaysMs: [500, 1000, 2000],
	verifyTimeoutMs: 60_000,
	verifyPollMs: 2_000,
	inferenceConcurrency: 4,
	maxAiCallsPerSweep: 200,
	startDateWindowDays: 14
};

export function config(): EngineConfig {
	const g = globalThis as unknown as Record<string, EngineConfig | undefined>;
	return (g[CONFIG_KEY] ??= { ...DEFAULTS });
}

export function setEngineConfig(patch: Partial<EngineConfig>): void {
	Object.assign(config(), patch);
}

export function resetEngineConfig(): void {
	Object.assign(config(), DEFAULTS);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function errMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
