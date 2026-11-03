// Sweep: pull accounts from every connector, upsert, link by rules, ask the AI about the rest,
// and flag accounts of already-offboarded people that are active again.
import { accountLabel } from './labels.ts';
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import type { Connector, NormalizedAccount } from '#lib/server/connectors/types.ts';
import { SYSTEM_NAMES, type SystemId } from '#lib/types.ts';
import { getConnector } from './connectors.ts';
import { runAiPass, toMatchEmployee, type UnlinkedAccount } from './ai.ts';
import type { Actor } from './index.ts';
import { matchByRules, type MatchEmployee } from './matcher.ts';
import { clearRecheckTimer } from './recheck.ts';
import { errMessage, state } from './state.ts';

type Row = Record<string, any>;

export interface SweepSummary {
	accounts: number;
	linkedByRules: number;
	aiSuggested: number;
	unknown: number;
}

export interface SweepDetail extends SweepSummary {
	newRuleLinks: number;
	aiCalls: number;
	aiAsked: number;
	aiSkippedNoKey: boolean;
	regressions: number;
	connectors: { system: SystemId; ok: boolean; count: number; error?: string }[];
}

interface Conn {
	id: string;
	system: SystemId;
	status: string;
}

const SECRET_KEY = /pass(word|wd)?|secret|token|credential|api[_-]?key|private[_-]?key/i;

/** Remove credential-looking keys before anything is stored in accounts.raw_json. */
export function redactRaw(v: unknown, depth = 0): unknown {
	if (Array.isArray(v)) return v.map((x) => redactRaw(x, depth + 1));
	if (v && typeof v === 'object' && depth < 6) {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			if (SECRET_KEY.test(k)) continue;
			out[k] = redactRaw(val, depth + 1);
		}
		return out;
	}
	return v;
}

