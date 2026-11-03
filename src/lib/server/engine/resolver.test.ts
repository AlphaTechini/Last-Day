import { describe, expect, it } from 'vitest';
import { callCost, snapshotMonthlyCost } from './cost.ts';
import { createInferenceClient, type ChatRequest, type InferenceClient } from './inference.ts';
import type { MatchEmployee } from './matcher.ts';
import { buildMessages, prefilterCandidates, resolveIdentity, safeRaw, scoreCandidate, type CallRecord } from './resolver.ts';
import { jaroWinkler, sameGivenName } from './similarity.ts';

const dana: MatchEmployee = { id: 'e-dana', name: 'Dana Okafor', workEmail: 'dana.okafor@northwind.example', aliases: ['dana.o@gmail.example', 'dokafor.dev@proton.example'], startDate: '2022-03-14' };
const robert: MatchEmployee = { id: 'e-rob', name: 'Robert Lindqvist', workEmail: 'robert.lindqvist@northwind.example', aliases: [] };
const priya: MatchEmployee = { id: 'e-priya', name: 'Priya Raman', workEmail: 'priya.raman@northwind.example', aliases: [] };
const staff = [dana, robert, priya];
const settings = { defaultModel: 'glm-5.3-flash', escalationModel: 'glm-5.2', confidenceThreshold: 0.8 };

const account = { system: 'github', kind: 'user', username: 'dok-dev', displayName: 'Dana O.', emails: ['dana.o@gmail.example'], createdAt: '2022-03-16T10:00:00Z', raw: { login: 'dok-dev', api_token: 'SECRET', nested: { password: 'x', plan: 'free' } } };

function completion(model: string, content: unknown, usage = { prompt_tokens: 1000, completion_tokens: 500 }, finish = 'stop') {
	return { id: 'c1', object: 'chat.completion', model, choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { ...usage, completion_tokens_details: { reasoning_tokens: 100 } } };
}
const answer = (employee_id: string | null, confidence: number, evidence: string[] = ['Alias dana.o@gmail.example is on her profile']) => ({ employee_id, confidence, evidence, reason_if_none: employee_id ? '' : 'no candidate fits' });

/** A client double that serves queued responses and records requests. */
function scripted(responses: Array<(req: ChatRequest) => { model: string; content: unknown; usage?: any; finish?: string }>) {
	const requests: ChatRequest[] = [];
	const client: InferenceClient = {
		async chat(req) {
			requests.push(req);
			const r = responses[requests.length - 1](req);
			return { content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content), model: r.model, promptTokens: r.usage?.prompt_tokens ?? 1000, completionTokens: r.usage?.completion_tokens ?? 500, reasoningTokens: 0, finishReason: r.finish ?? 'stop', latencyMs: 12, mode: 'json_schema' };
		}
	};
	return { client, requests };
}

describe('string similarity', () => {
	it('jaro-winkler behaves', () => {
		expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.95);
		expect(jaroWinkler('abc', 'xyz')).toBe(0);
		expect(jaroWinkler('same', 'same')).toBe(1);
	});
	it('knows nicknames', () => {
		expect(sameGivenName('bob', 'robert')).toBe(true);
		expect(sameGivenName('dan', 'daniel')).toBe(true);
		expect(sameGivenName('dana', 'priya')).toBe(false);
	});
});

describe('candidate pre-filter', () => {
	it('finds alias overlap with a high score', () => {
		const c = scoreCandidate(account, dana);
		expect(c.score).toBeGreaterThanOrEqual(0.95);
		expect(c.signals.join(' ')).toContain('alias');
	});
	it('finds nickname handles', () => {
		const c = prefilterCandidates({ system: 'mattermost', kind: 'user', username: 'bobl', displayName: 'Bob L', emails: [] }, staff);
		expect(c[0]?.employee.id).toBe('e-rob');
	});
	it('drops unrelated employees and caps the list', () => {
		const c = prefilterCandidates(account, staff);
		expect(c.map((x) => x.employee.id)).toEqual(['e-dana']);
		expect(prefilterCandidates({ system: 'github', kind: 'user', username: 'qwxzv', displayName: null, emails: [] }, staff)).toEqual([]);
	});
});

describe('safe metadata', () => {
	it('strips credential-looking keys at any depth', () => {
		const raw = safeRaw(account.raw as Record<string, unknown>);
		expect(JSON.stringify(raw)).not.toMatch(/SECRET|password|token/i);
		expect(raw.login).toBe('dok-dev');
	});
	it('never puts secrets in the prompt', () => {
		const msgs = buildMessages({ account, candidates: [dana] });
		expect(JSON.stringify(msgs)).not.toContain('SECRET');
	});
});

