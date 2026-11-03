import type { PageServerLoad } from './$types';
import { AUDIT_PAGE_SIZE, listAudit } from '#lib/server/queries/audit.ts';
import { listEmployeeRefs } from '#lib/server/queries/employees.ts';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams;
	const page = Math.max(1, Math.min(100000, Number.parseInt(q.get('page') ?? '1', 10) || 1));
	const [result, employees] = await Promise.all([
		listAudit(
			{ employee: q.get('employee') ?? undefined, runId: q.get('run') ?? undefined, system: q.get('system') ?? undefined, actor: q.get('actor') ?? undefined, kind: q.get('kind') ?? undefined },
			page
		),
		listEmployeeRefs()
	]);
	return {
		entries: result.entries,
		total: result.total,
		page,
		pageSize: AUDIT_PAGE_SIZE,
		filters: result.filters,
		employees: employees.map((e) => ({ id: e.id, name: e.name }))
	};
};
