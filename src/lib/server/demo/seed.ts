// Seeds the fictional demo company "Northwind Labs": employees and app users in Last Day's own database,
// and the matching identities in every configured target system through its real admin API.
// Idempotent. Touches only demo identities (spec usernames / the demo email domain / the lastday-demo marker).
// It never touches runs, accounts, run_items, approvals or audit_log: the engine's resetDemo clears those and
// calls this before it sweeps.
import { hash, verify } from '@node-rs/argon2';
import { sql as sharedSql, type Sql } from '#lib/server/db/index.ts';
import { loadConnectionConfig } from '#lib/server/connectors/index.ts';
import { SYSTEM_IDS } from '#lib/server/connection-fields.ts';
import type { SystemId } from '#lib/types.ts';
import { LEAVER_KEY, MANAGER_KEY, PEOPLE, demoDomain, workEmail } from './company.ts';
import { detectMock, type SeedCtx } from './systems/common.ts';
import { seedGithub } from './systems/github.ts';
import { seedKeycloak } from './systems/keycloak.ts';
import { seedMattermost } from './systems/mattermost.ts';
import { seedVultr } from './systems/vultr.ts';

export interface SeedOptions {
	log?: (s: string) => void;
	/** Override the database handle (tests). Defaults to the shared pool. */
	sql?: Sql;
	env?: NodeJS.ProcessEnv;
	/** Limit to some systems. Default: every configured connection. The employee/app-user part always runs. */
	systems?: SystemId[];
}

export async function seedDemoCompany(opts: SeedOptions = {}): Promise<void> {
	const log = opts.log ?? ((s: string) => console.log(`[seed] ${s}`));
	const sql = opts.sql ?? sharedSql;
	const env = opts.env ?? process.env;
	const domain = demoDomain(env);

	await seedEmployees(sql, domain, env, log);

	const failures: string[] = [];
	for (const system of SYSTEM_IDS) {
		if (opts.systems && !opts.systems.includes(system)) continue;
		let config;
		try {
			config = await loadConnectionConfig(system, sql);
		} catch (e) {
			failures.push(`${system}: ${(e as Error).message}`);
			continue;
		}
		if (!config) {
			log(`${system}: no complete connection configured, skipped`);
			continue;
		}
		const baseUrl = system === 'keycloak' || system === 'mattermost' ? config.baseUrl : system === 'github' ? config.apiUrl || 'https://api.github.com' : config.apiUrl || 'https://api.vultr.com/v2';
		const mockOrigin = await detectMock(baseUrl);
		const ctx: SeedCtx = { log: (s) => log(s), domain, env, isMock: !!mockOrigin, mockOrigin };
		if (mockOrigin) log(`${system}: using the dev sandbox at ${mockOrigin}`);
		try {
			if (system === 'keycloak') await seedKeycloak(config, ctx);
			else if (system === 'mattermost') await seedMattermost(config, ctx);
			else if (system === 'github') await seedGithub(config, ctx);
			else await seedVultr(config, ctx);
		} catch (e) {
			log(`${system}: FAILED ${(e as Error).message}`);
			failures.push(`${system}: ${(e as Error).message}`);
		}
	}
	if (failures.length) throw new Error(`Demo seed incomplete: ${failures.join('; ')}`);
}

async function seedEmployees(sql: Sql, domain: string, env: NodeJS.ProcessEnv, log: (s: string) => void): Promise<void> {
	const ids = new Map<string, string>();
	let skipped = 0;
	for (const p of PEOPLE) {
		const email = workEmail(p, domain);
		const aliases = p.aliases.map((a) => a.toLowerCase());
		const [row] = await sql`
			INSERT INTO employees (name, work_email, aliases, role, department, status, start_date, end_date, is_demo)
			VALUES (${p.name}, ${email}, ${aliases}, ${p.title}, ${p.department}, 'active', ${p.startDate}, NULL, true)
			ON CONFLICT (work_email) DO UPDATE SET
				name = EXCLUDED.name, aliases = EXCLUDED.aliases, role = EXCLUDED.role, department = EXCLUDED.department,
				status = 'active', start_date = EXCLUDED.start_date, end_date = NULL
			WHERE employees.is_demo = true
			RETURNING id`;
		if (row) ids.set(p.key, row.id);
		else skipped++; // a non-demo employee owns this address: leave it alone
	}
	for (const p of PEOPLE) {
		if (!p.managerKey || !ids.has(p.key)) continue;
		await sql`UPDATE employees SET manager_id = ${ids.get(p.managerKey) ?? null} WHERE id = ${ids.get(p.key)!} AND is_demo = true`;
	}
	log(`employees: ${ids.size} demo employees upserted and set active${skipped ? ` (${skipped} skipped: address belongs to a non-demo employee)` : ''}`);

	// App users: HR and the leaver's manager.
	const prod = env.NODE_ENV === 'production';
	const hrPassword = env.DEMO_HR_PASSWORD || (prod ? '' : 'demo-hr');
	const mgrPassword = env.DEMO_MANAGER_PASSWORD || (prod ? '' : 'demo-manager');
	const priya = PEOPLE.find((p) => p.key === MANAGER_KEY)!;
	const specs = [
		{ email: `hr@${domain}`, name: 'Tessa Brooks (People Ops)', role: 'hr', password: hrPassword, employeeId: null as string | null },
		{ email: workEmail(priya, domain), name: priya.name, role: 'manager', password: mgrPassword, employeeId: ids.get(MANAGER_KEY) ?? null }
	];
	for (const u of specs) {
		if (!u.password) {
			log(`app user ${u.email}: no password configured (set DEMO_HR_PASSWORD / DEMO_MANAGER_PASSWORD), skipped`);
			continue;
		}
		const [cur] = await sql`SELECT id, password_hash FROM app_users WHERE email = ${u.email}`;
		if (!cur) {
			await sql`INSERT INTO app_users (email, name, password_hash, role, employee_id) VALUES (${u.email}, ${u.name}, ${await hash(u.password)}, ${u.role}, ${u.employeeId})`;
			log(`app user ${u.email} created (${u.role})`);
			continue;
		}
		let same = false;
		try {
			same = await verify(cur.password_hash, u.password);
		} catch {
			same = false;
		}
		await sql`UPDATE app_users SET name = ${u.name}, role = ${u.role}, employee_id = ${u.employeeId}, password_hash = ${same ? cur.password_hash : await hash(u.password)} WHERE id = ${cur.id}`;
	}
	void LEAVER_KEY;
}