describe('cost math', () => {
	it('prices tokens per million for the returned model', () => {
		expect(callCost('glm-5.3-flash', 'glm-5.3-flash', 1000, 500).costUsd).toBeCloseTo(0.000275, 10);
		expect(callCost('glm-5.2', 'glm-5.2', 1_000_000, 1_000_000).costUsd).toBeCloseTo(3.75, 8);
	});
	it('prices a fallback by the model that actually answered', () => {
		const c = callCost('glm-5.3-flash', 'deepseek-v4.1-flash-1017', 1_000_000, 0);
		expect(c.costUsd).toBeCloseTo(0.15, 8);
	});
	it('snapshots cost $0.05 per GB-month', () => {
		expect(snapshotMonthlyCost(25)).toBe(1.25);
		expect(snapshotMonthlyCost(0)).toBe(0);
	});
});

describe('resolveIdentity', () => {
	it('returns a schema-valid answer without escalating when confident', async () => {
		const { client, requests } = scripted([() => ({ model: 'glm-5.3-flash', content: answer('e-dana', 0.93) })]);
		const calls: CallRecord[] = [];
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings, onCall: (c) => void calls.push(c) });
		expect(r).toMatchObject({ ok: true, employeeId: 'e-dana', confidence: 0.93, escalated: false, model: 'glm-5.3-flash' });
		expect(requests).toHaveLength(1);
		expect(requests[0].schemaName).toBe('identity_match');
		expect(requests[0].reasoningEffort).toBe('low');
		expect(requests[0].maxCompletionTokens).toBeLessThanOrEqual(2048);
		expect((requests[0].schema as any).additionalProperties).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0].costUsd).toBeCloseTo(0.000275, 10);
	});

	it('retries once on invalid JSON', async () => {
		const { client, requests } = scripted([() => ({ model: 'glm-5.3-flash', content: 'sure! here you go {not json' }), () => ({ model: 'glm-5.3-flash', content: answer('e-dana', 0.9) })]);
		const calls: CallRecord[] = [];
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings, onCall: (c) => void calls.push(c) });
		expect(r.ok).toBe(true);
		expect(requests).toHaveLength(2);
		expect(calls.map((c) => c.ok)).toEqual([false, true]);
		expect(calls[0].error).toMatch(/Invalid JSON/);
		expect(requests[1].messages.at(-1)!.content).toContain('not valid');
	});

	it('treats a schema violation as a parse failure', async () => {
		const bad = { employee_id: 'e-dana', confidence: 'high', evidence: [], reason_if_none: '' };
		const { client } = scripted([() => ({ model: 'glm-5.3-flash', content: bad }), () => ({ model: 'glm-5.3-flash', content: bad }), () => ({ model: 'glm-5.2', content: bad }), () => ({ model: 'glm-5.2', content: bad })]);
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings });
		expect(r.ok).toBe(false);
		expect(r.employeeId).toBeNull();
	});

	it('escalates once below the threshold and keeps the escalated answer', async () => {
		const { client, requests } = scripted([() => ({ model: 'glm-5.3-flash', content: answer('e-dana', 0.55) }), () => ({ model: 'glm-5.2', content: answer(null, 0.9, [], ) })]);
		const calls: CallRecord[] = [];
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings, onCall: (c) => void calls.push(c) });
		expect(requests.map((q) => q.model)).toEqual(['glm-5.3-flash', 'glm-5.2']);
		expect(r).toMatchObject({ escalated: true, employeeId: null, confidence: 0.9, model: 'glm-5.2' });
		expect(calls.map((c) => c.escalated)).toEqual([false, true]);
	});

	it('does not escalate twice', async () => {
		const { client, requests } = scripted([() => ({ model: 'glm-5.3-flash', content: answer('e-dana', 0.2) }), () => ({ model: 'glm-5.2', content: answer('e-dana', 0.3) })]);
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings });
		expect(requests).toHaveLength(2);
		expect(r.confidence).toBe(0.3);
	});

	it('records a model mismatch with a warning and prices the model that answered', async () => {
		const { client } = scripted([() => ({ model: 'deepseek-v4.1-flash-1017', content: answer('e-dana', 0.95), usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } })]);
		const calls: CallRecord[] = [];
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings, onCall: (c) => void calls.push(c) });
		expect(calls[0].requestedModel).toBe('glm-5.3-flash');
		expect(calls[0].returnedModel).toBe('deepseek-v4.1-flash-1017');
		expect(calls[0].warnings.join(' ')).toMatch(/Model mismatch/);
		expect(calls[0].costUsd).toBeCloseTo(0.15, 8);
		expect(r.model).toBe('deepseek-v4.1-flash-1017');
	});

	it('ignores an employee id that was not offered', async () => {
		const { client } = scripted([() => ({ model: 'glm-5.3-flash', content: answer('e-ghost', 0.99) })]);
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings: { ...settings, escalationModel: settings.defaultModel } });
		expect(r.employeeId).toBeNull();
		expect(r.reasonIfNone).toMatch(/not a candidate/);
	});

	it('does not trust a match with no evidence', async () => {
		const { client } = scripted([() => ({ model: 'glm-5.3-flash', content: answer('e-dana', 0.99, []) }), () => ({ model: 'glm-5.2', content: answer('e-dana', 0.99, []) })]);
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings });
		expect(r.confidence).toBeLessThanOrEqual(0.5);
	});

	it('reports HTTP failures without throwing', async () => {
		const client: InferenceClient = { chat: async () => { throw Object.assign(new Error('Inference 401: Invalid API key'), { status: 401 }); } };
		const calls: CallRecord[] = [];
		const r = await resolveIdentity({ account, candidates: [dana] }, { client, settings, onCall: (c) => void calls.push(c) });
		expect(r.ok).toBe(false);
		expect(calls).toHaveLength(1); // auth errors do not escalate
		expect(calls[0].ok).toBe(false);
	});
});

