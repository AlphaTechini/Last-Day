// Offboarding runs: build the review (exact / probable / servers), HR decisions, approvals, retries, destroy approval.
import { accountLabel } from './labels.ts';
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import type { ActionKind, Connector } from '#lib/server/connectors/types.ts';
import { SYSTEM_NAMES, type MatchKind, type SystemId } from '#lib/types.ts';
import { getConnector } from './connectors.ts';
import { enqueueJob } from './executor.ts';
import { finishRunIfDone } from './finish.ts';
import type { Actor } from './index.ts';
import { pendingStep, parseSteps, stepsFor } from './steps.ts';
import { sweepEmployee } from './sweep.ts';
import { errMessage } from './state.ts';

type Row = Record<string, any>;

const SYSTEM_ORDER: SystemId[] = ['keycloak', 'mattermost', 'github', 'vultr'];
const PROBABLE_MIN_CONFIDENCE = 0.5;

const label = (a: Row) => accountLabel({ kind: a.kind, username: a.username, display_name: a.display_name ?? a.displayName, external_id: a.external_id ?? a.externalId });

interface Planned {
	account: Row;
	matchKind: MatchKind;
	status: 'pending' | 'proposed';
	linkMethod: string | null;
	confidence: number | null;
	evidence: string[];
}

function describeMatch(p: Planned): string {
	const who = `${SYSTEM_NAMES[p.account.system as SystemId]} ${label(p.account)}`;
	if (p.matchKind === 'server') return p.status === 'proposed' ? `Probable server: ${who} (AI attribution, ${Math.round((p.confidence ?? 0) * 100)}%)` : `Server: ${who} (${p.linkMethod})`;
	if (p.status === 'proposed') return `Probable match: ${who} (AI, ${Math.round((p.confidence ?? 0) * 100)}%)`;
	return `Exact match: ${who} (${p.linkMethod?.replace('rule:', '').replace('_', ' ') ?? 'link'})`;
}

const connectorCache = async (cache: Map<SystemId, Connector | null>, system: SystemId): Promise<Connector | null> => {
	if (!cache.has(system)) cache.set(system, await getConnector(system).catch(() => null));
	return cache.get(system) ?? null;
};

/** Live, still-active API keys owned by a user account of the same system. */
async function ownedChildren(parent: Row): Promise<Row[]> {
	if (parent.kind !== 'user' && parent.kind !== 'service') return [];
	return sql`SELECT * FROM accounts WHERE system = ${parent.system} AND kind = 'apikey' AND parent_external_id = ${parent.external_id} AND gone_at IS NULL AND active`;
}

async function insertItems(runId: string, planned: Planned[], startOrder: number): Promise<number> {
	const connectors = new Map<SystemId, Connector | null>();
	let order = startOrder;
	let inserted = 0;
	for (const p of planned) {
		const connector = await connectorCache(connectors, p.account.system);
		const steps = connector ? stepsFor(connector, { kind: p.account.kind, parentExternalId: p.account.parent_external_id, raw: p.account.raw_json ?? {} }) : [];
		const sort = SYSTEM_ORDER.indexOf(p.account.system) * 1000 + order++;
		const r = await sql`
			INSERT INTO run_items (run_id, account_id, match_kind, link_method, confidence, evidence_json, steps_json, status, sort_order)
			VALUES (${runId}, ${p.account.id}, ${p.matchKind}, ${p.linkMethod}, ${p.confidence}, ${sql.json(p.evidence as never)}, ${sql.json(steps as never)}, ${p.status}, ${sort})
			ON CONFLICT (run_id, account_id) DO NOTHING RETURNING id`;
		inserted += r.length;
	}
	return inserted;
}

