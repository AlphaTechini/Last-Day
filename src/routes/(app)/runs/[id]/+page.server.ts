import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { approveItems, decideItem, destroyServer, recheckNow, retryItem } from '#lib/server/engine/index.ts';
import { deny, formString, requireUser, safely } from '#lib/server/queries/actions.ts';
import { toActor, type Permission } from '#lib/server/permissions.ts';
import { getRunAuthContext, getRunDetail, runItemBelongsToRun } from '#lib/server/queries/runs.ts';
import { isUuid } from '#lib/server/queries/mappers.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const run = await getRunDetail(params.id, locals.user);
	if (!run) error(404, 'Run not found');
	return { run };
};

/** Loads the run's permission context and checks the permission server-side. */
async function authorize(event: RequestEvent, permission: Permission) {
	const user = requireUser(event);
	const runId = event.params.id!;
	const ctx = await getRunAuthContext(runId);
	if (!ctx) error(404, 'Run not found');
	const denied = deny(user, permission, ctx);
	return { user, runId, denied };
}

async function itemAction(event: RequestEvent, permission: Permission, run: (a: { runId: string; itemId: string; fd: FormData; actor: ReturnType<typeof toActor> }) => Promise<string | void>) {
	const { user, runId, denied } = await authorize(event, permission);
	if (denied) return denied;
	const fd = await event.request.formData();
	const itemId = formString(fd, 'itemId');
	if (!isUuid(itemId) || !(await runItemBelongsToRun(runId, itemId))) return fail(400, { error: 'Unknown item for this run.', field: 'itemId' });
	return safely(async () => {
		const message = await run({ runId, itemId, fd, actor: toActor(user) });
		return { ok: true as const, ...(message ? { message } : {}) };
	});
}

export const actions: Actions = {
	decide: (event) =>
		itemAction(event, 'run.decide', async ({ runId, itemId, fd, actor }) => {
			const decision = formString(fd, 'decision');
			if (decision !== 'yes' && decision !== 'no') throw new Error('decision must be "yes" or "no"');
			await decideItem(runId, itemId, decision, actor);
		}),

	approve: async (event) => {
		const { user, runId, denied } = await authorize(event, 'run.approve');
		if (denied) return denied;
		const fd = await event.request.formData();
		const all = formString(fd, 'all') === '1';
		const itemIds = fd.getAll('itemIds').filter((v): v is string => typeof v === 'string' && v !== '');
		if (!all && itemIds.length === 0) return fail(400, { error: 'Select at least one item to approve.', field: 'itemIds' });
		if (itemIds.some((id) => !isUuid(id))) return fail(400, { error: 'Invalid item id.', field: 'itemIds' });
		return safely(async () => {
			await approveItems(runId, all ? 'all' : itemIds, toActor(user));
			return { ok: true as const, message: 'Revocation approved. Running now.' };
		});
	},

	retry: (event) => itemAction(event, 'run.retry', async ({ runId, itemId, actor }) => retryItem(runId, itemId, actor)),

	destroy: (event) =>
		itemAction(event, 'run.destroy', async ({ runId, itemId, actor }) => {
			await destroyServer(runId, itemId, actor);
			return 'Destroying the server.';
		}),

	recheck: async (event) => {
		const { user, runId, denied } = await authorize(event, 'run.recheck');
		if (denied) return denied;
		return safely(async () => {
			await recheckNow(runId, toActor(user));
			return { ok: true as const, message: 'Re-check started.' };
		});
	}
};
