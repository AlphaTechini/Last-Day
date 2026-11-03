// Models selectable in Settings. Prices are USD per 1M tokens.
// Source: Vultr Serverless Inference model catalog capture, late Oct 2026 (docs/API_REFERENCE.md section 5.2).
// The catalog churns; prices here are the fallback used by the cost meter. The Vultr console Usage tab is authoritative.

export interface ModelInfo {
	id: string;
	inputPer1M: number;
	outputPer1M: number;
}

export const AVAILABLE_MODELS: ModelInfo[] = [
	{ id: 'glm-5.3-flash', inputPer1M: 0.1, outputPer1M: 0.35 },
	{ id: 'glm-5.2', inputPer1M: 0.75, outputPer1M: 3.0 },
	{ id: 'deepseek-v4.1-flash-1017', inputPer1M: 0.15, outputPer1M: 0.6 }
];

export function isKnownModel(id: string): boolean {
	return AVAILABLE_MODELS.some((m) => m.id === id);
}
