import { sql } from '#lib/server/db/index.ts';
import type { AccountView, EmployeeDetail, EmployeeListItem } from '#lib/types.ts';
import { accountColumns, isUuid, mapAccount, mapEmployeeDetail, mapEmployeeListItem } from './mappers.ts';

/**
 * An account counts as "linked" to an employee when account_links has a row for it and the link is
 * either rule/manual based or a confirmed AI link, and the account was not dropped by the last sweep.
 */
const EMPLOYEE_SELECT = sql`
	e.id, e.name, e.work_email, e.role, e.department, e.status, e.start_date::text AS start_date, e.end_date::text AS end_date, e.aliases,
	e.manager_id, m.name AS manager_name, e.is_demo,
	COALESCE(x.account_count, 0) AS account_count, COALESCE(x.systems, '{}') AS systems`;

const EMPLOYEE_FROM = sql`
	employees e
	LEFT JOIN employees m ON m.id = e.manager_id
	LEFT JOIN LATERAL (
		SELECT count(*)::int AS account_count, array_agg(DISTINCT a.system ORDER BY a.system) AS systems
		FROM account_links l JOIN accounts a ON a.id = l.account_id
		WHERE l.employee_id = e.id AND a.gone_at IS NULL AND (l.link_method <> 'ai' OR l.confirmed)
	) x ON true`;

export async function listEmployees(): Promise<EmployeeListItem[]> {
	const rows = await sql`SELECT ${EMPLOYEE_SELECT} FROM ${EMPLOYEE_FROM} ORDER BY e.name`;
	return rows.map(mapEmployeeListItem);
}

export async function getEmployee(id: string): Promise<(EmployeeDetail & { isDemo: boolean }) | null> {
	if (!isUuid(id)) return null;
	const [r] = await sql`SELECT ${EMPLOYEE_SELECT} FROM ${EMPLOYEE_FROM} WHERE e.id = ${id}`;
	return r ? { ...mapEmployeeDetail(r), isDemo: !!r.is_demo } : null;
}

export async function listDepartments(): Promise<string[]> {
	const rows = await sql`SELECT DISTINCT department FROM employees WHERE department <> '' ORDER BY department`;
	return rows.map((r) => r.department as string);
}

export async function listEmployeeRefs(): Promise<{ id: string; name: string; workEmail: string }[]> {
	const rows = await sql`SELECT id, name, work_email FROM employees ORDER BY name`;
	return rows.map((r) => ({ id: r.id, name: r.name, workEmail: r.work_email }));
}

/** Linked accounts of one employee (see EMPLOYEE_FROM for what "linked" means). */
export async function listEmployeeAccounts(employeeId: string): Promise<AccountView[]> {
	if (!isUuid(employeeId)) return [];
	const rows = await sql`
		SELECT ${accountColumns(sql)}, l.link_method, l.confidence, l.evidence_json
		FROM account_links l JOIN accounts a ON a.id = l.account_id
		WHERE l.employee_id = ${employeeId} AND a.gone_at IS NULL AND (l.link_method <> 'ai' OR l.confirmed)
		ORDER BY a.system, a.kind, a.username NULLS LAST`;
	return rows.map((r) => mapAccount(r));
}

/** Facts needed for permission checks on an employee. */
export async function getEmployeeAuthContext(id: string): Promise<{ employeeManagerId: string | null; employeeIsDemo: boolean; status: string } | null> {
	if (!isUuid(id)) return null;
	const [r] = await sql`SELECT manager_id, is_demo, status FROM employees WHERE id = ${id}`;
	return r ? { employeeManagerId: r.manager_id ?? null, employeeIsDemo: !!r.is_demo, status: r.status } : null;
}
