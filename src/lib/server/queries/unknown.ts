import { sql } from '#lib/server/db/index.ts';
import type { UnknownAccount } from '#lib/types.ts';
import { accountColumns, isUuid, mapAccount, num } from './mappers.ts';
import { strArray } from './mappers.ts';

/**
 * Unknown owners = accounts with NO account_links row that the last sweep still saw (gone_at IS NULL).
 * Accounts flagged 'service' stay in the list (so they can be reviewed) but are not counted as needing attention.
 */
export async function listUnknownAccounts(): Promise<UnknownAccount[]> {
	const rows = await sql`
		SELECT ${accountColumns(sql)}, s.employee_id AS sug_employee_id, s.employee_name AS sug_employee_name,
		       s.confidence AS sug_confidence, s.evidence_json AS sug_evidence
		FROM accounts a
		LEFT JOIN LATERAL (
			SELECT g.employee_id, e.name AS employee_name, g.confidence, g.evidence_json
			FROM ai_suggestions g JOIN employees e ON e.id = g.employee_id
			WHERE g.account_id = a.id ORDER BY g.confidence DESC LIMIT 1
		) s ON true
		WHERE a.gone_at IS NULL AND NOT EXISTS (SELECT 1 FROM account_links l WHERE l.account_id = a.id)
		ORDER BY (a.flag = 'service'), a.system, a.username NULLS LAST`;
	return rows.map((r) => ({
		...mapAccount(r, { method: null, confidence: null, evidence: [] }),
		flag: r.flag,
		aiSuggestion: r.sug_employee_id
			? { employeeId: r.sug_employee_id, employeeName: r.sug_employee_name, confidence: num(r.sug_confidence) ?? 0, evidence: strArray(r.sug_evidence) }
			: null
	}));
}

export async function getAccountBasics(id: string): Promise<{ id: string; system: string; hasLink: boolean; label: string } | null> {
	if (!isUuid(id)) return null;
	const [r] = await sql`
		SELECT a.id, a.system, COALESCE(a.username, a.display_name, a.external_id) AS label,
		       EXISTS (SELECT 1 FROM account_links l WHERE l.account_id = a.id) AS has_link
		FROM accounts a WHERE a.id = ${id}`;
	return r ? { id: r.id, system: r.system, hasLink: r.has_link, label: r.label } : null;
}