const toIso = (v: unknown): string | null => {
	if (!v) return null;
	const d = v instanceof Date ? v : new Date(v as string);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function rowToAccount(r: Row): UnlinkedAccount {
	return {
		id: r.id,
		system: r.system,
		kind: r.kind,
		username: r.username ?? null,
		displayName: r.display_name ?? null,
		emails: r.emails ?? [],
		createdAt: toIso(r.created_at),
		lastActiveAt: toIso(r.last_active_at),
		raw: (r.raw_json ?? {}) as Record<string, unknown>,
		active: !!r.active,
		flag: r.flag ?? 'unlinked'
	};
}

export async function loadEmployees(): Promise<{ all: MatchEmployee[]; assignable: MatchEmployee[]; names: Map<string, string> }> {
	const rows = await sql`SELECT id, name, work_email, aliases, role, department, start_date::text AS start_date, status FROM employees`;
	const all = rows.map(toMatchEmployee);
	const assignable = rows.filter((r) => r.status !== 'offboarded').map(toMatchEmployee);
	return { all, assignable, names: new Map(rows.map((r) => [r.id, r.name])) };
}

export async function upsertAccounts(conn: Conn, list: NormalizedAccount[], stamp: Date): Promise<string[]> {
	if (!list.length) return [];
	const rows = await sql.begin((tx) =>
		list.map(
			(a) => tx`
				INSERT INTO accounts (connection_id, system, external_id, kind, username, display_name, emails, active, created_at, last_active_at, parent_external_id, raw_json, first_seen_at, last_seen_at, gone_at)
				VALUES (${conn.id}, ${conn.system}, ${a.externalId}, ${a.kind}, ${a.username}, ${a.displayName}, ${(a.emails ?? []).map((e) => e.toLowerCase())},
				        ${a.active}, ${a.createdAt}, ${a.lastActiveAt}, ${a.parentExternalId ?? null}, ${tx.json(redactRaw(a.raw ?? {}) as never)}, ${stamp}, ${stamp}, NULL)
				ON CONFLICT (system, kind, external_id) DO UPDATE SET
					connection_id = EXCLUDED.connection_id, username = EXCLUDED.username, display_name = EXCLUDED.display_name,
					emails = EXCLUDED.emails, active = EXCLUDED.active, created_at = EXCLUDED.created_at,
					last_active_at = EXCLUDED.last_active_at, parent_external_id = EXCLUDED.parent_external_id,
					raw_json = EXCLUDED.raw_json, last_seen_at = EXCLUDED.last_seen_at, gone_at = NULL
				RETURNING id`
		)
	);
	return rows.map((r) => (r as unknown as Row[])[0].id as string);
}

async function listConnections(includeErrored: boolean): Promise<Conn[]> {
	const rows = await sql`SELECT id, system, status FROM connections ORDER BY system`;
	return rows.filter((r) => includeErrored || r.status === 'healthy' || r.status === 'untested').map((r) => ({ id: r.id, system: r.system, status: r.status }));
}

async function syncConnection(conn: Conn, connector: Connector, actor: Actor, runId: string | null, scopeEmployeeId: string | null): Promise<{ system: SystemId; ok: boolean; count: number; error?: string }> {
	const name = SYSTEM_NAMES[conn.system];
	const stamp = new Date();
	const t0 = Date.now();
	let list: NormalizedAccount[];
	try {
		list = await connector.listAccounts();
	} catch (e) {
		const error = errMessage(e);
		await sql`UPDATE connections SET status = 'error', last_error = ${error} WHERE id = ${conn.id}`;
		await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId: scopeEmployeeId, system: conn.system, kind: 'sweep', summary: `${name}: could not list accounts (${error})`, detail: { ok: false, error, ms: Date.now() - t0 } });
		return { system: conn.system, ok: false, count: 0, error };
	}
	await upsertAccounts(conn, list, stamp);
	const gone = await sql`UPDATE accounts SET gone_at = ${stamp} WHERE connection_id = ${conn.id} AND gone_at IS NULL AND last_seen_at < ${stamp} RETURNING id`;
	if (conn.status === 'untested') await sql`UPDATE connections SET status = 'healthy', last_error = NULL WHERE id = ${conn.id}`;

	let refreshed = 0;
	if (scopeEmployeeId) {
		// Re-read this employee's linked accounts one by one: catches anything the listing missed.
		const linked = await sql`
			SELECT a.id, a.external_id, a.kind, a.parent_external_id FROM accounts a JOIN account_links l ON l.account_id = a.id
			WHERE a.connection_id = ${conn.id} AND l.employee_id = ${scopeEmployeeId}`;
		for (const a of linked) {
			try {
				const fresh = await connector.getAccount({ externalId: a.external_id, kind: a.kind, parentExternalId: a.parent_external_id });
				if (fresh) {
					await upsertAccounts(conn, [fresh], stamp);
					refreshed++;
				} else {
					await sql`UPDATE accounts SET gone_at = COALESCE(gone_at, ${stamp}) WHERE id = ${a.id}`;
				}
			} catch (e) {
				await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId: scopeEmployeeId, system: conn.system, kind: 'sweep', summary: `${name}: could not re-read ${a.kind} ${a.external_id} (${errMessage(e)})`, detail: { ok: false, externalId: a.external_id } });
			}
		}
	}
	await audit({
		actorId: actor.id,
		actorName: actor.name,
		runId,
		employeeId: scopeEmployeeId,
		system: conn.system,
		kind: 'sweep',
		summary: `${name}: ${list.length} accounts listed${gone.length ? `, ${gone.length} no longer present` : ''}${scopeEmployeeId ? `, ${refreshed} linked accounts re-read` : ''}`,
		detail: { ok: true, count: list.length, gone: gone.length, reread: refreshed, ms: Date.now() - t0, method: 'listAccounts' }
	});
	return { system: conn.system, ok: true, count: list.length };
}

export interface LinkPassResult {
	newLinks: number;
	unlinked: UnlinkedAccount[];
	rejections: Map<string, Set<string>>;
	employees: Awaited<ReturnType<typeof loadEmployees>>;
}

