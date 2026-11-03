import { sql } from '#lib/server/db/index.ts';
import type { AuditEntry, SystemId } from '#lib/types.ts';
import { isSystemId } from '#lib/server/connection-fields.ts';
import { isUuid, iso } from './mappers.ts';

export interface AuditFilters {
	employee?: string;
	runId?: string;
	system?: string;
	actor?: string;
	kind?: string;
}

export const AUDIT_PAGE_SIZE = 50;

export function mapAuditRow(r: Record<string, any>): AuditEntry {
	return {
		id: String(r.id),
		at: iso(r.at)!,
		actor: r.actor_name ?? 'system',
		runId: r.run_id ?? null,
		employeeName: r.employee_name ?? null,
		system: (r.system as SystemId | null) ?? null,
		kind: r.kind,
		summary: r.summary,
		detail: (r.detail_json && typeof r.detail_json === 'object' ? r.detail_json : {}) as AuditEntry['detail']
	};
}

/** Normalizes raw query params into usable filters (invalid ids are dropped). */
export function cleanAuditFilters(raw: AuditFilters): AuditFilters {
	const out: AuditFilters = {};
	if (raw.employee && isUuid(raw.employee)) out.employee = raw.employee;
	if (raw.runId && isUuid(raw.runId)) out.runId = raw.runId;
	if (raw.system && isSystemId(raw.system)) out.system = raw.system;
	if (raw.actor?.trim()) out.actor = raw.actor.trim().slice(0, 100);
	if (raw.kind?.trim()) out.kind = raw.kind.trim().slice(0, 50);
	return out;
}

export async function listAudit(rawFilters: AuditFilters, page: number, pageSize = AUDIT_PAGE_SIZE): Promise<{ entries: AuditEntry[]; total: number; filters: AuditFilters }> {
	const f = cleanAuditFilters(rawFilters);
	const where = sql`WHERE true
		${f.employee ? sql`AND l.employee_id = ${f.employee}` : sql``}
		${f.runId ? sql`AND l.run_id = ${f.runId}` : sql``}
		${f.system ? sql`AND l.system = ${f.system}` : sql``}
		${f.actor ? sql`AND l.actor_name ILIKE ${'%' + f.actor.replace(/[\\%_]/g, '\\$&') + '%'}` : sql``}
		${f.kind ? sql`AND l.kind = ${f.kind}` : sql``}`;
	const offset = (Math.max(1, page) - 1) * pageSize;
	const [rows, [count]] = await Promise.all([
		sql`SELECT l.id, l.at, l.actor_name, l.run_id, e.name AS employee_name, l.system, l.kind, l.summary, l.detail_json
			FROM audit_log l LEFT JOIN employees e ON e.id = l.employee_id
			${where} ORDER BY l.at DESC, l.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
		sql`SELECT count(*)::int AS n FROM audit_log l ${where}`
	]);
	return { entries: rows.map(mapAuditRow), total: count.n, filters: f };
}

export async function recentAudit(limit = 10): Promise<AuditEntry[]> {
	const rows = await sql`
		SELECT l.id, l.at, l.actor_name, l.run_id, e.name AS employee_name, l.system, l.kind, l.summary, l.detail_json
		FROM audit_log l LEFT JOIN employees e ON e.id = l.employee_id
		ORDER BY l.at DESC, l.id DESC LIMIT ${limit}`;
	return rows.map(mapAuditRow);
}
