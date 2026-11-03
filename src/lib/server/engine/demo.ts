// Reset demo company: wipe only demo data, re-seed through the real APIs, sweep.
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import type { Actor } from './index.ts';
import { clearRecheckTimer } from './recheck.ts';
import { sweepAllImpl } from './sweep.ts';
import { errMessage, state } from './state.ts';

export function demoDomain(): string {
	return (process.env.DEMO_EMAIL_DOMAIN || 'northwind.example').trim().toLowerCase();
}

export interface WipeCounts {
	runs: number;
	accounts: number;
}

/** Deletes demo runs and demo accounts (linked/suggested to demo employees, or on the demo email domain). Touches nothing else. */
export async function wipeDemoData(): Promise<WipeCounts> {
	const domain = demoDomain();
	return sql.begin(async (tx) => {
		const demoEmployees = await tx`SELECT id FROM employees WHERE is_demo`;
		const empIds = demoEmployees.map((e) => e.id as string);
		const runs = empIds.length ? await tx`SELECT id FROM runs WHERE employee_id IN ${tx(empIds)}` : [];
		const runIds = runs.map((r) => r.id as string);
		const accounts = await tx`
			SELECT a.id FROM accounts a WHERE
				${empIds.length ? tx`EXISTS (SELECT 1 FROM account_links l WHERE l.account_id = a.id AND l.employee_id IN ${tx(empIds)})
				OR EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.account_id = a.id AND s.employee_id IN ${tx(empIds)})
				OR EXISTS (SELECT 1 FROM match_rejections m WHERE m.account_id = a.id AND m.employee_id IN ${tx(empIds)})
				OR EXISTS (SELECT 1 FROM run_items i JOIN runs r ON r.id = i.run_id WHERE i.account_id = a.id AND r.employee_id IN ${tx(empIds)})
				OR` : tx``}
				EXISTS (SELECT 1 FROM unnest(a.emails) AS em WHERE lower(split_part(em, '@', 2)) = ${domain})`;
		const accIds = accounts.map((a) => a.id as string);

		if (runIds.length) {
			await tx`DELETE FROM ai_calls WHERE run_id IN ${tx(runIds)}`;
			await tx`DELETE FROM runs WHERE id IN ${tx(runIds)}`; // cascades run_items, approvals, rechecks
		}
		if (accIds.length) {
			await tx`DELETE FROM ai_calls WHERE account_id IN ${tx(accIds)}`;
			await tx`DELETE FROM ai_suggestions WHERE account_id IN ${tx(accIds)}`;
			await tx`DELETE FROM match_rejections WHERE account_id IN ${tx(accIds)}`;
			await tx`DELETE FROM account_links WHERE account_id IN ${tx(accIds)}`;
			await tx`DELETE FROM accounts WHERE id IN ${tx(accIds)}`;
		}
		if (empIds.length) {
			await tx`DELETE FROM ai_suggestions WHERE employee_id IN ${tx(empIds)}`;
			await tx`DELETE FROM match_rejections WHERE employee_id IN ${tx(empIds)}`;
			await tx`DELETE FROM account_links WHERE employee_id IN ${tx(empIds)}`;
			await tx`UPDATE employees SET status = 'active', end_date = NULL WHERE is_demo`;
		}
		for (const id of runIds) clearRecheckTimer(id);
		return { runs: runIds.length, accounts: accIds.length };
	});
}

export async function resetDemoImpl(actor: Actor): Promise<void> {
	const s = state();
	if (s.resetInFlight) throw new Error('A demo reset is already running');
	s.resetInFlight = true;
	const started = Date.now();
	try {
		await audit({ actorId: actor.id, actorName: actor.name, kind: 'demo_reset', summary: `${actor.name} started a demo reset`, detail: { phase: 'start' } });
		const wiped = await wipeDemoData();
		const lines: string[] = [];
		try {
			const seed = await import('#lib/server/demo/seed.ts');
			await seed.seedDemoCompany({ log: (l: string) => lines.push(l) });
		} catch (e) {
			await audit({ actorId: actor.id, actorName: actor.name, kind: 'demo_reset', summary: `Demo reset failed while seeding: ${errMessage(e)}`, detail: { phase: 'seed', error: errMessage(e), wiped, log: lines.slice(-30) } });
			throw e;
		}
		const sweep = await sweepAllImpl(actor);
		await audit({
			actorId: actor.id,
			actorName: actor.name,
			kind: 'demo_reset',
			summary: `Demo company reset in ${Math.round((Date.now() - started) / 100) / 10}s: ${sweep.accounts} accounts swept, ${sweep.unknown} unknown`,
			detail: { phase: 'done', wiped, sweep, log: lines.slice(-30) }
		});
	} finally {
		s.resetInFlight = false;
	}
}
