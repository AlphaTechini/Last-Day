import type { Actions, PageServerLoad } from './$types';
import { getDashboard } from '#lib/server/queries/dashboard.ts';
import { deny, requireUser, safely } from '#lib/server/queries/actions.ts';
import { toActor } from '#lib/server/permissions.ts';
import { resetDemo, sweepAll } from '#lib/server/engine/index.ts';

export const load: PageServerLoad = async ({ locals }) => {
	return getDashboard(locals.user!);
};

export const actions: Actions = {
	sweep: async (event) => {
		const user = requireUser(event);
		return deny(user, 'sweep') ?? safely(async () => {
			const r = await sweepAll(toActor(user));
			return { ok: true as const, message: `Sweep complete: ${r.accounts} accounts, ${r.linkedByRules} linked by rules, ${r.aiSuggested} suggested by AI, ${r.unknown} unknown.` };
		});
	},
	resetDemo: async (event) => {
		const user = requireUser(event);
		return deny(user, 'resetDemo') ?? safely(async () => {
			await resetDemo(toActor(user));
			return { ok: true as const, message: 'Demo company reset.' };
		});
	}
};
