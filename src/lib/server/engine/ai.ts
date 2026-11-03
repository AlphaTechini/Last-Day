// Database-backed glue around the resolver: which accounts to ask about, logging each call, storing suggestions.
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import { getSettings } from '#lib/server/settings.ts';
import type { SystemId } from '#lib/types.ts';
import type { Actor } from './index.ts';
import { getInferenceClient, inferenceConfigured } from './inference.ts';
import type { MatchAccount, MatchEmployee } from './matcher.ts';
import { type CallRecord, prefilterCandidates, resolveIdentity } from './resolver.ts';
import { config } from './state.ts';

type Row = Record<string, any>;

export interface UnlinkedAccount extends MatchAccount {
	id: string;
	system: SystemId;
	active: boolean;
	flag: string;
}

export interface AiPassOptions {
	actor: Actor;
	accounts: UnlinkedAccount[];
	/** Employees the model may attribute accounts to (active or offboarding). */
	employees: MatchEmployee[];
	/** account id -> employee ids HR rejected */
	rejections: Map<string, Set<string>>;
	runId?: string | null;
	/** When set, only accounts for which this employee is a plausible candidate are sent to the model. */
	scopeEmployeeId?: string;
	/** Skip accounts that already got an answer in the last 24 hours (full sweeps). */
	skipRecentlyAsked?: boolean;
}

export interface AiPassResult {
	skippedNoKey: boolean;
	asked: number;
	calls: number;
	suggested: number;
	failed: number;
}

export async function recordAiCall(call: CallRecord, ctx: { runId: string | null; account: UnlinkedAccount; actor: Actor; employeeNames: Map<string, string>; scopeEmployeeId?: string | null }): Promise<void> {
	const [row] = await sql`
		INSERT INTO ai_calls (run_id, account_id, requested_model, returned_model, prompt_tokens, completion_tokens, cost_usd, latency_ms, ok, error, mode, escalated)
		VALUES (${ctx.runId}, ${ctx.account.id}, ${call.requestedModel}, ${call.returnedModel}, ${call.promptTokens}, ${call.completionTokens},
		        ${call.costUsd}, ${call.latencyMs}, ${call.ok}, ${call.error}, ${call.mode}, ${call.escalated})
		RETURNING id`;
	if (ctx.runId) {
		await sql`UPDATE runs SET ai_cost_usd = (SELECT COALESCE(sum(cost_usd), 0) FROM ai_calls WHERE run_id = ${ctx.runId}) WHERE id = ${ctx.runId}`;
	}
	const label = ctx.account.username ?? ctx.account.displayName ?? ctx.account.emails[0] ?? 'account';
	const answered = call.answer?.employee_id ? (ctx.employeeNames.get(call.answer.employee_id) ?? null) : null;
	const outcome = !call.ok ? `failed (${call.error})` : answered ? `${answered}, ${Math.round((call.answer?.confidence ?? 0) * 100)}%` : 'no match';
	await audit({
		actorId: ctx.actor.id,
		actorName: ctx.actor.name,
		runId: ctx.runId,
		employeeId: call.answer?.employee_id ?? ctx.scopeEmployeeId ?? null,
		system: ctx.account.system,
		kind: 'ai_call',
		summary: `AI ${call.escalated ? 'escalation ' : ''}(${call.returnedModel ?? call.requestedModel}) on ${ctx.account.system} ${label}: ${outcome}`,
		detail: {
			aiCallId: row.id,
			accountId: ctx.account.id,
			model: call.returnedModel ?? call.requestedModel,
			requestedModel: call.requestedModel,
			returnedModel: call.returnedModel,
			tokens: call.promptTokens + call.completionTokens,
			promptTokens: call.promptTokens,
			completionTokens: call.completionTokens,
			costUsd: call.costUsd,
			latencyMs: call.latencyMs,
			mode: call.mode,
			escalated: call.escalated,
			ok: call.ok,
			error: call.error,
			confidence: call.answer?.confidence ?? null,
			employeeId: call.answer?.employee_id ?? null,
			evidence: call.answer?.evidence ?? [],
			reasonIfNone: call.answer?.reason_if_none ?? null,
			...(call.warnings.length ? { warning: call.warnings.join('; '), warnings: call.warnings } : {})
		}
	});
}