/** Apply the rule matcher to every live account without a link, then let API keys follow their owning user. */
export async function linkByRules(actor: Actor, runId: string | null): Promise<LinkPassResult> {
	const employees = await loadEmployees();
	const rows = await sql`
		SELECT a.*, l.employee_id AS link_employee_id, l.link_method, l.confirmed, l.confidence AS link_confidence
		FROM accounts a LEFT JOIN account_links l ON l.account_id = a.id WHERE a.gone_at IS NULL`;
	const rejRows = await sql`SELECT account_id, employee_id FROM match_rejections`;
	const rejections = new Map<string, Set<string>>();
	for (const r of rejRows) {
		const s = rejections.get(r.account_id) ?? new Set<string>();
		s.add(r.employee_id);
		rejections.set(r.account_id, s);
	}

	let newLinks = 0;
	const unlinked: UnlinkedAccount[] = [];
	const linkedByAccount = new Map<string, Row>();
	for (const r of rows) if (r.link_employee_id) linkedByAccount.set(`${r.system}|${r.external_id}`, r);

	const pending = rows.filter((r) => !r.link_employee_id);
	for (const r of pending.filter((x) => x.kind !== 'apikey')) {
		const account = rowToAccount(r);
		const m = matchByRules(account, employees.all, { rejected: rejections.get(r.id) });
		if (m && m.source === 'rule') {
			const inserted = await sql`
				INSERT INTO account_links (account_id, employee_id, link_method, confidence, evidence_json, confirmed)
				VALUES (${r.id}, ${m.employeeId}, ${m.method}, ${m.confidence}, ${sql.json(m.evidence as never)}, true)
				ON CONFLICT (account_id) DO NOTHING RETURNING account_id`;
			if (inserted.length) {
				newLinks++;
				linkedByAccount.set(`${r.system}|${r.external_id}`, { ...r, link_employee_id: m.employeeId, link_method: m.method, confirmed: true, link_confidence: 1 });
				await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId: m.employeeId, system: r.system, kind: 'match', summary: `Rule ${m.method.replace('rule:', '')}: ${SYSTEM_NAMES[r.system as SystemId]} ${accountLabel(r)} linked to ${employees.names.get(m.employeeId)}`, detail: { accountId: r.id, method: m.method, confidence: 1, evidence: m.evidence } });
				continue;
			}
		}
		unlinked.push(account);
	}

	// API keys follow the user that owns them.
	for (const r of pending.filter((x) => x.kind === 'apikey')) {
		const parent = r.parent_external_id ? linkedByAccount.get(`${r.system}|${r.parent_external_id}`) : null;
		if (parent && (parent.link_method !== 'ai' || parent.confirmed) && !rejections.get(r.id)?.has(parent.link_employee_id)) {
			const parentLabel = parent.username ?? parent.display_name ?? parent.external_id;
			const evidence = [`API key of ${SYSTEM_NAMES[r.system as SystemId]} user ${parentLabel}, which is linked to this employee`];
			const inserted = await sql`
				INSERT INTO account_links (account_id, employee_id, link_method, confidence, evidence_json, confirmed)
				VALUES (${r.id}, ${parent.link_employee_id}, ${parent.link_method}, ${parent.link_confidence ?? 1}, ${sql.json(evidence as never)}, true)
				ON CONFLICT (account_id) DO NOTHING RETURNING account_id`;
			if (inserted.length) newLinks++;
		} else {
			unlinked.push(rowToAccount(r));
		}
	}
	return { newLinks, unlinked, rejections, employees };
}

/** Accounts of offboarded employees that are active again: mark the latest run regressed with a diff entry. */
export async function detectRegressions(actor: Actor): Promise<number> {
	const rows = await sql`
		SELECT a.id AS account_id, a.system, a.kind, a.username, a.display_name, a.external_id, l.employee_id, e.name AS employee_name
		FROM accounts a JOIN account_links l ON l.account_id = a.id JOIN employees e ON e.id = l.employee_id
		WHERE e.status = 'offboarded' AND a.gone_at IS NULL AND a.active AND (l.link_method <> 'ai' OR l.confirmed)`;
	let flagged = 0;
	const byEmployee = new Map<string, Row[]>();
	for (const r of rows) byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r]);
	for (const [employeeId, accounts] of byEmployee) {
		const [run] = await sql`SELECT id, status FROM runs WHERE employee_id = ${employeeId} ORDER BY started_at DESC LIMIT 1`;
		if (!run || run.status === 'review' || run.status === 'executing') continue;
		const [existing] = await sql`SELECT result_json FROM rechecks WHERE run_id = ${run.id}`;
		const diff: { itemId: string; label: string; observed: string }[] = Array.isArray(existing?.result_json?.diff) ? [...existing.result_json.diff] : [];
		let added = 0;
		for (const a of accounts) {
			const [item] = await sql`SELECT id FROM run_items WHERE run_id = ${run.id} AND account_id = ${a.account_id}`;
			const itemId: string = item?.id ?? a.account_id;
			const observed = item ? 'active again (seen by sweep)' : 'new active account found for an offboarded employee (seen by sweep)';
			if (diff.some((d) => d.itemId === itemId && d.observed === observed)) continue;
			diff.push({ itemId, label: `${SYSTEM_NAMES[a.system as SystemId]}: ${a.username ?? a.display_name ?? a.external_id}`, observed });
			added++;
		}
		if (!added) continue;
		flagged += added;
		const result = { ...(existing?.result_json ?? {}), diff, source: 'sweep' };
		await sql`
			INSERT INTO rechecks (run_id, due_at, status, result_json, fired_at) VALUES (${run.id}, now(), 'regressed', ${sql.json(result as never)}, now())
			ON CONFLICT (run_id) DO UPDATE SET status = 'regressed', result_json = EXCLUDED.result_json, fired_at = now()`;
		clearRecheckTimer(run.id);
		await sql`UPDATE runs SET status = 'regressed' WHERE id = ${run.id}`;
		await audit({
			actorId: actor.id,
			actorName: actor.name,
			runId: run.id,
			employeeId,
			kind: 'sweep',
			summary: `Needs attention: ${accounts.length} account${accounts.length === 1 ? '' : 's'} of offboarded ${accounts[0].employee_name} active again`,
			detail: { diff, source: 'sweep' }
		});
	}
	return flagged;
}

