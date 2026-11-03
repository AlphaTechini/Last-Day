import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from '#lib/server/db/index.ts';

export const GET: RequestHandler = async () => {
	let db = false;
	try {
		await sql`SELECT 1`;
		db = true;
	} catch {
		db = false;
	}
	return json({ ok: true as const, db, version: process.env.APP_VERSION ?? '0.0.1' }, { headers: { 'cache-control': 'no-store' } });
};
