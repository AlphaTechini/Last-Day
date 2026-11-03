import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deny, requireUser, safely } from '#lib/server/queries/actions.ts';
import { can, toActor } from '#lib/server/permissions.ts';
import { getEmployee, listEmployeeAccounts } from '#lib/server/queries/employees.ts';
import { listRuns } from '#lib/server/queries/runs.ts';
import { startOffboarding } from '#lib/server/engine/index.ts';
import { sql } from '#lib/server/db/index.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const found = await getEmployee(params.id);
	if (!found) error(404, 'Employee not found');
	const { isDemo, ...employee } = found;
	const [accounts, runs] = await Promise.all([listEmployeeAccounts(params.id), listRuns({ employeeId: params.id, limit: 50 })]);
	return {
		employee,
		accounts,
		runs,
		canOffboard: employee.status === 'active' && can(locals.user, 'offboard', { employeeIsDemo: isDemo, employeeManagerId: employee.managerId })
	};
};

export const actions: Actions = {
	offboard: async (event) => {
		const user = requireUser(event);
		const emp = await getEmployee(event.params.id);
		if (!emp) error(404, 'Employee not found');
		const denied = deny(user, 'offboard', { employeeIsDemo: emp.isDemo, employeeManagerId: emp.managerId });
		if (denied) return denied;
		if (emp.status === 'offboarded') return fail(400, { error: `${emp.name} is already offboarded.` });
		if (emp.status === 'offboarding') {
			const [open] = await sql`SELECT id FROM runs WHERE employee_id = ${emp.id} AND status IN ('review', 'executing') ORDER BY started_at DESC LIMIT 1`;
			if (open) redirect(303, `/runs/${open.id}`);
		}
		const result = await safely(async () => ({ runId: await startOffboarding(emp.id, toActor(user)) }));
		if ('runId' in result) redirect(303, `/runs/${result.runId}`);
		return result;
	}
};
