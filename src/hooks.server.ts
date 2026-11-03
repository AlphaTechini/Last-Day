import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, userFromToken } from '#lib/server/auth.ts';
import { startBackground } from '#lib/server/engine/index.ts';
import { migrate } from '#lib/server/db/migrate.ts';

export const init: ServerInit = async () => {
	if (process.env.AUTO_MIGRATE === '1') {
		try {
			await migrate();
		} catch (err) {
			console.error('[init] AUTO_MIGRATE failed:', err);
		}
	}
	try {
		await startBackground();
	} catch (err) {
		console.error('[init] engine startBackground failed (continuing):', err instanceof Error ? err.message : err);
	}
};

export const handle: Handle = async ({ event, resolve }) => {
	try {
		event.locals.user = await userFromToken(event.cookies.get(SESSION_COOKIE));
	} catch (err) {
		console.error('[auth] session lookup failed:', err instanceof Error ? err.message : err);
		event.locals.user = null;
	}

	const response = await resolve(event);

	const h = response.headers;
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	h.set('Content-Security-Policy', "frame-ancestors 'none'");
	if (process.env.NODE_ENV === 'production') h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	if (event.locals.user) h.set('Cache-Control', h.get('Cache-Control') ?? 'private, no-store');
	return response;
};
