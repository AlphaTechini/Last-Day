import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import { deny, formString, requireUser, safely } from '#lib/server/queries/actions.ts';
import { can } from '#lib/server/permissions.ts';
import { listDepartments, listEmployees } from '#lib/server/queries/employees.ts';
import { isUuid } from '#lib/server/queries/mappers.ts';
import { isValidDate, parseEmployeeCsv, splitAliases } from '#lib/server/csv.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const [employees, departments] = await Promise.all([listEmployees(), listDepartments()]);
	return {
		employees,
		departments,
		managers: employees.map((e) => ({ id: e.id, name: e.name })),
		canEdit: can(locals.user, 'employees.write')
	};
};

const createSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	workEmail: z.string().email('Enter a valid work email').max(320),
	role: z.string().max(200),
	department: z.string().max(200),
	managerId: z.string().refine((v) => v === '' || isUuid(v), 'Invalid manager'),
	startDate: z.string().refine((v) => v === '' || isValidDate(v), 'Start date must be YYYY-MM-DD')
});

const MAX_CSV_BYTES = 1_000_000;

export const actions: Actions = {
	create: async (event) => {
		const user = requireUser(event);
		const denied = deny(user, 'employees.write');
		if (denied) return denied;
		const fd = await event.request.formData();
		const parsed = createSchema.safeParse({
			name: formString(fd, 'name'),
			workEmail: formString(fd, 'workEmail').toLowerCase(),
			role: formString(fd, 'role'),
			department: formString(fd, 'department'),
			managerId: formString(fd, 'managerId'),
			startDate: formString(fd, 'startDate')
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return fail(400, { error: issue.message, field: String(issue.path[0] ?? '') });
		}
		const d = parsed.data;
		const aliases = splitAliases(formString(fd, 'aliases'));
		return safely(async () => {
			try {
				const [row] = await sql`
					INSERT INTO employees (name, work_email, role, department, manager_id, start_date, aliases, is_demo)
					VALUES (${d.name}, ${d.workEmail}, ${d.role}, ${d.department}, ${d.managerId || null}, ${d.startDate || null}, ${aliases}, ${user.role === 'judge'})
					RETURNING id`;
				await audit({ actorId: user.id, actorName: user.name, employeeId: row.id, kind: 'employee', summary: `${user.name} added employee ${d.name}`, detail: { workEmail: d.workEmail } });
				return { ok: true as const, message: `Added ${d.name}.` };
			} catch (err) {
				if ((err as { code?: string }).code === '23505') return fail(400, { error: 'An employee with that work email already exists.', field: 'workEmail' });
				throw err;
			}
		});
	},

	importCsv: async (event) => {
		const user = requireUser(event);
		const denied = deny(user, 'employees.write');
		if (denied) return denied;
		const fd = await event.request.formData();
		const file = fd.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a CSV file to import.', field: 'file' });
		if (file.size > MAX_CSV_BYTES) return fail(400, { error: 'The CSV is too large (max 1 MB).', field: 'file' });
		const { rows, errors } = parseEmployeeCsv(await file.text());
		if (errors.length) {
			const shown = errors.slice(0, 5).map((e) => `line ${e.line}: ${e.message}`).join('; ');
			return fail(400, { error: `CSV not imported. ${shown}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`, field: 'file' });
		}
		if (rows.length === 0) return fail(400, { error: 'The CSV has no rows.', field: 'file' });

		return safely(async () => {
			const isDemo = user.role === 'judge';
			let created = 0;
			let updated = 0;
			const unresolved: string[] = [];
			await sql.begin(async (tx) => {
				for (const r of rows) {
					const [res] = await tx`
						INSERT INTO employees (name, work_email, role, department, start_date, aliases, is_demo)
						VALUES (${r.name}, ${r.workEmail}, ${r.role}, ${r.department}, ${r.startDate}, ${r.aliases}, ${isDemo})
						ON CONFLICT (work_email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, department = EXCLUDED.department,
							start_date = EXCLUDED.start_date, aliases = EXCLUDED.aliases
						RETURNING (xmax = 0) AS inserted`;
					if (res.inserted) created++;
					else updated++;
				}
				// Second pass so managers can appear later in the file than their reports.
				for (const r of rows) {
					if (!r.managerEmail) continue;
					const upd = await tx`
						UPDATE employees SET manager_id = (SELECT id FROM employees WHERE work_email = ${r.managerEmail})
						WHERE work_email = ${r.workEmail} RETURNING manager_id`;
					if (!upd[0]?.manager_id) unresolved.push(`${r.workEmail} (manager ${r.managerEmail} not found)`);
				}
			});
			await audit({
				actorId: user.id,
				actorName: user.name,
				kind: 'employee',
				summary: `${user.name} imported ${rows.length} employees from CSV (${created} new, ${updated} updated)`,
				detail: { created, updated, unresolvedManagers: unresolved.slice(0, 20) }
			});
			const note = unresolved.length ? ` ${unresolved.length} manager reference(s) could not be resolved.` : '';
			return { ok: true as const, message: `Imported ${rows.length} employees (${created} new, ${updated} updated).${note}` };
		});
	}
};
