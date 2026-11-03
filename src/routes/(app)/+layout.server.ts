import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getNavCounts } from '#lib/server/queries/dashboard.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const { nav, isDemo } = await getNavCounts(locals.user);
	return { user: locals.user, nav, isDemo };
};