export async function startOffboardingImpl(employeeId: string, actor: Actor): Promise<string> {
	const [emp] = await sql`SELECT id, name, status FROM employees WHERE id = ${employeeId}`;
	if (!emp) throw new Error('Employee not found');
	const [open] = await sql`SELECT id FROM runs WHERE employee_id = ${employeeId} AND status IN ('review', 'executing') ORDER BY started_at DESC LIMIT 1`;
	if (open) return open.id;

	const [run] = await sql`INSERT INTO runs (employee_id, started_by) VALUES (${employeeId}, ${actor.id}) RETURNING id`;
	const runId: string = run.id;
	const previousStatus: string = emp.status;
	try {
		// The employee must count as assignable for the AI resolver, so flip the status first.
		await sql`UPDATE employees SET status = 'offboarding' WHERE id = ${employeeId}`;
		await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId, kind: 'run', summary: `${actor.name} started offboarding ${emp.name}`, detail: { previousStatus } });

		const sweep = await sweepEmployee(employeeId, actor, runId);

		const planned: Planned[] = [];
		const skipped: string[] = [];
		const seen = new Set<string>();

		const linked = await sql`
			SELECT a.*, l.link_method AS l_method, l.confidence AS l_confidence, l.evidence_json AS l_evidence, l.confirmed AS l_confirmed
			FROM account_links l JOIN accounts a ON a.id = l.account_id
			WHERE l.employee_id = ${employeeId} AND a.gone_at IS NULL AND (l.link_method <> 'ai' OR l.confirmed)
			ORDER BY a.system, a.kind, a.username`;
		for (const a of linked) {
			if (!a.active && a.kind !== 'instance') {
				skipped.push(`${SYSTEM_NAMES[a.system as SystemId]} ${label(a)}`);
				continue;
			}
			seen.add(a.id);
			planned.push({
				account: a,
				matchKind: a.kind === 'instance' ? 'server' : a.l_method === 'ai' ? 'probable' : 'exact',
				status: 'pending',
				linkMethod: a.l_method,
				confidence: a.l_confidence === null ? null : Number(a.l_confidence),
				evidence: (a.l_evidence as string[]) ?? []
			});
		}

		const suggested = await sql`
			SELECT a.*, s.confidence AS s_confidence, s.evidence_json AS s_evidence
			FROM ai_suggestions s JOIN accounts a ON a.id = s.account_id
			WHERE s.employee_id = ${employeeId} AND s.confidence >= ${PROBABLE_MIN_CONFIDENCE} AND a.gone_at IS NULL
			  AND NOT EXISTS (SELECT 1 FROM account_links l WHERE l.account_id = a.id)
			  AND NOT EXISTS (SELECT 1 FROM match_rejections m WHERE m.account_id = a.id AND m.employee_id = ${employeeId})
			ORDER BY s.confidence DESC`;
		for (const a of suggested) {
			if (!a.active && a.kind !== 'instance') {
				skipped.push(`${SYSTEM_NAMES[a.system as SystemId]} ${label(a)}`);
				continue;
			}
			if (seen.has(a.id)) continue;
			seen.add(a.id);
			planned.push({ account: a, matchKind: a.kind === 'instance' ? 'server' : 'probable', status: 'proposed', linkMethod: 'ai', confidence: Number(a.s_confidence), evidence: (a.s_evidence as string[]) ?? [] });
		}

		// API keys follow a confirmed owner into the run. (Keys of a proposed user are added when HR says yes.)
		for (const p of [...planned].filter((x) => x.status === 'pending')) {
			for (const child of await ownedChildren(p.account)) {
				if (seen.has(child.id)) continue;
				const [childLink] = await sql`SELECT employee_id FROM account_links WHERE account_id = ${child.id}`;
				if (childLink && childLink.employee_id !== employeeId) continue;
				seen.add(child.id);
				planned.push({ account: child, matchKind: p.matchKind, status: 'pending', linkMethod: p.linkMethod, confidence: p.confidence, evidence: [`API key of ${SYSTEM_NAMES[p.account.system as SystemId]} user ${label(p.account)}`] });
			}
		}

		await insertItems(runId, planned, 0);
		for (const p of planned) {
			await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId, system: p.account.system, kind: 'match', summary: describeMatch(p), detail: { accountId: p.account.id, matchKind: p.matchKind, method: p.linkMethod, confidence: p.confidence, evidence: p.evidence, status: p.status } });
		}
		const counts = {
			exact: planned.filter((p) => p.matchKind === 'exact').length,
			probable: planned.filter((p) => p.matchKind === 'probable').length,
			servers: planned.filter((p) => p.matchKind === 'server').length
		};
		await audit({
			actorId: actor.id,
			actorName: actor.name,
			runId,
			employeeId,
			kind: 'run',
			summary: `Review ready for ${emp.name}: ${counts.exact} exact, ${counts.probable} probable, ${counts.servers} servers${skipped.length ? `; ${skipped.length} already inactive, skipped` : ''}`,
			detail: { ...counts, skippedInactive: skipped, aiCalls: sweep.aiCalls, aiSkippedNoKey: sweep.aiSkippedNoKey, connectors: sweep.connectors }
		});
		return runId;
	} catch (e) {
		await sql`DELETE FROM runs WHERE id = ${runId}`.catch(() => {});
		await sql`UPDATE employees SET status = ${previousStatus} WHERE id = ${employeeId}`.catch(() => {});
		throw e;
	}
}

