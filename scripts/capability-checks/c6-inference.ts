/**
 * C6: Vultr Serverless Inference. Model catalog, structured output, model echo,
 * misspelled model id.
 *
 * Makes billable chat calls (about 20 small requests on glm-5.3-flash, costs
 * cents), so it runs without --apply. --escalation adds 5 calls on glm-5.2.
 *
 * Checks:
 *   1. GET /models (public): the three candidate ids exist, and the main model
 *      lists response_format and structured_outputs.
 *   2. 20 json_schema calls on glm-5.3-flash (reasoning_effort low, capped
 *      max_completion_tokens). Each reply must parse against the schema, carry
 *      usage, and echo the requested model id.
 *   3. A misspelled model id: recorded as 404 or as a silent fallback.
 *   4. With --escalation: 5 calls on glm-5.2 with the same checks.
 */
import {
	arrayIn,
	bearer,
	isMain,
	parseFlags,
	req,
	runCheck,
	sleep,
	type Checker,
	type Ctx,
	type Outcome,
	type Res,
	type RunFlags,
} from './lib.js';

const NAME = 'c6-inference';
const DEFAULT_BASE = 'https://api.vultrinference.com/v1';
const MAIN = 'glm-5.3-flash';
const ESCALATION = 'glm-5.2';
const DEEPSEEK = 'deepseek-v4.1-flash-1017';
const MISSPELLED = 'glm-5.3-flsh';
const SYSTEM = 'You link accounts to employees. Answer only with JSON.';
const REQUIRED_KEYS = ['employee_id', 'confidence', 'evidence', 'reason_if_none'];

/** Schema from API_REFERENCE 5.3, with confidence bounds. */
const SCHEMA_BOUNDED = {
	type: 'object',
	additionalProperties: false,
	required: REQUIRED_KEYS,
	properties: {
		employee_id: { type: ['string', 'null'] },
		confidence: { type: 'number', minimum: 0, maximum: 1 },
		evidence: { type: 'array', items: { type: 'string' } },
		reason_if_none: { type: 'string' },
	},
};

/** Fallback if strict mode rejects minimum/maximum (API_REFERENCE 5.3); bounds are then checked in code. */
const SCHEMA_UNBOUNDED = {
	...SCHEMA_BOUNDED,
	properties: { ...SCHEMA_BOUNDED.properties, confidence: { type: 'number' } },
};

const FIRST = ['Dana', 'Priya', 'Tomas', 'Aiko', 'Miguel', 'Lena', 'Omar', 'Sofia', 'Kwame', 'Ingrid', 'Ravi', 'Mei', 'Felix', 'Amara', 'Jonas', 'Yuki', 'Noor', 'Diego', 'Hana', 'Mateo'];
const LAST = ['Kim', 'Rao', 'Novak', 'Tanaka', 'Ortega', 'Berg', 'Haddad', 'Lopez', 'Mensah', 'Larsen', 'Iyer', 'Chen', 'Weber', 'Okafor', 'Lind', 'Sato', 'Aziz', 'Ruiz', 'Park', 'Cruz'];
const SOURCES = ['github', 'mattermost', 'keycloak'];

interface Fixture {
	profile: object;
	candidate: object;
	expectNull: boolean;
}

/** Synthetic resolver inputs: fictional people on .test and .example domains. Every fifth has no employee match. */
function fixture(i: number): Fixture {
	const first = FIRST[i % FIRST.length];
	const last = LAST[i % LAST.length];
	const expectNull = i % 5 === 4;
	const profile = {
		employee_id: `E${100 + i}`,
		name: `${first} ${last}`,
		work_email: `${first.toLowerCase()}.${last.toLowerCase()}@company.test`,
		team: ['platform', 'data', 'sales', 'finance'][i % 4],
	};
	const candidate = expectNull
		? { source: SOURCES[i % 3], username: `ext-${i}`, display_name: `Contractor ${i}`, email: `contractor${i}@example.org` }
		: {
				source: SOURCES[i % 3],
				username: `${first.toLowerCase()}${last.slice(0, 2).toLowerCase()}${i}`,
				display_name: `${first} ${last.charAt(0)}.`,
				email: i % 2 ? `${first.toLowerCase()}@example.org` : null,
			};
	return { profile, candidate, expectNull };
}

function userMessage(fx: Fixture): string {
	return JSON.stringify({
		task: 'Decide which employee this account belongs to. Use employee_id null when none matches.',
		employee_profile: fx.profile,
		candidate_account: fx.candidate,
	});
}

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C6 Serverless Inference: structured output and model checks',
			required: ['VULTR_INFERENCE_API_KEY'],
			body: c6,
		},
		flags,
	);
}

