// Usage: pnpm db:migrate  (needs DATABASE_URL, MASTER_KEY; see .env.example)
import { migrate } from '../src/lib/server/db/migrate.ts';
import { sql } from '../src/lib/server/db/index.ts';

try {
	await migrate();
	await sql.end({ timeout: 5 });
} catch (err) {
	console.error('[migrate] failed:', err instanceof Error ? err.message : err);
	await sql.end({ timeout: 1 }).catch(() => {});
	process.exit(1);
}