async function totals(): Promise<SweepSummary> {
	const [t] = await sql`
		SELECT count(*)::int AS accounts,
		       count(*) FILTER (WHERE l.account_id IS NOT NULL AND (l.link_method LIKE 'rule:%' OR l.link_method = 'manual'))::int AS by_rules,
		       count(*) FILTER (WHERE l.account_id IS NULL AND a.flag <> 'service' AND EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.account_id = a.id))::int AS ai_suggested,
		       count(*) FILTER (WHERE l.account_id IS NULL AND a.flag <> 'service' AND NOT EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.account_id = a.id))::int AS unknown
		FROM accounts a LEFT JOIN account_links l ON l.account_id = a.id WHERE a.gone_at IS NULL`;
	return { accounts: t.accounts, linkedByRules: t.by_rules, aiSuggested: t.ai_suggested, unknown: t.unknown };
}

export interface PerformSweepOptions {
	actor: Actor;
	scopeEmployeeId?: string | null;
	runId?: string | null;
}

export async function performSweep(opts: PerformSweepOptions): Promise<SweepDetail> {
	const { actor } = opts;
	const scope = opts.scopeEmployeeId ?? null;
	const runId = opts.runId ?? null;
	const t0 = Date.now();

	const conns = await listConnections(!!scope);
	const connectorResults = await Promise.all(
		conns.map(async (conn) => {
			let connector: Connector | null = null;
			try {
				connector = await getConnector(conn.system);
			} catch (e) {
				const error = errMessage(e);
				await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId: scope, system: conn.system, kind: 'sweep', summary: `${SYSTEM_NAMES[conn.system]}: connector could not be loaded (${error})`, detail: { ok: false, error } });
				return { system: conn.system, ok: false, count: 0, error };
			}
			if (!connector) return null; // not configured
			return syncConnection(conn, connector, actor, runId, scope);
		})
	);
	const connectors = connectorResults.filter((r): r is NonNullable<typeof r> => r !== null);

	const link = await linkByRules(actor, runId);
	const ai = await runAiPass({
		actor,
		accounts: link.unlinked,
		employees: link.employees.assignable,
		rejections: link.rejections,
		runId,
		scopeEmployeeId: scope ?? undefined,
		skipRecentlyAsked: !scope
	});
	const regressions = scope ? 0 : await detectRegressions(actor);
	const t = await totals();
	if (!scope) await sql`UPDATE settings SET last_sweep_at = now() WHERE id = 1`;

	const detail: SweepDetail = {
		...t,
		newRuleLinks: link.newLinks,
		aiCalls: ai.calls,
		aiAsked: ai.asked,
		aiSkippedNoKey: ai.skippedNoKey,
		regressions,
		connectors
	};
	await audit({
		actorId: actor.id,
		actorName: actor.name,
		runId,
		employeeId: scope,
		kind: 'sweep',
		summary: `${scope ? 'Scoped sweep' : 'Sweep'} finished: ${t.accounts} accounts, ${t.linkedByRules} linked by rules, ${t.aiSuggested} AI suggestions, ${t.unknown} unknown${regressions ? `, ${regressions} need attention` : ''}`,
		detail: { ...detail, ms: Date.now() - t0 }
	});
	return detail;
}

/** Scoped sweep used by Offboard now. */
export async function sweepEmployee(employeeId: string, actor: Actor, runId: string | null = null): Promise<SweepDetail> {
	return performSweep({ actor, scopeEmployeeId: employeeId, runId });
}

export async function sweepAllImpl(actor: Actor): Promise<SweepSummary> {
	const s = state();
	if (s.sweepInFlight) return (await s.sweepInFlight) as SweepSummary;
	const p = performSweep({ actor }).then(
		(d) => ({ accounts: d.accounts, linkedByRules: d.linkedByRules, aiSuggested: d.aiSuggested, unknown: d.unknown }),
		(e) => {
			throw e;
		}
	);
	s.sweepInFlight = p;
	try {
		return await p;
	} finally {
		s.sweepInFlight = null;
	}
}