async function c6(x: Ctx): Promise<void> {
	const c = x.c;
	const base = (x.opt('VULTR_INFERENCE_BASE_URL') ?? DEFAULT_BASE).replace(/\/+$/, '');
	const key = x.need('VULTR_INFERENCE_API_KEY');

	c.title('Model catalog (public, no key)');
	const cat = await req('GET', `${base}/models?format=openrouter&output_modalities=text`);
	c.assert(cat.status === 200 && Array.isArray(cat.json?.data), 'GET /models: catalog readable', cat);
	const models = arrayIn(cat.json, 'data');
	// Prices in USD per 1M tokens, from the catalog (never hard-coded for the cost meter).
	const prices = new Map<string, Price>();
	for (const m of models) {
		prices.set(m.id, { prompt: Number(m.pricing?.prompt) * 1e6, completion: Number(m.pricing?.completion) * 1e6 });
	}
	for (const id of [MAIN, ESCALATION, DEEPSEEK]) {
		const p = prices.get(id);
		c.assert(
			p !== undefined,
			`model ${id} listed${p ? ` ($${p.prompt.toFixed(2)} in / $${p.completion.toFixed(2)} out per 1M)` : ''}`,
		);
	}
	const main = models.find((m) => m.id === MAIN);
	c.assert(
		['response_format', 'structured_outputs'].every((param) => main?.supported_parameters?.includes(param)),
		`${MAIN} lists response_format and structured_outputs`,
	);
	c.info(`${MAIN} reasoning efforts: ${JSON.stringify(main?.reasoning?.supported_efforts ?? null)}`);

	c.title(`Structured output: 20 calls on ${MAIN}`);
	const mainRun = await runBatch(c, base, key, MAIN, 20, prices, { schema: SCHEMA_BOUNDED, mode: 'min/max bounds' });
	c.assert(
		mainRun.passed === 20,
		`${MAIN}: ${mainRun.passed}/20 parse against the schema, carry usage, and echo the requested model`,
		undefined,
		`schema mode: ${mainRun.mode}; prompt ${mainRun.inTokens} tokens, completion ${mainRun.outTokens} (reasoning ${mainRun.reasoning}); estimated cost $${mainRun.cost.toFixed(5)}`,
	);

	c.title('Misspelled model id');
	const bad = await chat(base, key, MISSPELLED, userMessage(fixture(0)), mainRun.schema);
	c.raw(`misspelled "${MISSPELLED}"`, bad);
	let verdict: string;
	if (bad.status === 404) {
		verdict = 'HTTP 404: no fallback on this route';
	} else if (bad.status === 200) {
		const served = bad.json?.model;
		verdict =
			served === MISSPELLED
				? 'HTTP 200 and echoes the misspelled id (unexpected: check the id)'
				: `HTTP 200 and falls back silently to ${served} (the app must check model == requested)`;
	} else {
		verdict = `HTTP ${bad.status} (${bad.error ?? 'see raw line'})`;
	}
	c.info(`RECORDED: misspelled "${MISSPELLED}" -> ${verdict}`);

	if (x.escalation) {
		c.title(`Escalation candidate: ${ESCALATION}, 5 calls`);
		const esc = await runBatch(c, base, key, ESCALATION, 5, prices, mainRun);
		c.assert(
			esc.passed === 5,
			`${ESCALATION}: ${esc.passed}/5 parse against the schema, carry usage, and echo the requested model`,
			undefined,
			`estimated cost $${esc.cost.toFixed(5)}; reasoning tokens ${esc.reasoning}`,
		);
	} else {
		c.info(`escalation (${ESCALATION}, 5 calls) skipped: rerun with --escalation`);
	}
}

interface Price {
	/** USD per 1M prompt tokens. */
	prompt: number;
	/** USD per 1M completion tokens. */
	completion: number;
}

interface Batch {
	passed: number;
	mode: string;
	schema: object;
	inTokens: number;
	outTokens: number;
	reasoning: number;
	cost: number;
}