export async function decideItemImpl(runId: string, itemId: string, decision: 'yes' | 'no', actor: Actor): Promise<void> {
	if (decision !== 'yes' && decision !== 'no') throw new Error('Decision must be yes or no');
	const result = await sql.begin(async (tx) => {
		const [item] = await tx`
			SELECT i.id, i.status, i.confidence, i.evidence_json, i.match_kind, a.*, a.id AS account_id, r.employee_id, e.name AS employee_name
			FROM run_items i JOIN accounts a ON a.id = i.account_id JOIN runs r ON r.id = i.run_id JOIN employees e ON e.id = r.employee_id
			WHERE i.id = ${itemId} AND i.run_id = ${runId} FOR UPDATE OF i`;
		if (!item) throw new Error('Item not found in this run');
		if (item.status !== 'proposed') throw new Error(`This item is not waiting for a decision (it is ${item.status})`);
		if (decision === 'no') {
			await tx`UPDATE run_items SET status = 'rejected' WHERE id = ${itemId}`;
			await tx`INSERT INTO match_rejections (account_id, employee_id, decided_by) VALUES (${item.account_id}, ${item.employee_id}, ${actor.id}) ON CONFLICT (account_id, employee_id) DO UPDATE SET decided_by = EXCLUDED.decided_by, decided_at = now()`;
			await tx`DELETE FROM ai_suggestions WHERE account_id = ${item.account_id} AND employee_id = ${item.employee_id}`;
			await tx`DELETE FROM account_links WHERE account_id = ${item.account_id} AND employee_id = ${item.employee_id} AND link_method = 'ai'`;
			return { item, children: 0 };
		}
		const [existing] = await tx`SELECT employee_id, link_method FROM account_links WHERE account_id = ${item.account_id}`;
		if (existing && existing.employee_id !== item.employee_id) throw new Error('This account was linked to someone else in the meantime');
		await tx`
			INSERT INTO account_links (account_id, employee_id, link_method, confidence, evidence_json, confirmed, decided_by)
			VALUES (${item.account_id}, ${item.employee_id}, 'ai', ${item.confidence}, ${tx.json(item.evidence_json as never)}, true, ${actor.id})
			ON CONFLICT (account_id) DO UPDATE SET confirmed = true, decided_by = EXCLUDED.decided_by, decided_at = now()`;
		await tx`UPDATE run_items SET status = 'pending' WHERE id = ${itemId}`;
		return { item, children: 0 };
	});

	const { item } = result;
	let childCount = 0;
	if (decision === 'yes') {
		// The confirmed user's API keys join the run.
		const children = await ownedChildren(item);
		const planned: Planned[] = [];
		for (const child of children) {
			const [childLink] = await sql`SELECT employee_id FROM account_links WHERE account_id = ${child.id}`;
			if (childLink && childLink.employee_id !== item.employee_id) continue;
			const evidence = [`API key of ${SYSTEM_NAMES[item.system as SystemId]} user ${label(item)}, confirmed as ${item.employee_name}`];
			await sql`
				INSERT INTO account_links (account_id, employee_id, link_method, confidence, evidence_json, confirmed, decided_by)
				VALUES (${child.id}, ${item.employee_id}, 'ai', ${item.confidence}, ${sql.json(evidence as never)}, true, ${actor.id}) ON CONFLICT (account_id) DO NOTHING`;
			planned.push({ account: child, matchKind: 'probable', status: 'pending', linkMethod: 'ai', confidence: item.confidence === null ? null : Number(item.confidence), evidence });
		}
		if (planned.length) {
			const [{ max }] = await sql`SELECT COALESCE(max(sort_order), 0)::int AS max FROM run_items WHERE run_id = ${runId}`;
			childCount = await insertItems(runId, planned, max + 1);
		}
	}
	await audit({
		actorId: actor.id,
		actorName: actor.name,
		runId,
		employeeId: item.employee_id,
		system: item.system,
		kind: 'match',
		summary:
			decision === 'yes'
				? `${actor.name} confirmed ${SYSTEM_NAMES[item.system as SystemId]} ${label(item)} is ${item.employee_name}${childCount ? ` (+${childCount} API keys)` : ''}`
				: `${actor.name} rejected ${SYSTEM_NAMES[item.system as SystemId]} ${label(item)}: not ${item.employee_name}`,
		detail: { itemId, accountId: item.account_id, decision, confidence: item.confidence === null ? null : Number(item.confidence), evidence: item.evidence_json }
	});
}