describe('inference client over fetch', () => {
	const okBody = (model = 'glm-5.3-flash') => JSON.stringify(completion(model, answer(null, 0.9, [])));
	const json = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });

	it('sends a strict json_schema request with reasoning effort and a token cap, and reads usage', async () => {
		const seen: any[] = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			seen.push({ url, init, body: JSON.parse(init.body as string) });
			return json(200, okBody());
		}) as unknown as typeof fetch;
		const c = createInferenceClient({ baseUrl: 'https://inf.test/v1/', apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
		const res = await c.chat({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'x' }], schemaName: 'identity_match', schema: { type: 'object' }, maxCompletionTokens: 1000, reasoningEffort: 'low' });
		expect(seen[0].url).toBe('https://inf.test/v1/chat/completions');
		expect((seen[0].init.headers as any).authorization).toBe('Bearer k');
		expect(seen[0].body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'identity_match', strict: true } });
		expect(seen[0].body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 1000 });
		expect(res).toMatchObject({ model: 'glm-5.3-flash', promptTokens: 1000, completionTokens: 500, reasoningTokens: 100, mode: 'json_schema' });
	});

	it('falls back to json_object on a 400 for json_schema and remembers it', async () => {
		const modes: string[] = [];
		const fetchImpl = (async (_u: string, init: RequestInit) => {
			const b = JSON.parse(init.body as string);
			modes.push(b.response_format.type);
			return b.response_format.type === 'json_schema' ? json(400, JSON.stringify({ error: { message: 'unsupported response_format' } })) : json(200, okBody());
		}) as unknown as typeof fetch;
		const c = createInferenceClient({ apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
		const req = { model: 'm1', messages: [{ role: 'user' as const, content: 'x' }], schemaName: 's', schema: {}, maxCompletionTokens: 100 };
		expect((await c.chat(req)).mode).toBe('json_object');
		await c.chat(req);
		expect(modes).toEqual(['json_schema', 'json_object', 'json_object']);
	});

	it('retries 429 after Retry-After and does not retry 401', async () => {
		let n = 0;
		const waits: number[] = [];
		const f429 = (async () => (++n === 1 ? json(429, '{"error":{"message":"slow down"}}', { 'retry-after': '3' }) : json(200, okBody()))) as unknown as typeof fetch;
		const c = createInferenceClient({ apiKey: 'k', fetchImpl: f429, sleepImpl: async (ms) => void waits.push(ms) });
		await c.chat({ model: 'm', messages: [], schemaName: 's', schema: {}, maxCompletionTokens: 10 });
		expect(n).toBe(2);
		expect(waits).toEqual([3000]);

		let m = 0;
		const f401 = (async () => (m++, json(401, '{"error":{"message":"Invalid API key"}}'))) as unknown as typeof fetch;
		const c2 = createInferenceClient({ apiKey: 'bad', fetchImpl: f401, sleepImpl: async () => {} });
		await expect(c2.chat({ model: 'm', messages: [], schemaName: 's', schema: {}, maxCompletionTokens: 10 })).rejects.toMatchObject({ status: 401 });
		expect(m).toBe(1);
	});

	it('limits concurrent requests', async () => {
		let active = 0;
		let peak = 0;
		const fetchImpl = (async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 15));
			active--;
			return json(200, okBody());
		}) as unknown as typeof fetch;
		const c = createInferenceClient({ apiKey: 'k', fetchImpl, concurrency: 4, sleepImpl: async () => {} });
		await Promise.all(Array.from({ length: 12 }, () => c.chat({ model: 'm', messages: [], schemaName: 's', schema: {}, maxCompletionTokens: 10 })));
		expect(peak).toBe(4);
	});
});