async function runBatch(
	c: Checker,
	base: string,
	key: string,
	model: string,
	count: number,
	prices: Map<string, Price>,
	start: { schema: object; mode: string },
): Promise<Batch> {
	let schema = start.schema;
	let mode = start.mode;
	const out: Batch = { passed: 0, mode, schema, inTokens: 0, outTokens: 0, reasoning: 0, cost: 0 };
	for (let i = 0; i < count; i++) {
		const fx = fixture(i);
		let res = await chat(base, key, model, userMessage(fx), schema);
		if (res.status === 400 && mode === 'min/max bounds') {
			c.info('HTTP 400 with minimum/maximum: retrying with bounds removed (API_REFERENCE 5.3 strict subset)');
			schema = SCHEMA_UNBOUNDED;
			mode = 'no min/max';
			out.schema = schema;
			out.mode = mode;
			res = await chat(base, key, model, userMessage(fx), schema);
		}

		const { problems, content, usage } = validate(res, model);
		const pass = problems.length === 0;
		if (pass) out.passed++;
		if (usage) {
			out.inTokens += usage.prompt;
			out.outTokens += usage.completion;
			out.reasoning += usage.reasoning;
			const p = prices.get(model);
			if (p) out.cost += (usage.prompt * p.prompt + usage.completion * p.completion) / 1e6;
		}

		const id = String(i + 1).padStart(2, '0');
		const got = content ? (content.employee_id ?? 'null') : '-';
		const expect = fx.expectNull ? 'null' : 'match';
		c.info(
			`#${id} HTTP ${res.status} ${res.ms} ms model=${res.json?.model ?? '-'} finish=${res.json?.choices?.[0]?.finish_reason ?? '-'} in=${usage?.prompt ?? '-'} out=${usage?.completion ?? '-'} reasoning=${usage?.reasoning ?? '-'} employee_id=${got} (expected ${expect}) ${pass ? 'OK' : `FAIL: ${problems.slice(0, 3).join('; ')}`}`,
		);
		if (!pass) c.raw(`#${id} response`, res);
	}
	return out;
}

/** Retries on 429, 5xx and network errors, honouring Retry-After when present. */
async function chat(base: string, key: string, model: string, content: string, schema: object): Promise<Res> {
	const body = {
		model,
		messages: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content },
		],
		response_format: { type: 'json_schema', json_schema: { name: 'identity_match', strict: true, schema } },
		reasoning_effort: 'low',
		max_completion_tokens: 2048,
		temperature: 0,
		seed: 7,
	};
	for (let attempt = 1; ; attempt++) {
		const res = await req('POST', `${base}/chat/completions`, { headers: bearer(key), body, timeoutMs: 120_000 });
		const transient = res.status === 0 || res.status === 429 || res.status >= 500;
		if (!transient || attempt >= 3) return res;
		const retryAfter = Number(res.headers['retry-after']);
		await sleep((retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
	}
}

interface Verdict {
	problems: string[];
	content?: any;
	usage?: { prompt: number; completion: number; reasoning: number };
}

/** Checks the response envelope (model echo, usage, finish reason) and the parsed content against the schema. */
function validate(res: Res, model: string): Verdict {
	if (res.status !== 200) return { problems: [`HTTP ${res.status}`] };
	const problems: string[] = [];
	const j = res.json ?? {};
	if (j.model !== model) problems.push(`model ${j.model} != requested ${model}`);

	const u = j.usage;
	const usage =
		typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number'
			? {
					prompt: u.prompt_tokens as number,
					completion: u.completion_tokens as number,
					reasoning: Number(u.completion_tokens_details?.reasoning_tokens ?? 0),
				}
			: undefined;
	if (!usage) problems.push('usage missing prompt/completion tokens');

	const choice = j.choices?.[0];
	if (choice?.finish_reason === 'length') problems.push('finish_reason=length (cap reached)');

	const raw = choice?.message?.content;
	if (typeof raw !== 'string') return { problems: [...problems, 'message.content missing'], usage };
	let parsed: any;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { problems: [...problems, 'content is not JSON'], usage };
	}
	return { problems: [...problems, ...schemaProblems(parsed)], content: parsed, usage };
}

function schemaProblems(v: any): string[] {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return ['not an object'];
	const out: string[] = [];
	for (const key of REQUIRED_KEYS) if (!(key in v)) out.push(`missing ${key}`);
	for (const key of Object.keys(v)) if (!REQUIRED_KEYS.includes(key)) out.push(`extra ${key}`);
	if (!(v.employee_id === null || typeof v.employee_id === 'string')) out.push('employee_id not string|null');
	if (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) out.push('confidence not a number in [0,1]');
	if (!Array.isArray(v.evidence) || v.evidence.some((e: unknown) => typeof e !== 'string')) out.push('evidence not string[]');
	if (typeof v.reason_if_none !== 'string') out.push('reason_if_none not a string');
	return out;
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