export async function approveItemsImpl(runId: string, itemIds: string[] | 'all', actor: Actor): Promise<void> {
	const queued = await sql.begin(async (tx) => {
		const [run] = await tx`SELECT id, status, employee_id FROM runs WHERE id = ${runId} FOR UPDATE`;
		if (!run) throw new Error('Run not found');
		const items = await tx`
			SELECT i.id, i.status, i.sort_order, i.steps_json, a.system, a.id AS account_id, a.username, a.display_name, a.external_id
			FROM run_items i JOIN accounts a ON a.id = i.account_id WHERE i.run_id = ${runId} ORDER BY i.sort_order`;
		let chosen: Row[];
		if (itemIds === 'all') chosen = items.filter((i) => i.status === 'pending');
		else {
			const wanted = new Set(itemIds);
			chosen = items.filter((i) => wanted.has(i.id));
			if (chosen.length !== wanted.size) throw new Error('Some items do not belong to this run');
			const bad = chosen.find((i) => i.status !== 'pending');
			if (bad) throw new Error(bad.status === 'proposed' ? 'Confirm or reject probable matches before approving them' : `Item is not waiting for approval (it is ${bad.status})`);
		}
		if (!chosen.length) {
			const live = items.filter((i) => i.status !== 'rejected');
			if (live.length === 0) return { chosen: [] as Row[], empty: true, employeeId: run.employee_id as string, approvalId: '', actionList: [] as unknown[] };
			throw new Error('Nothing is waiting for approval');
		}
		const actionList = chosen.map((i) => ({
			itemId: i.id,
			accountId: i.account_id,
			system: i.system,
			account: label(i),
			actions: parseSteps(i.steps_json).map((s) => s.action as ActionKind)
		}));
		const [approval] = await tx`
			INSERT INTO approvals (run_id, approver_id, scope, item_ids, action_list)
			VALUES (${runId}, ${actor.id}, 'hr_revoke', ${chosen.map((i) => i.id)}, ${tx.json(actionList as never)}) RETURNING id`;
		await tx`UPDATE run_items SET status = 'approved', approval_id = ${approval.id}, last_error = NULL WHERE id IN ${tx(chosen.map((i) => i.id))}`;
		await tx`UPDATE runs SET status = 'executing' WHERE id = ${runId}`;
		return { chosen, empty: false, employeeId: run.employee_id as string, approvalId: approval.id as string, actionList };
	});

	if (queued.empty) {
		// Nothing to revoke at all: settle the run straight away.
		await sql`UPDATE runs SET status = 'executing' WHERE id = ${runId}`;
		await finishRunIfDone(runId);
		return;
	}
	await audit({
		actorId: actor.id,
		actorName: actor.name,
		runId,
		employeeId: queued.employeeId,
		kind: 'approval',
		summary: `${actor.name} approved revocation of ${queued.chosen.length} item${queued.chosen.length === 1 ? '' : 's'}`,
		detail: { approvalId: queued.approvalId, scope: 'hr_revoke', actionList: queued.actionList }
	});
	// Kick the executor in the background; the route does not wait for it.
	for (const i of queued.chosen) enqueueJob(i.system, { type: 'revoke', itemId: i.id, runId });
}

