import { AVAILABLE_MODELS } from '#lib/server/models.ts';

export const SNAPSHOT_USD_PER_GB_MONTH = 0.05;

/** Vultr snapshot storage: $0.05 per GB per month. */
export function snapshotMonthlyCost(sizeGb: number): number {
	if (!Number.isFinite(sizeGb) || sizeGb <= 0) return 0;
	return round(sizeGb * SNAPSHOT_USD_PER_GB_MONTH, 4);
}

export function round(n: number, dp: number): number {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}

export interface CallCost {
	costUsd: number;
	/** Model whose price was used. */
	pricedAs: string | null;
	warning?: string;
}

/**
 * Cost of one chat call from the response `usage`. Priced for the model that actually answered
 * (the returned `model`), falling back to the requested model's price when the returned id is unknown.
 */
export function callCost(requested: string, returned: string | null, promptTokens: number, completionTokens: number): CallCost {
	const find = (id: string | null) => (id ? AVAILABLE_MODELS.find((m) => m.id === id) : undefined);
	const m = find(returned) ?? find(requested);
	if (!m) return { costUsd: 0, pricedAs: null, warning: `No price known for model "${returned ?? requested}"; cost recorded as 0` };
	const costUsd = (promptTokens * m.inputPer1M + completionTokens * m.outputPer1M) / 1_000_000;
	const out: CallCost = { costUsd: Number(costUsd.toFixed(8)), pricedAs: m.id };
	if (returned && m.id !== returned) out.warning = `Returned model "${returned}" has no known price; priced as ${m.id}`;
	return out;
}
