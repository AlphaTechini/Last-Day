import { sql } from '#lib/server/db/index.ts';
import { getSettings } from '#lib/server/settings.ts';
import type { DashboardData, SessionUser } from '#lib/types.ts';
import { listConnectionCards } from './connections.ts';
import { recentAudit } from './audit.ts';
import { listRuns } from './runs.ts';
import { num0 } from './mappers.ts';

export const NEEDS_ATTENTION_STATUSES = ['regressed', 'failed', 'partial'];
export const OPEN_RUN_STATUSES = ['review', 'executing'];

/** Server items that are halted + snapshotted (or being destroyed) and therefore still billing. */
async function pendingDestroys(user: SessionUser) {
	const managerOnly = user.role === 'manager';
	const rows = await sql`
		SELECT i.run_id, i.id AS item_id, e.name AS employee_name,
		       COALESCE(a.display_name, a.username, a.external_id) AS server_label,
		       COALESCE(i.still_billing_usd_month, 0) AS still_billing, COALESCE(i.snapshot_cost_usd_month, 0) AS snapshot_cost
		FROM run_items i
		JOIN runs r ON r.id = i.run_id
		JOIN employees e ON e.id = r.employee_id
		JOIN accounts a ON a.id = i.account_id
		WHERE i.match_kind = 'server' AND i.status = 'awaiting_manager'
		${managerOnly ? sql`AND e.manager_id = ${user.employeeId ?? '00000000-0000-0000-0000-000000000000'}` : sql``}
		ORDER BY r.started_at DESC`;
	return rows.map((r) => ({
		runId: r.run_id as string,
		itemId: r.item_id as string,
		employeeName: r.employee_name as string,
		serverLabel: r.server_label as string,
		stillBillingUsdMonth: num0(r.still_billing),
		snapshotCostUsdMonth: num0(r.snapshot_cost)
	}));
}

/** Counts for the sidebar badges. */
export async function getNavCounts(user: SessionUser) {
	const [row] = await sql`
		SELECT
			(SELECT count(*)::int FROM accounts a WHERE a.gone_at IS NULL AND a.flag <> 'service'
				AND NOT EXISTS (SELECT 1 FROM account_links l WHERE l.account_id = a.id)) AS unknown_count,
			(SELECT count(*)::int FROM runs WHERE status IN ${sql(NEEDS_ATTENTION_STATUSES)}) AS attention_count,
			(SELECT count(*)::int FROM employees WHERE is_demo) AS demo_count,
			(SELECT count(*)::int FROM employees) AS employee_count`;
	const destroys = await pendingDestroys(user);
	return {
		nav: { unknownCount: num0(row.unknown_count), needsAttentionCount: num0(row.attention_count), pendingDestroyCount: destroys.length },
		// A judge, or an empty install, must be able to reach "Reset demo company" before any demo data exists.
		isDemo: num0(row.demo_count) > 0 || user.role === 'judge' || num0(row.employee_count) === 0
	};
}

export async function getDashboard(user: SessionUser): Promise<DashboardData> {
	const [counts, openRuns, needsAttention, destroys, recentActivity, cards, settings, [stats]] = await Promise.all([
		getNavCounts(user),
		listRuns({ statuses: OPEN_RUN_STATUSES, limit: 20 }),
		listRuns({ statuses: NEEDS_ATTENTION_STATUSES, limit: 20 }),
		pendingDestroys(user),
		recentAudit(10),
		listConnectionCards(user),
		getSettings(),
		sql`SELECT
			(SELECT count(*)::int FROM employees) AS employees,
			(SELECT count(*)::int FROM accounts WHERE active AND gone_at IS NULL) AS active_accounts,
			(SELECT count(*)::int FROM runs WHERE status IN ${sql(OPEN_RUN_STATUSES)}) AS open_runs,
			(SELECT COALESCE(sum(still_billing_usd_month), 0) FROM run_items
				WHERE match_kind = 'server' AND status IN ('awaiting_manager', 'destroying')) AS server_spend`
	]);
	return {
		stats: {
			employees: num0(stats.employees),
			activeAccounts: num0(stats.active_accounts),
			unknownAccounts: counts.nav.unknownCount,
			openRuns: num0(stats.open_runs),
			needsAttention: counts.nav.needsAttentionCount,
			monthlyServerSpendUsd: num0(stats.server_spend)
		},
		openRuns,
		needsAttention,
		pendingDestroys: destroys,
		recentActivity,
		connections: cards.map((c) => ({ system: c.system, name: c.name, status: c.status, accountCount: c.accountCount, lastTestedAt: c.lastTestedAt })),
		lastSweepAt: settings.lastSweepAt,
		isDemo: counts.isDemo
	};
}
