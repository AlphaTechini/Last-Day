import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import { sql as sharedSql, type Sql } from './index.ts';
import { encryptJson } from '../crypto.ts';
import { getSystemDef, SYSTEM_IDS } from '../connection-fields.ts';
import type { SystemId } from '#lib/types.ts';

export interface MigrateOptions {
	sql?: Sql;
	/** Create admin/judge users and upsert connections from env. Default true. */
	bootstrap?: boolean;
	log?: (msg: string) => void;
	env?: NodeJS.ProcessEnv;
}

export function migrationsDir(): string {
	const here = (() => {
		try {
			return dirname(fileURLToPath(import.meta.url));
		} catch {
			return process.cwd();
		}
	})();
	const candidates = [
		process.env.MIGRATIONS_DIR,
		join(here, 'migrations'),
		join(process.cwd(), 'src/lib/server/db/migrations'),
		join(process.cwd(), 'migrations')
	].filter((c): c is string => !!c);
	const found = candidates.find((c) => existsSync(c));
	if (!found) throw new Error(`Migrations directory not found (tried ${candidates.join(', ')}). Set MIGRATIONS_DIR.`);
	return found;
}

export async function migrate(opts: MigrateOptions = {}): Promise<{ applied: string[] }> {
	const sql = opts.sql ?? sharedSql;
	const log = opts.log ?? ((m: string) => console.log(`[migrate] ${m}`));
	const env = opts.env ?? process.env;

	await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
		filename text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`;

	const dir = migrationsDir();
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	const applied: string[] = [];
	for (const file of files) {
		const body = readFileSync(join(dir, file), 'utf8');
		await sql.begin(async (tx) => {
			// Serialize concurrent migrators (e.g. AUTO_MIGRATE on two processes).
			await tx`SELECT pg_advisory_xact_lock(727274)`;
			const [done] = await tx`SELECT 1 FROM schema_migrations WHERE filename = ${file}`;
			if (done) return;
			await tx.unsafe(body);
			await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
			applied.push(file);
			log(`applied ${file}`);
		});
	}
	if (applied.length === 0) log('schema up to date');

	if (opts.bootstrap !== false) await bootstrap(sql, env, log);
	return { applied };
}

async function upsertUser(sql: Sql, email: string, name: string, password: string, role: 'admin' | 'judge', explicit: boolean, log: (m: string) => void) {
	const [existing] = await sql`SELECT id, password_hash FROM app_users WHERE email = ${email}`;
	if (!existing) {
		const password_hash = await hash(password);
		await sql`INSERT INTO app_users (email, name, password_hash, role) VALUES (${email}, ${name}, ${password_hash}, ${role})`;
		log(`created ${role} user ${email}`);
		return;
	}
	// Keep the stored password in sync when it is set explicitly in the environment.
	if (explicit) {
		let same = false;
		try {
			same = await verify(existing.password_hash, password);
		} catch {
			same = false;
		}
		if (!same) {
			await sql`UPDATE app_users SET password_hash = ${await hash(password)}, role = ${role} WHERE id = ${existing.id}`;
			log(`updated password for ${email}`);
		}
	}
}

export function connectionSeedFromEnv(system: SystemId, env: NodeJS.ProcessEnv): { config: Record<string, string>; secrets: Record<string, string> } | null {
	const e = (k: string) => (env[k] ?? '').trim();
	switch (system) {
		case 'keycloak':
			if (!e('KEYCLOAK_BASE_URL')) return null;
			return {
				config: { baseUrl: e('KEYCLOAK_BASE_URL'), realm: e('KEYCLOAK_REALM'), clientId: e('KEYCLOAK_CLIENT_ID') },
				secrets: e('KEYCLOAK_CLIENT_SECRET') ? { clientSecret: e('KEYCLOAK_CLIENT_SECRET') } : {}
			};
		case 'mattermost':
			if (!e('MATTERMOST_BASE_URL')) return null;
			return {
				config: { baseUrl: e('MATTERMOST_BASE_URL') },
				secrets: e('MATTERMOST_ADMIN_TOKEN') ? { token: e('MATTERMOST_ADMIN_TOKEN') } : {}
			};
		case 'github':
			if (!e('GITHUB_ORG')) return null;
			return {
				config: {
					apiUrl: e('GITHUB_API_URL') || 'https://api.github.com',
					org: e('GITHUB_ORG'),
					repos: e('GITHUB_REPOS')
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
						.join(',')
				},
				secrets: e('GITHUB_TOKEN') ? { token: e('GITHUB_TOKEN') } : {}
			};
		case 'vultr':
			if (!e('VULTR_API_KEY')) return null;
			return {
				config: { apiUrl: e('VULTR_API_URL') || 'https://api.vultr.com/v2' },
				secrets: { apiKey: e('VULTR_API_KEY') }
			};
	}
}

async function bootstrap(sql: Sql, env: NodeJS.ProcessEnv, log: (m: string) => void) {
	const prod = env.NODE_ENV === 'production';

	// Admin
	const adminEmail = (env.ADMIN_EMAIL || (prod ? '' : 'admin@lastday.local')).trim().toLowerCase();
	const adminPassword = env.ADMIN_PASSWORD || (prod ? '' : 'lastday-admin');
	if (adminEmail && adminPassword) {
		await upsertUser(sql, adminEmail, 'Admin', adminPassword, 'admin', !!env.ADMIN_PASSWORD, log);
	} else if (prod) {
		const [any] = await sql`SELECT 1 FROM app_users WHERE role = 'admin' LIMIT 1`;
		if (!any) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required in production to create the first admin');
	}

	// Judge
	const judgeEmail = (env.JUDGE_EMAIL || (prod ? '' : 'judge@lastday.local')).trim().toLowerCase();
	const judgePassword = env.JUDGE_PASSWORD || (prod ? '' : 'judge-demo');
	if (judgeEmail && judgePassword) {
		await upsertUser(sql, judgeEmail, 'Judge', judgePassword, 'judge', !!env.JUDGE_PASSWORD, log);
	}

	// Connections from env
	for (const system of SYSTEM_IDS) {
		const seed = connectionSeedFromEnv(system, env);
		if (!seed) continue;
		const def = getSystemDef(system);
		const hasSecrets = Object.keys(seed.secrets).length > 0;
		const cipher = hasSecrets ? encryptJson(seed.secrets) : null;
		const config = Object.fromEntries(def.configFields.map((f) => [f.key, seed.config[f.key] ?? '']));
		// Existing secrets are kept when the env provides none; status resets only when something changed.
		const [prev] = await sql`SELECT config_json FROM connections WHERE system = ${system}`;
		const changed = !prev || JSON.stringify(prev.config_json) !== JSON.stringify(config) || hasSecrets;
		await sql`
			INSERT INTO connections (system, config_json, credential_ciphertext, status)
			VALUES (${system}, ${sql.json(config)}, ${cipher}, 'untested')
			ON CONFLICT (system) DO UPDATE SET
				config_json = EXCLUDED.config_json,
				credential_ciphertext = COALESCE(EXCLUDED.credential_ciphertext, connections.credential_ciphertext)`;
		if (changed && prev) await sql`UPDATE connections SET status = 'untested', last_error = NULL WHERE system = ${system}`;
		log(`connection ${system} configured from environment`);
	}
}
