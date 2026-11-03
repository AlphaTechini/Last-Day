// Usage: MASTER_KEY=... pnpm seed   (seeds the demo company into the DB and every configured connection)
import { sql } from '../src/lib/server/db/index.ts';
import { seedDemoCompany } from '../src/lib/server/demo/seed.ts';

let code = 0;
try {
	await seedDemoCompany();
	console.log('[seed] done');
} catch (err) {
	console.error('[seed] failed:', err instanceof Error ? err.message : err);
	code = 1;
} finally {
	await sql.end({ timeout: 5 }).catch(() => {});
}
process.exit(code);
