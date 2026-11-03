// Identity-match benchmark (F16). Usage: pnpm benchmark
// Runs the labelled set through three pipelines and prints accuracy and cost:
//   1. rules only
//   2. rules + default model
//   3. rules + default model + escalation
// Uses the real Vultr Serverless Inference endpoint when VULTR_INFERENCE_API_KEY is set (or when
// VULTR_INFERENCE_BASE_URL points at a local sandbox). Otherwise it prints the rules-only row, says why the AI
// rows are missing, and exits 0. Results are written to evidence/benchmark/results-<date>.json.
// Env: BENCH_DEFAULT_MODEL (glm-5.3-flash), BENCH_ESCALATION_MODEL (glm-5.2), BENCH_THRESHOLD (0.8), BENCH_MIN_CONFIDENCE (0.5).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInferenceClient, isLocalUrl, DEFAULT_INFERENCE_BASE_URL } from '../src/lib/server/engine/inference.ts';
import { matchByRules, type MatchAccount, type MatchEmployee } from '../src/lib/server/engine/matcher.ts';
import { prefilterCandidates, resolveIdentity, type CallRecord } from '../src/lib/server/engine/resolver.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'evidence/benchmark/labelled-identities.json');

interface Case {
	id: string;
	category: string;
	expectedEmployeeId: string | null;
	note?: string;
	account: MatchAccount;
}
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as { _note: string; employees: MatchEmployee[]; cases: Case[] };

const defaultModel = process.env.BENCH_DEFAULT_MODEL || 'glm-5.3-flash';
const escalationModel = process.env.BENCH_ESCALATION_MODEL || 'glm-5.2';
const threshold = Number(process.env.BENCH_THRESHOLD ?? 0.8);
const minConfidence = Number(process.env.BENCH_MIN_CONFIDENCE ?? 0.5);
const baseUrl = process.env.VULTR_INFERENCE_BASE_URL || DEFAULT_INFERENCE_BASE_URL;
const hasKey = !!process.env.VULTR_INFERENCE_API_KEY || isLocalUrl(baseUrl);

interface Row {
	id: string;
	category: string;
	expected: string | null;
	predicted: string | null;
	via: 'rule' | 'ai' | 'none';
	confidence: number | null;
	model: string | null;
	escalated: boolean;
	correct: boolean;
}
interface Result {
	name: string;
	accuracy: number;
	precision: number | null;
	recall: number;
	falseLinks: number;
	missed: number;
	aiCalls: number;
	tokens: number;
	costUsd: number;
	rows: Row[];
}

async function run(name: string, ai: null | { escalate: boolean }): Promise<Result> {
	const client = ai ? createInferenceClient({ baseUrl, apiKey: process.env.VULTR_INFERENCE_API_KEY || 'sandbox' }) : null;
	const calls: CallRecord[] = [];
	const rows: Row[] = [];
	const todo: Promise<void>[] = [];
	for (const c of data.cases) {
		const row: Row = { id: c.id, category: c.category, expected: c.expectedEmployeeId, predicted: null, via: 'none', confidence: null, model: null, escalated: false, correct: false };
		rows.push(row);
		const rule = matchByRules(c.account, data.employees);
		if (rule) {
			row.predicted = rule.employeeId;
			row.via = 'rule';
			row.confidence = 1;
			continue;
		}
		if (!client) continue;
		const candidates = prefilterCandidates(c.account, data.employees).map((x) => x.employee);
		if (!candidates.length) continue;
		todo.push(
			resolveIdentity(
				{ account: c.account, candidates },
				{
					client,
					settings: { defaultModel, escalationModel: ai!.escalate ? escalationModel : defaultModel, confidenceThreshold: threshold },
					onCall: (call) => void calls.push(call)
				}
			).then((r) => {
				row.via = 'ai';
				row.confidence = r.ok ? r.confidence : null;
				row.model = r.model;
				row.escalated = r.escalated;
				if (r.ok && r.employeeId && r.confidence >= minConfidence) row.predicted = r.employeeId;
			})
		);
	}
	await Promise.all(todo);
	for (const r of rows) r.correct = r.predicted === r.expected;
	const positives = rows.filter((r) => r.expected !== null).length;
	const tp = rows.filter((r) => r.predicted !== null && r.predicted === r.expected).length;
	const linked = rows.filter((r) => r.predicted !== null).length;
	return {
		name,
		accuracy: rows.filter((r) => r.correct).length / rows.length,
		precision: linked ? tp / linked : null,
		recall: positives ? tp / positives : 0,
		falseLinks: rows.filter((r) => r.predicted !== null && r.predicted !== r.expected).length,
		missed: rows.filter((r) => r.expected !== null && r.predicted !== r.expected && r.predicted === null).length,
		aiCalls: calls.length,
		tokens: calls.reduce((s, c) => s + c.promptTokens + c.completionTokens, 0),
		costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
		rows
	};
}

