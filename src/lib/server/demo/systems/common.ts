// Shared helpers for the demo seeding code. These talk to the real admin APIs of each system
// (or to the dev sandbox in scripts/mock-company, which has the same shapes).
import { HttpClient, type HttpResponse } from '#lib/server/connectors/http.ts';
import type { ApiCallRecord } from '#lib/server/connectors/types.ts';

export interface SeedCtx {
	log: (s: string) => void;
	domain: string;
	env: NodeJS.ProcessEnv;
	/** True when the connection points at the dev sandbox (scripts/mock-company). Only then are sandbox-only admin endpoints used. */
	isMock: boolean;
	/** Origin of the sandbox, when isMock. */
	mockOrigin: string | null;
}

export const DEMO_PASSWORD = (env: NodeJS.ProcessEnv) => env.DEMO_USER_PASSWORD || 'Northwind-demo-1';

/** Thin wrapper over HttpClient for seeding: throws with a readable message when a call fails unexpectedly. */
export class Api {
	readonly calls: ApiCallRecord[] = [];
	constructor(
		readonly http: HttpClient,
		private readonly what: string
	) {}

	async call(method: string, path: string, o: { query?: Record<string, string | number | boolean>; json?: unknown; headers?: Record<string, string>; ok?: number[] } = {}): Promise<HttpResponse> {
		const res = await this.http.request(this.calls, { method, path, query: o.query, json: o.json, headers: o.headers });
		if (!res.ok && !(o.ok ?? []).includes(res.status)) throw new Error(`${this.what}: ${method} ${path} failed (${res.error})`);
		return res;
	}
}

export async function detectMock(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	try {
		const origin = new URL(baseUrl).origin;
		const r = await fetchImpl(`${origin}/__admin/ping`, { signal: AbortSignal.timeout(1500) });
		if (!r.ok) return null;
		const j = (await r.json()) as { sandbox?: boolean };
		return j.sandbox === true ? origin : null;
	} catch {
		return null;
	}
}

export async function mockAdmin(origin: string, path: string, body: unknown): Promise<void> {
	const r = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
	if (!r.ok) throw new Error(`sandbox admin ${path} failed: HTTP ${r.status}`);
}
