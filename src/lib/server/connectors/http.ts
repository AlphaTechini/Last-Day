// Small fetch wrapper shared by all connectors.
// - 15 s timeout per attempt, JSON parsing, every attempt recorded as an ApiCallRecord
//   (method, path WITHOUT host or query string, status, ms).
// - classifies failures as retryable (network/timeout, 429, 5xx) and honours Retry-After.
// - never logs anything and never puts credentials into records or error messages.
import type { ActionResult, ApiCallRecord } from './types.ts';

export interface ConnectorOptions {
	/** Inject a fetch implementation (tests). Defaults to global fetch. */
	fetch?: typeof fetch;
	timeoutMs?: number; // default 15000
	/** Automatic retries for idempotent calls on network/5xx/429 (429 is retried for every method). Default 2. */
	maxRetries?: number;
	/** Base back-off in ms (doubles each retry). Default 400. Tests set 1. */
	retryBaseMs?: number;
	/** Upper bound for an honoured Retry-After. Default 10000. */
	maxRetryAfterMs?: number;
	/** Delay between read-back polls inside verify (e.g. waiting for a halt). Default 1000. Tests set 0. */
	verifyPollMs?: number;
}

export interface HttpRequest {
	method?: string;
	path: string; // appended to the client's baseUrl
	query?: Record<string, string | number | boolean | undefined | null>;
	json?: unknown;
	form?: Record<string, string>;
	headers?: Record<string, string>;
}

export interface HttpResponse<T = any> {
	ok: boolean; // 2xx
	status: number; // 0 = network error / timeout
	data: T; // parsed JSON, or null
	text: string;
	headers: Headers | null;
	retryable: boolean;
	retryAfterMs: number | null;
	/** Human-readable error (no credentials), null when ok. */
	error: string | null;
	ms: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | null {
	if (!v) return null;
	const secs = Number(v);
	if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
	const at = Date.parse(v);
	return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function isRetryableStatus(status: number): boolean {
	return status === 0 || status === 429 || status >= 500;
}

/** Pull a readable message out of the many error body shapes (Keycloak, Mattermost, GitHub, Vultr, OpenAI). */
export function describeError(status: number, data: unknown, text: string): string {
	let msg = '';
	if (data && typeof data === 'object') {
		const d = data as Record<string, unknown>;
		const err = d.error;
		const candidates = [d.errorMessage, d.message, d.error_description, typeof err === 'string' ? err : (err as Record<string, unknown> | undefined)?.message];
		const m = candidates.find((c) => typeof c === 'string' && c);
		if (typeof m === 'string') msg = m;
		if (typeof err === 'string' && typeof d.message === 'string' && err !== d.message) msg = `${err}: ${d.message}`;
	}
	if (!msg) msg = text.replace(/\s+/g, ' ').slice(0, 200);
	return `HTTP ${status}${msg ? `: ${msg.slice(0, 300)}` : ''}`;
}

export class HttpClient {
	private readonly base: string;
	private readonly f: typeof fetch;
	readonly opts: Required<Omit<ConnectorOptions, 'fetch'>>;

	constructor(
		baseUrl: string,
		private readonly defaultHeaders: Record<string, string> = {},
		options: ConnectorOptions = {}
	) {
		this.base = baseUrl.replace(/\/+$/, '');
		this.f = options.fetch ?? ((...a) => globalThis.fetch(...a));
		this.opts = {
			timeoutMs: options.timeoutMs ?? 15_000,
			maxRetries: options.maxRetries ?? 2,
			retryBaseMs: options.retryBaseMs ?? 400,
			maxRetryAfterMs: options.maxRetryAfterMs ?? 10_000,
			verifyPollMs: options.verifyPollMs ?? 1000
		};
	}

	async pause(ms = this.opts.verifyPollMs): Promise<void> {
		if (ms > 0) await sleep(ms);
	}

	async request<T = any>(calls: ApiCallRecord[], req: HttpRequest): Promise<HttpResponse<T>> {
		const method = (req.method ?? 'GET').toUpperCase();
		const idempotent = method === 'GET' || method === 'HEAD' || method === 'PUT' || method === 'DELETE';
		const url = new URL(this.base + (req.path.startsWith('/') ? req.path : `/${req.path}`));
		for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
		const endpoint = url.pathname; // no host, no query

		const headers: Record<string, string> = { accept: 'application/json', ...this.defaultHeaders, ...(req.headers ?? {}) };
		let body: string | undefined;
		if (req.json !== undefined) {
			body = JSON.stringify(req.json);
			headers['content-type'] = 'application/json';
		} else if (req.form) {
			body = new URLSearchParams(req.form).toString();
			headers['content-type'] = 'application/x-www-form-urlencoded';
		}

		let attempt = 0;
		for (;;) {
			const started = Date.now();
			let res: HttpResponse<T>;
			try {
				const r = await this.f(url, { method, headers, body, signal: AbortSignal.timeout(this.opts.timeoutMs), redirect: 'manual' });
				const text = await r.text();
				let data: unknown = null;
				if (text) {
					try {
						data = JSON.parse(text);
					} catch {
						data = null;
					}
				}
				const ms = Date.now() - started;
				const ok = r.status >= 200 && r.status < 300;
				res = {
					ok,
					status: r.status,
					data: data as T,
					text,
					headers: r.headers,
					retryable: !ok && isRetryableStatus(r.status),
					retryAfterMs: parseRetryAfter(r.headers.get('retry-after')),
					error: ok ? null : describeError(r.status, data, text),
					ms
				};
			} catch (e) {
				const err = e as Error & { cause?: { code?: string } };
				const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
				res = {
					ok: false,
					status: 0,
					data: null as T,
					text: '',
					headers: null,
					retryable: true,
					retryAfterMs: null,
					error: timedOut ? `Request timed out after ${this.opts.timeoutMs} ms` : `Network error: ${err.cause?.code ?? err.message}`.slice(0, 200),
					ms: Date.now() - started
				};
			}
			calls.push({ method, endpoint, status: res.status, ms: res.ms });

			const canRetry = res.retryable && attempt < this.opts.maxRetries && (idempotent || res.status === 429);
			if (!canRetry) return res;
			const backoff = this.opts.retryBaseMs * 2 ** attempt;
			if (res.retryAfterMs !== null && res.retryAfterMs > this.opts.maxRetryAfterMs) return res; // too long to wait here; caller sees retryable
			await sleep(res.retryAfterMs !== null ? res.retryAfterMs : backoff);
			attempt++;
		}
	}
}

/** ActionResult for a failed HTTP response. */
export function failed(res: HttpResponse, calls: ApiCallRecord[], what: string): ActionResult {
	return { ok: false, calls, error: `${what}: ${res.error ?? 'failed'}`, retryable: res.retryable };
}

export function success(calls: ApiCallRecord[], output?: Record<string, unknown>): ActionResult {
	return output ? { ok: true, calls, output } : { ok: true, calls };
}

/** Parse an ISO string / epoch ms into ISO, or null. */
export function toIso(v: unknown): string | null {
	if (v === null || v === undefined || v === '' || v === 0) return null;
	const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function uniqueEmails(values: unknown[]): string[] {
	const out = new Set<string>();
	for (const v of values) {
		const parts = Array.isArray(v) ? v : [v];
		for (const p of parts) {
			if (typeof p !== 'string') continue;
			for (const piece of p.split(/[,;\s]+/)) {
				const e = piece.trim().toLowerCase();
				if (e.includes('@')) out.add(e);
			}
		}
	}
	return [...out];
}
