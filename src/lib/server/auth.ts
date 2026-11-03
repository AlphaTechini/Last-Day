import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Cookies } from '@sveltejs/kit';
import { sql } from '#lib/server/db/index.ts';
import { sha256 } from '#lib/server/crypto.ts';
import type { Role, SessionUser } from '#lib/types.ts';

export const SESSION_COOKIE = 'ld_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): Promise<string> {
	return hash(password); // argon2id is the @node-rs/argon2 default
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		return await verify(passwordHash, password);
	} catch {
		return false;
	}
}

let dummyHash: Promise<string> | null = null;

/** Returns the user when email + password match. Spends the same time for unknown emails. */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
	const [row] = await sql`SELECT id, email, name, role, employee_id, password_hash FROM app_users WHERE email = ${email.trim().toLowerCase()}`;
	if (!row) {
		dummyHash ??= hashPassword('not-a-real-password');
		await verifyPassword(await dummyHash, password);
		return null;
	}
	if (!(await verifyPassword(row.password_hash, password))) return null;
	return rowToUser(row);
}

function rowToUser(row: Record<string, unknown>): SessionUser {
	return {
		id: row.id as string,
		email: row.email as string,
		name: row.name as string,
		role: row.role as Role,
		employeeId: (row.employee_id as string | null) ?? null
	};
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, ${expiresAt})`;
	if (Math.random() < 0.02) void sql`DELETE FROM sessions WHERE expires_at < now()`.catch(() => {});
	return { token, expiresAt };
}

export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
	if (!token || token.length > 200) return null;
	const [row] = await sql`
		SELECT u.id, u.email, u.name, u.role, u.employee_id
		FROM sessions s JOIN app_users u ON u.id = s.user_id
		WHERE s.id = ${sha256(token)} AND s.expires_at > now()`;
	return row ? rowToUser(row) : null;
}

export async function deleteSession(token: string | undefined): Promise<void> {
	if (!token) return;
	await sql`DELETE FROM sessions WHERE id = ${sha256(token)}`;
}

function secureCookies(): boolean {
	if (process.env.COOKIE_SECURE === '0') return false;
	if (process.env.COOKIE_SECURE === '1') return true;
	return process.env.NODE_ENV === 'production';
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: secureCookies(),
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

// --- naive in-memory login rate limit: 10 attempts / minute / IP ---
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 10;

/** Returns true when the attempt is allowed (and records it). */
export function rateLimitLogin(ip: string, now = Date.now()): boolean {
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= MAX_HITS) {
		hits.set(ip, recent);
		return false;
	}
	recent.push(now);
	hits.set(ip, recent);
	if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
	return true;
}

export function resetRateLimit(): void {
	hits.clear();
}