const pct = (n: number | null) => (n === null ? '-' : `${(n * 100).toFixed(1)}%`);
function printTable(results: Result[]) {
	const head = ['pipeline', 'accuracy', 'precision', 'recall', 'false links', 'missed', 'AI calls', 'tokens', 'cost USD'];
	const body = results.map((r) => [r.name, pct(r.accuracy), pct(r.precision), pct(r.recall), String(r.falseLinks), String(r.missed), String(r.aiCalls), String(r.tokens), r.costUsd.toFixed(6)]);
	const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
	const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
	console.log(line(head));
	console.log(widths.map((w) => '-'.repeat(w)).join('  '));
	for (const b of body) console.log(line(b));
}

const positives = data.cases.filter((c) => c.expectedEmployeeId).length;
console.log(`Labelled set: ${data.cases.length} accounts (${positives} belong to an employee, ${data.cases.length - positives} do not), ${data.employees.length} employees.`);
console.log(`Note: ${data._note}\n`);

const results: Result[] = [await run('rules only', null)];

if (!hasKey) {
	printTable(results);
	console.log(
		'\nAI rows skipped: VULTR_INFERENCE_API_KEY is not set (and VULTR_INFERENCE_BASE_URL is not a local sandbox).\n' +
			'Set VULTR_INFERENCE_API_KEY to run rules + model and rules + model + escalation, and to write evidence/benchmark/results-<date>.json.'
	);
	process.exit(0);
}

console.log(`Inference endpoint: ${baseUrl}  default=${defaultModel}  escalation=${escalationModel}  threshold=${threshold}`);
results.push(await run(`rules + ${defaultModel}`, { escalate: false }));
results.push(await run(`rules + ${defaultModel} + escalation (${escalationModel})`, { escalate: true }));
printTable(results);

const wrong = results[results.length - 1].rows.filter((r) => !r.correct);
if (wrong.length) {
	console.log('\nWrong or missed in the last pipeline:');
	for (const r of wrong) console.log(`  ${r.id} [${r.category}] expected ${r.expected ?? 'none'}, got ${r.predicted ?? 'none'} (${r.via}${r.confidence !== null ? ` ${r.confidence.toFixed(2)}` : ''})`);
}

const date = new Date().toISOString().slice(0, 10);
const out = join(root, `evidence/benchmark/results-${date}.json`);
writeFileSync(
	out,
	JSON.stringify(
		{
			date,
			dataset: { path: 'evidence/benchmark/labelled-identities.json', note: data._note, accounts: data.cases.length, employees: data.employees.length },
			config: { baseUrl, defaultModel, escalationModel, confidenceThreshold: threshold, minConfidence },
			pipelines: results.map(({ rows, ...summary }) => ({ ...summary, accuracy: round(summary.accuracy), precision: summary.precision === null ? null : round(summary.precision), recall: round(summary.recall), costUsd: Number(summary.costUsd.toFixed(8)), rows }))
		},
		null,
		1
	) + '\n'
);
console.log(`\nWrote ${out}`);
process.exit(0);

function round(n: number) {
	return Math.round(n * 10000) / 10000;
}
