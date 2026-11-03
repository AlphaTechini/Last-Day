// Models selectable in Settings. Prices are USD per 1M tokens.
// The engine engineer may update this file (and should keep it in sync with real Vultr Serverless Inference prices).

export interface ModelInfo {
	id: string;
	inputPer1M: number;
	outputPer1M: number;
}

export const AVAILABLE_MODELS: ModelInfo[] = [
	{ id: 'glm-5.3-flash', inputPer1M: 0.1, outputPer1M: 0.35 },
	// TODO verify price
	{ id: 'glm-5.2', inputPer1M: 0.6, outputPer1M: 2.2 },
	// TODO verify price
	{ id: 'deepseek-v4.1-flash-1017', inputPer1M: 0.15, outputPer1M: 0.6 }
];

export function isKnownModel(id: string): boolean {
	return AVAILABLE_MODELS.some((m) => m.id === id);
}
