// Helpers shared by +page.server.ts actions.
import { fail, isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from '#lib/types.ts';
import { can, type Permission, type PermissionContext } from '#lib/server/permissions.ts';

/** The signed-in user, or a redirect to /login. */
export function requireUser(event: Pick<RequestEvent, 'locals'>): SessionUser {
	if (!event.locals.user) redirect(303, '/login');
	return event.locals.user;
}

/** Returns a 403 failure when not allowed, otherwise null. */
export function deny(user: SessionUser, permission: Permission, ctx?: PermissionContext) {
	return can(user, permission, ctx) ? null : fail(403, { error: 'You do not have permission to do that.' });
}

/** Runs fn; redirects pass through, other errors become fail(500, { error }) so the UI can show them. */
export async function safely<T>(fn: () => Promise<T>): Promise<T | ReturnType<typeof fail<{ error: string }>>> {
	try {
		return await fn();
	} catch (err) {
		if (isRedirect(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		console.error('[action] failed:', message);
		return fail(500, { error: message });
	}
}

export function formString(fd: FormData, key: string): string {
	const v = fd.get(key);
	return typeof v === 'string' ? v.trim() : '';
}
