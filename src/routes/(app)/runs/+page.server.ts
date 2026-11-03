import type { PageServerLoad } from './$types';
import { listRuns } from '#lib/server/queries/runs.ts';

export const load: PageServerLoad = async () => {
	return { runs: await listRuns() };
};
