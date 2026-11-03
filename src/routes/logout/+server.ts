import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, clearSessionCookie, deleteSession } from '#lib/server/auth.ts';
import { audit } from '#lib/server/audit.ts';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const token = cookies.get(SESSION_COOKIE);
	try {
		await deleteSession(token);
		if (locals.user) await audit({ actorId: locals.user.id, actorName: locals.user.name, kind: 'auth', summary: `${locals.user.name} signed out` });
	} catch (err) {
		console.error('[logout] failed:', err instanceof Error ? err.message : err);
	}
	clearSessionCookie(cookies);
	redirect(303, '/login');
};