/** Ask the model about unlinked accounts and store the answers as ai_suggestions. Never throws. */
export async function runAiPass(opts: AiPassOptions): Promise<AiPassResult> {
	const result: AiPassResult = { skippedNoKey: false, asked: 0, calls: 0, suggested: 0, failed: 0 };
	const client = getInferenceClient();
	if (!client || !inferenceConfigured()) {
		result.skippedNoKey = true;
		await audit({
			actorId: opts.actor.id,
			actorName: opts.actor.name,
			runId: opts.runId ?? null,
			employeeId: opts.scopeEmployeeId ?? null,
			kind: 'match',
			summary: 'AI resolver skipped: no VULTR_INFERENCE_API_KEY configured, rules only',
			detail: { reason: 'no_api_key' }
		});
		return result;
	}

	const settings = await getSettings();
	const cfg = config();
	const employeeNames = new Map(opts.employees.map((e) => [e.id, e.name]));
	const recentlyAsked = new Set<string>();
	if (opts.skipRecentlyAsked && opts.accounts.length) {
		const rows = await sql`SELECT DISTINCT account_id FROM ai_calls WHERE ok AND account_id IS NOT NULL AND created_at > now() - interval '24 hours'`;
		for (const r of rows) recentlyAsked.add(r.account_id);
	}

	type Job = { account: UnlinkedAccount; candidates: MatchEmployee[] };
	const jobs: Job[] = [];
	for (const account of opts.accounts) {
		if (!account.active && account.kind !== 'instance') continue;
		if (account.flag === 'service' || account.kind === 'apikey') continue;
		if (recentlyAsked.has(account.id)) continue;
		const rejected = opts.rejections.get(account.id) ?? new Set<string>();
		const pool = opts.employees.filter((e) => !rejected.has(e.id));
		const scored = prefilterCandidates(account, pool, { startDateWindowDays: cfg.startDateWindowDays });
		let candidates = scored.map((c) => c.employee);
		if (opts.scopeEmployeeId) {
			if (!candidates.some((c) => c.id === opts.scopeEmployeeId)) continue;
		}
		if (!candidates.length) continue;
		jobs.push({ account, candidates });
		if (jobs.length >= cfg.maxAiCallsPerSweep) break;
	}

	await Promise.all(
		jobs.map(async ({ account, candidates }) => {
			result.asked++;
			const res = await resolveIdentity(
				{ account, candidates },
				{
					client,
					settings: { defaultModel: settings.defaultModel, escalationModel: settings.escalationModel, confidenceThreshold: settings.aiConfidenceThreshold },
					onCall: async (call) => {
						result.calls++;
						try {
							await recordAiCall(call, { runId: opts.runId ?? null, account, actor: opts.actor, employeeNames, scopeEmployeeId: opts.scopeEmployeeId });
						} catch (e) {
							console.error('[engine] failed to record AI call:', e instanceof Error ? e.message : e);
						}
					}
				}
			);
			if (!res.ok) {
				result.failed++;
				return;
			}
			await sql.begin(async (tx) => {
				await tx`DELETE FROM ai_suggestions WHERE account_id = ${account.id}`;
				if (res.employeeId) {
					await tx`
						INSERT INTO ai_suggestions (account_id, employee_id, confidence, evidence_json, model)
						VALUES (${account.id}, ${res.employeeId}, ${res.confidence}, ${tx.json(res.evidence as never)}, ${res.model ?? res.requestedModel})`;
				}
			});
			if (res.employeeId) result.suggested++;
		})
	);
	return result;
}

export function toMatchEmployee(r: Row): MatchEmployee {
	return {
		id: r.id,
		name: r.name,
		workEmail: r.work_email,
		aliases: r.aliases ?? [],
		startDate: r.start_date ?? null,
		department: r.department ?? '',
		role: r.role ?? ''
	};
}
