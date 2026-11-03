import { sql } from '#lib/server/db/index.ts';
import type { RunDetail, RunSummary, SessionUser } from '#lib/types.ts';
import { can } from '#lib/server/permissions.ts';
import { getEmployee } from './employees.ts';
import { accountColumns, isUuid, iso, mapRecheckDiff, mapRunItem, mapRunSummary, num0, secondsBetween, VERIFIED_ITEM_STATUSES } from './mappers.ts';

const SUMMARY_SELECT = sql`
	r.id, r.employee_id, e.name AS employee_name, r.status, r.started_at, u.name AS started_by_name, r.verified_at, r.ai_cost_usd,
	(SELECT count(*)::int FROM run_items i WHERE i.run_id = r.id AND i.status <> 'rejected') AS item_count,
	(SELECT count(*)::int FROM run_items i WHERE i.run_id = r.id AND i.status IN ${sql([...VERIFIED_ITEM_STATUSES])}) AS verified_count,
	c.status AS recheck_status, c.due_at AS recheck_due_at, c.fired_at AS recheck_fired_at`;

const SUMMARY_FROM = sql`
	runs r JOIN employees e ON e.id = r.employee_id
	LEFT JOIN app_users u ON u.id = r.started_by
	LEFT JOIN rechecks c ON c.run_id = r.id`;

export async function listRuns(opts: { limit?: number; statuses?: string[]; employeeId?: string } = {}): Promise<RunSummary[]> {
	const limit = opts.limit ?? 200;
	const statuses = opts.statuses ?? null;
	const employeeId = opts.employeeId && isUuid(opts.employeeId) ? opts.employeeId : null;
	const rows = await sql`
		SELECT ${SUMMARY_SELECT} FROM ${SUMMARY_FROM}
		WHERE true
		${statuses ? sql`AND r.status IN ${sql(statuses)}` : sql``}
		${employeeId ? sql`AND r.employee_id = ${employeeId}` : sql``}
		ORDER BY r.started_at DESC LIMIT ${limit}`;
	return rows.map(mapRunSummary);
}

export async function getRunAuthContext(runId: string): Promise<{ employeeId: string; employeeManagerId: string | null; employeeIsDemo: boolean; status: string } | null> {
	if (!isUuid(runId)) return null;
	const [r] = await sql`
		SELECT r.employee_id, r.status, e.manager_id, e.is_demo FROM runs r JOIN employees e ON e.id = r.employee_id WHERE r.id = ${runId}`;
	return r ? { employeeId: r.employee_id, employeeManagerId: r.manager_id ?? null, employeeIsDemo: !!r.is_demo, status: r.status } : null;
}

export async function runItemBelongsToRun(runId: string, itemId: string): Promise<boolean> {
	if (!isUuid(runId) || !isUuid(itemId)) return false;
	const [r] = await sql`SELECT 1 FROM run_items WHERE id = ${itemId} AND run_id = ${runId}`;
	return !!r;
}

export async function getRunDetail(runId: string, user: SessionUser | null): Promise<RunDetail | null> {
	if (!isUuid(runId)) return null;
	const [row] = await sql`SELECT ${SUMMARY_SELECT} FROM ${SUMMARY_FROM} WHERE r.id = ${runId}`;
	if (!row) return null;
	const summary = mapRunSummary(row);

	const [employee, itemRows, approvalRows, statsRow, recheckRow] = await Promise.all([
		getEmployee(summary.employeeId),
		sql`
			SELECT ${accountColumns(sql)},
			       i.id AS item_id, i.match_kind, i.link_method AS item_link_method, i.confidence AS item_confidence,
			       i.evidence_json AS item_evidence, i.steps_json, i.status AS item_status, i.attempts, i.last_error,
			       i.verified_state, i.verified_at AS item_verified_at, i.snapshot_id, i.snapshot_cost_usd_month, i.still_billing_usd_month
			FROM run_items i JOIN accounts a ON a.id = i.account_id
			WHERE i.run_id = ${runId}
			ORDER BY i.sort_order, a.system, a.username NULLS LAST, i.id`,
		sql`
			SELECT p.id, p.scope, p.created_at, COALESCE(u.name, 'unknown') AS approver_name, COALESCE(array_length(p.item_ids, 1), 0) AS item_count
			FROM approvals p LEFT JOIN app_users u ON u.id = p.approver_id
			WHERE p.run_id = ${runId} ORDER BY p.created_at`,
		sql`
			SELECT count(*)::int AS calls, COALESCE(sum(prompt_tokens + completion_tokens), 0)::bigint AS tokens
			FROM ai_calls WHERE run_id = ${runId}`,
		sql`SELECT status, fired_at, result_json FROM rechecks WHERE run_id = ${runId}`
	]);
	if (!employee) return null;

	const items = itemRows.map(mapRunItem);
	const ctx = { employeeManagerId: employee.managerId, employeeIsDemo: employee.isDemo };
	const { isDemo: _ignored, ...employeeDto } = employee;
	const rc = recheckRow[0];

	return {
		...summary,
		employee: employeeDto,
		items,
		stats: {
			foundByRules: itemRows.filter((r) => String(r.item_link_method ?? '').startsWith('rule:')).length,
			foundByAi: itemRows.filter((r) => r.item_link_method === 'ai').length,
			servers: itemRows.filter((r) => r.match_kind === 'server').length,
			secondsToGreen: secondsBetween(row.started_at, row.verified_at),
			aiCalls: num0(statsRow[0]?.calls),
			aiTokens: num0(statsRow[0]?.tokens)
		},
		approvals: approvalRows.map((a) => ({
			id: a.id,
			approverName: a.approver_name,
			scope: a.scope,
			at: iso(a.created_at)!,
			itemCount: num0(a.item_count)
		})),
		recheckResult: rc ? { status: rc.status, firedAt: iso(rc.fired_at), diff: mapRecheckDiff(rc.result_json) } : null,
		canApprove: can(user, 'run.approve', ctx),
		canDestroy: can(user, 'run.destroy', ctx)
	};
}
