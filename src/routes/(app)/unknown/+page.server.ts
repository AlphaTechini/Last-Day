import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import { deny, formString, requireUser, safely } from '#lib/server/queries/actions.ts';
import { getEmployeeAuthContext, listEmployeeRefs } from '#lib/server/queries/employees.ts';
import { getAccountBasics, listUnknownAccounts } from '#lib/server/queries/unknown.ts';

export const load: PageServerLoad = async () => {
	const [accounts, employees] = await Promise.all([listUnknownAccounts(), listEmployeeRefs()]);
	return { accounts, employees };
};

export const actions: Actions = {
	link: async (event) => {
		const user = requireUser(event);
		const fd = await event.request.formData();
		const accountId = formString(fd, 'accountId');
		const employeeId = formString(fd, 'employeeId');
		const account = await getAccountBasics(accountId);
		if (!account) return fail(400, { error: 'Account not found.', field: 'accountId' });
		const emp = await getEmployeeAuthContext(employeeId);
		if (!emp) return fail(400, { error: 'Choose an employee.', field: 'employeeId' });
		const denied = deny(user, 'unknown.resolve', emp);
		if (denied) return denied;
		if (account.hasLink) return fail(400, { error: 'That account is already linked.', field: 'accountId' });
		return safely(async () => {
			const [e] = await sql`SELECT name FROM employees WHERE id = ${employeeId}`;
			await sql`
				INSERT INTO account_links (account_id, employee_id, link_method, confidence, evidence_json, confirmed, decided_by)
				VALUES (${accountId}, ${employeeId}, 'manual', 1, ${sql.json([`Linked manually by ${user.name}`])}, true, ${user.id})`;
			await sql`UPDATE accounts SET flag = 'unlinked' WHERE id = ${accountId}`;
			await audit({
				actorId: user.id,
				actorName: user.name,
				employeeId,
				system: account.system as never,
				kind: 'match',
				summary: `${user.name} linked ${account.system} account ${account.label} to ${e.name}`,
				detail: { accountId, method: 'manual' }
			});
			return { ok: true as const, message: `Linked ${account.label} to ${e.name}.` };
		});
	},

	markService: (event) => flagAction(event, 'service', 'marked as a service account'),
	flag: (event) => flagAction(event, 'flagged', 'flagged for review')
};

async function flagAction(event: RequestEvent, flag: 'service' | 'flagged', verb: string) {
	const user = requireUser(event);
	const denied = deny(user, 'unknown.resolve');
	if (denied) return denied;
	const fd = await event.request.formData();
	const account = await getAccountBasics(formString(fd, 'accountId'));
	if (!account) return fail(400, { error: 'Account not found.', field: 'accountId' });
	if (account.hasLink) return fail(400, { error: 'That account is already linked to an employee.', field: 'accountId' });
	return safely(async () => {
		await sql`UPDATE accounts SET flag = ${flag} WHERE id = ${account.id}`;
		await audit({
			actorId: user.id,
			actorName: user.name,
			system: account.system as never,
			kind: 'match',
			summary: `${user.name} ${verb}: ${account.system} account ${account.label}`,
			detail: { accountId: account.id, flag }
		});
		return { ok: true as const, message: `${account.label} ${verb}.` };
	});
}
