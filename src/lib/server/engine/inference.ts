// OpenAI-compatible client for Vultr Serverless Inference (docs/API_REFERENCE.md section 5).
// No database access: the benchmark script uses it directly.
import { config, sleep } from './state.ts';

export const DEFAULT_INFERENCE_BASE_URL = 'https://api.vultrinference.com/v1';

export type JsonMode = 'json_schema' | 'json_object';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	schemaName: string;
	schema: Record<string, unknown>;
	/** Includes reasoning tokens. */
	maxCompletionTokens: number;
	reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface ChatResponse {
	content: string;
	/** The `model` field of the response. Compare with the requested model: a wrong id silently falls back. */
	model: string | null;
	promptTokens: number;
	completionTokens: number;
	reasoningTokens: number;
	finishReason: string | null;
	latencyMs: number;
	mode: JsonMode;
}

export interface InferenceClient {
	chat(req: ChatRequest): Promise<ChatResponse>;
}

export class InferenceError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
		readonly retryable: boolean
	) {
		super(message);
		this.name = 'InferenceError';
	}
}

export interface InferenceClientOptions {
	baseUrl?: string;
	apiKey?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	/** Max parallel requests through this client. */
	concurrency?: number;
	/** Replaces the real sleeps between HTTP retries (tests). */
	sleepImpl?: (ms: number) => Promise<void>;
}

class Semaphore {
	private waiting: Array<() => void> = [];
	private used = 0;
	constructor(private readonly max: number) {}
	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.used >= this.max) await new Promise<void>((r) => this.waiting.push(r));
		this.used++;
		try {
			return await fn();
		} finally {
			this.used--;
			this.waiting.shift()?.();
		}
	}
}

export function isLocalUrl(url: string): boolean {
	try {
		const h = new URL(url).hostname;
		return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
	} catch {
		return false;
	}
}

function extractContent(message: unknown): string {
	const m = message as { content?: unknown } | undefined;
	if (typeof m?.content === 'string') return m.content;
	if (Array.isArray(m?.content)) {
		return m.content.map((p) => (typeof p === 'string' ? p : ((p as { text?: string })?.text ?? ''))).join('');
	}
	return '';
}

export function createInferenceClient(opts: InferenceClientOptions = {}): InferenceClient {
	const baseUrl = (opts.baseUrl ?? process.env.VULTR_INFERENCE_BASE_URL ?? DEFAULT_INFERENCE_BASE_URL).replace(/\/+$/, '');
	const apiKey = opts.apiKey ?? process.env.VULTR_INFERENCE_API_KEY ?? '';
	const doFetch = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 60_000;
	const wait = opts.sleepImpl ?? sleep;
	const limiter = new Semaphore(opts.concurrency ?? config().inferenceConcurrency);
	const schemaUnsupported = new Set<string>();

	async function post(body: Record<string, unknown>): Promise<{ json: any; latencyMs: number }> {
		let lastErr: InferenceError | null = null;
		for (let attempt = 0; attempt < 4; attempt++) {
			const started = Date.now();
			let res: Response;
			try {
				res = await doFetch(`${baseUrl}/chat/completions`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(timeoutMs)
				});
			} catch (e) {
				lastErr = new InferenceError(`Inference request failed: ${e instanceof Error ? e.message : String(e)}`, null, true);
				await wait(1000 * 2 ** attempt);
				continue;
			}
			const text = await res.text();
			if (res.ok) {
				try {
					return { json: JSON.parse(text), latencyMs: Date.now() - started };
				} catch {
					throw new InferenceError('Inference returned a non-JSON body', res.status, false);
				}
			}
			let message = text.slice(0, 300);
			try {
				const j = JSON.parse(text);
				message = j?.error?.message ?? message;
			} catch {
				/* keep raw text */
			}
			const retryable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
			lastErr = new InferenceError(`Inference ${res.status}: ${message}`, res.status, retryable);
			if (!retryable) throw lastErr;
			const retryAfter = Number(res.headers.get('retry-after'));
			await wait(res.status === 429 && retryAfter > 0 ? Math.min(retryAfter, 15) * 1000 : 1000 * 2 ** attempt);
		}
		throw lastErr ?? new InferenceError('Inference failed', null, true);
	}

	return {
		chat(req) {
			return limiter.run(async () => {
				const useSchema = !schemaUnsupported.has(req.model);
				const base: Record<string, unknown> = {
					model: req.model,
					max_completion_tokens: req.maxCompletionTokens,
					reasoning_effort: req.reasoningEffort ?? 'low',
					temperature: 0,
					seed: 7
				};
				let mode: JsonMode = useSchema ? 'json_schema' : 'json_object';
				const build = (m: JsonMode): Record<string, unknown> =>
					m === 'json_schema'
						? {
								...base,
								messages: req.messages,
								response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } }
							}
						: {
								...base,
								messages: [
									{ role: 'system', content: `Answer with a single JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(req.schema)}` },
									...req.messages
								],
								response_format: { type: 'json_object' }
							};
				let out: { json: any; latencyMs: number };
				try {
					out = await post(build(mode));
				} catch (e) {
					// Some models reject strict json_schema with 400; fall back to json_object and validate in code.
					if (mode === 'json_schema' && e instanceof InferenceError && e.status === 400 && !/context_length/i.test(e.message)) {
						schemaUnsupported.add(req.model);
						mode = 'json_object';
						out = await post(build(mode));
					} else {
						throw e;
					}
				}
				const choice = out.json?.choices?.[0];
				const usage = out.json?.usage ?? {};
				return {
					content: extractContent(choice?.message),
					model: typeof out.json?.model === 'string' ? out.json.model : null,
					promptTokens: Number(usage.prompt_tokens ?? 0) || 0,
					completionTokens: Number(usage.completion_tokens ?? 0) || 0,
					reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0) || 0,
					finishReason: choice?.finish_reason ?? null,
					latencyMs: out.latencyMs,
					mode
				};
			});
		}
	};
}

let override: InferenceClient | null | undefined;
let shared: InferenceClient | null = null;
let sharedKey = '';

/** Tests install a stub; pass undefined to go back to the environment-configured client. */
export function setInferenceClient(c: InferenceClient | null | undefined): void {
	override = c;
}

/** True when an API key is configured (or the base URL is a local sandbox that needs none). */
export function inferenceConfigured(): boolean {
	if (override !== undefined) return override !== null;
	const key = process.env.VULTR_INFERENCE_API_KEY ?? '';
	return !!key || isLocalUrl(process.env.VULTR_INFERENCE_BASE_URL ?? '');
}

export function getInferenceClient(): InferenceClient | null {
	if (override !== undefined) return override;
	if (!inferenceConfigured()) return null;
	const sig = `${process.env.VULTR_INFERENCE_BASE_URL}|${process.env.VULTR_INFERENCE_API_KEY}`;
	if (!shared || sig !== sharedKey) {
		shared = createInferenceClient();
		sharedKey = sig;
	}
	return shared;
}
