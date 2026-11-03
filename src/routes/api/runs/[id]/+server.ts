import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRunDetail } from '#lib/server/queries/runs.ts';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const run = await getRunDetail(params.id, locals.user);
	if (!run) error(404, 'Run not found');
	return json(run, { headers: { 'cache-control': 'no-store' } });
};
