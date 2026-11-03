// Pure row -> DTO helpers (no DB access) so they can be unit tested.
import type { AccountView, ActionStep, EmployeeDetail, EmployeeListItem, LinkMethod, RecheckStatus, RunItemStatus, RunItemView, RunStatus, RunSummary, SystemId } from '#lib/types.ts';
import type { Sql } from '#lib/server/db/index.ts';

type Row = Record<string, any>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Date | string | null -> ISO string | null */
export function iso(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	const d = v instanceof Date ? v : new Date(v as string);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** numeric (string from postgres.js) | number | null -> number | null */
export function num(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

export const num0 = (v: unknown): number => num(v) ?? 0;

/** postgres `date` (selected ::text) -> 'YYYY-MM-DD' | null. Also tolerates Date objects (local calendar day). */
export function dateOnly(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	if (v instanceof Date) {
		const p = (n: number) => String(n).padStart(2, '0');
		return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
	}
	return String(v).slice(0, 10);
}

export function strArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? JSON.stringify(x) : String(x)));
}

/**
 * SQL fragment selecting everything mapAccount() needs from `accounts a`.
 * Instance fields come from accounts.raw_json keys: plan, monthly_cost, region, power_status.
 * Callers add link columns (link_method, confidence, evidence) themselves.
 */
export function accountColumns(sql: Sql) {
	return sql`a.id AS account_id, a.system, a.kind, a.external_id, a.username, a.display_name, a.emails, a.active,
		a.created_at AS account_created_at, a.last_active_at, a.flag,
		a.raw_json->>'plan' AS plan,
		(a.raw_json->>'monthly_cost')::numeric AS monthly_cost,
		a.raw_json->>'region' AS region,
		a.raw_json->>'power_status' AS power_status`;
}

export function mapAccount(r: Row, link?: { method: string | null; confidence: unknown; evidence: unknown }): AccountView {
	const l = link ?? { method: r.link_method ?? null, confidence: r.confidence ?? null, evidence: r.evidence_json ?? [] };
	const view: AccountView = {
		id: r.account_id,
		system: r.system as SystemId,
		kind: r.kind,
		externalId: r.external_id,
		username: r.username ?? null,
		displayName: r.display_name ?? null,
		emails: r.emails ?? [],
		createdAt: iso(r.account_created_at),
		lastActiveAt: iso(r.last_active_at),
		active: !!r.active,
		linkMethod: (l.method as LinkMethod | null) ?? null,
		confidence: num(l.confidence),
		evidence: strArray(l.evidence)
	};
	if (r.kind === 'instance') {
		view.plan = r.plan ?? null;
		view.monthlyCostUsd = num(r.monthly_cost);
		view.region = r.region ?? null;
		view.powerStatus = r.power_status ?? null;
	}
	return view;
}

export function mapStep(s: Row): ActionStep {
	const status = ['pending', 'running', 'done', 'failed', 'skipped'].includes(s?.status) ? s.status : 'pending';
	return {
		action: String(s?.action ?? ''),
		label: String(s?.label ?? s?.action ?? ''),
		status,
		endpoint: s?.endpoint ?? null,
		httpStatus: num(s?.httpStatus ?? s?.http_status),
		at: iso(s?.at)
	};
}

export function mapSteps(v: unknown): ActionStep[] {
	return Array.isArray(v) ? v.map(mapStep) : [];
}

export function mapEmployeeListItem(r: Row): EmployeeListItem {
	return {
		id: r.id,
		name: r.name,
		workEmail: r.work_email,
		role: r.role ?? '',
		department: r.department ?? '',
		managerName: r.manager_name ?? null,
		status: r.status,
		startDate: dateOnly(r.start_date),
		accountCount: num0(r.account_count),
		systems: (r.systems ?? []) as SystemId[]
	};
}

export function mapEmployeeDetail(r: Row): EmployeeDetail {
	return {
		...mapEmployeeListItem(r),
		aliases: r.aliases ?? [],
		managerId: r.manager_id ?? null,
		endDate: dateOnly(r.end_date)
	};
}

export function mapRunSummary(r: Row): RunSummary {
	const regressedCount = num0(r.regressed_count);
	return {
		id: r.id,
		employeeId: r.employee_id,
		employeeName: r.employee_name,
		status: r.status as RunStatus,
		startedAt: iso(r.started_at)!,
		startedBy: r.started_by_name ?? 'system',
		verifiedAt: iso(r.verified_at),
		itemCount: num0(r.item_count),
		verifiedCount: Math.max(0, num0(r.verified_count) - regressedCount),
		regressedCount,
		aiCostUsd: num0(r.ai_cost_usd),
		recheck: r.recheck_status
			? { status: r.recheck_status as RecheckStatus, dueAt: iso(r.recheck_due_at)!, firedAt: iso(r.recheck_fired_at) }
			: null
	};
}

export function mapRunItem(r: Row): RunItemView {
	const view: RunItemView = {
		id: r.item_id,
		account: mapAccount(r, { method: r.item_link_method, confidence: r.item_confidence, evidence: r.item_evidence }),
		matchKind: r.match_kind,
		actions: mapSteps(r.steps_json),
		status: r.item_status as RunItemStatus,
		attempts: num0(r.attempts),
		lastError: r.last_error ?? null,
		verifiedState: r.verified_state ?? null,
		verifiedAt: iso(r.item_verified_at)
	};
	if (r.match_kind === 'server') {
		view.snapshotId = r.snapshot_id ?? null;
		view.snapshotCostUsdMonth = num(r.snapshot_cost_usd_month);
		view.stillBillingUsdMonth = num(r.still_billing_usd_month);
	}
	return view;
}

export function secondsBetween(from: unknown, to: unknown): number | null {
	const a = iso(from);
	const b = iso(to);
	if (!a || !b) return null;
	return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
}

/** rechecks.result_json -> diff entries `{itemId,label,observed}` */
export function mapRecheckDiff(resultJson: unknown): { itemId: string; label: string; observed: string }[] {
	const diff = (resultJson as Row | null)?.diff;
	if (!Array.isArray(diff)) return [];
	return diff.map((d: Row) => ({ itemId: String(d?.itemId ?? ''), label: String(d?.label ?? ''), observed: String(d?.observed ?? '') }));
}

/** Items counted as "done" for verifiedCount: target system confirmed (servers: halted+snapshotted or beyond). */
export const VERIFIED_ITEM_STATUSES = ['verified', 'awaiting_manager', 'destroying', 'removed'] as const;