export async function retryItemImpl(runId: string, itemId: string, actor: Actor): Promise<void> {
	const item = await sql.begin(async (tx) => {
		const [i] = await tx`
			SELECT i.id, i.status, i.steps_json, a.system, r.employee_id FROM run_items i JOIN accounts a ON a.id = i.account_id JOIN runs r ON r.id = i.run_id
			WHERE i.id = ${itemId} AND i.run_id = ${runId} FOR UPDATE OF i`;
		if (!i) throw new Error('Item not found in this run');
		if (i.status !== 'failed') throw new Error(`Only failed items can be retried (this one is ${i.status})`);
		const steps = parseSteps(i.steps_json).map((s) => (s.status === 'failed' || s.status === 'running' ? { ...s, status: 'pending' as const, httpStatus: null } : s));
		await tx`UPDATE run_items SET status = 'approved', last_error = NULL, steps_json = ${tx.json(steps as never)} WHERE id = ${itemId}`;
		await tx`UPDATE runs SET status = 'executing' WHERE id = ${runId}`;
		return i;
	});
	await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId: item.employee_id, system: item.system, kind: 'run', summary: `${actor.name} retried a failed item`, detail: { itemId } });
	enqueueJob(item.system, { type: 'revoke', itemId, runId });
}

export async function destroyServerImpl(runId: string, itemId: string, actor: Actor): Promise<void> {
	const item = await sql.begin(async (tx) => {
		const [i] = await tx`
			SELECT i.id, i.status, i.match_kind, i.steps_json, a.system, a.username, a.display_name, a.external_id, r.employee_id
			FROM run_items i JOIN accounts a ON a.id = i.account_id JOIN runs r ON r.id = i.run_id
			WHERE i.id = ${itemId} AND i.run_id = ${runId} FOR UPDATE OF i`;
		if (!i) throw new Error('Item not found in this run');
		if (i.match_kind !== 'server') throw new Error('Only servers can be destroyed');
		if (i.status !== 'awaiting_manager') throw new Error(`The server must be halted and snapshotted first (it is ${i.status})`);
		const steps = parseSteps(i.steps_json);
		const existing = steps.find((s) => s.action === 'vultr.destroy_instance');
		if (existing) Object.assign(existing, pendingStep('vultr.destroy_instance'));
		else steps.push(pendingStep('vultr.destroy_instance'));
		const [approval] = await tx`
			INSERT INTO approvals (run_id, approver_id, scope, item_ids, action_list)
			VALUES (${runId}, ${actor.id}, 'manager_destroy', ${[itemId]}, ${tx.json([{ itemId, system: i.system, account: label(i), actions: ['vultr.destroy_instance'] }] as never)}) RETURNING id`;
		await tx`UPDATE run_items SET status = 'destroying', destroy_approval_id = ${approval.id}, last_error = NULL, steps_json = ${tx.json(steps as never)} WHERE id = ${itemId}`;
		return { ...(i as Row), approvalId: approval.id as string } as Row;
	});
	await audit({ actorId: actor.id, actorName: actor.name, runId, employeeId: item.employee_id, system: item.system, kind: 'approval', summary: `${actor.name} approved destroying ${label(item)}`, detail: { approvalId: item.approvalId, scope: 'manager_destroy', itemId } });
	enqueueJob(item.system, { type: 'destroy', itemId, runId });
}

