import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authenticate, createSession, rateLimitLogin, setSessionCookie } from '#lib/server/auth.ts';
import { audit } from '#lib/server/audit.ts';

function demoHint(): { email: string; password: string } | null {
	const prod = process.env.NODE_ENV === 'production';
	const enabled = process.env.DEMO_LOGIN_HINT ? process.env.DEMO_LOGIN_HINT === '1' : !prod;
	if (!enabled) return null;
	const email = process.env.JUDGE_EMAIL || (prod ? '' : 'judge@lastday.local');
	const password = process.env.JUDGE_PASSWORD || (prod ? '' : 'judge-demo');
	return email && password ? { email, password } : null;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { demoHint: demoHint() };
};

export const actions: Actions = {
	login: async ({ request, cookies, getClientAddress }) => {
		const fd = await request.formData();
		const email = String(fd.get('email') ?? '').trim().toLowerCase();
		const password = String(fd.get('password') ?? '');
		if (!email || !password) return fail(400, { error: 'Enter your email and password.', field: email ? 'password' : 'email' });

		let ip = 'unknown';
		try {
			ip = getClientAddress();
		} catch {
			// no address available (e.g. unusual proxy setup)
		}
		if (!rateLimitLogin(ip)) return fail(429, { error: 'Too many sign-in attempts. Try again in a minute.' });

		let user;
		try {
			user = await authenticate(email, password);
		} catch (err) {
			console.error('[login] failed:', err instanceof Error ? err.message : err);
			return fail(500, { error: 'Sign-in is unavailable right now.' });
		}
		if (!user) {
			await audit({ kind: 'auth', summary: `Failed sign-in for ${email}`, detail: { email, ip } }).catch(() => {});
			return fail(400, { error: 'Invalid email or password.' });
		}
		const { token, expiresAt } = await createSession(user.id);
		setSessionCookie(cookies, token, expiresAt);
		await audit({ actorId: user.id, actorName: user.name, kind: 'auth', summary: `${user.name} signed in`, detail: { role: user.role, ip } }).catch(() => {});
		redirect(303, '/');
	}
};
