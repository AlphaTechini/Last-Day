import { sql } from '../src/lib/server/db/index.ts';
import { loadAllConnectors } from '../src/lib/server/connectors/index.ts';
const cs = await loadAllConnectors();
for (const c of cs) {
	const t = await c.test();
	const accts = await c.listAccounts();
	const byKind: Record<string, number> = {};
	for (const a of accts) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
	console.log(`\n== ${c.system}: ${t.ok ? 'OK' : 'FAIL'} ${t.message} | ${accts.length} accounts ${JSON.stringify(byKind)}`);
	for (const a of accts.filter((a) => /dana|dok|D\. O|build-runner|ops-bot|swhitlock|terraform|proton|gmail/i.test(JSON.stringify([a.username, a.displayName, a.emails, a.raw?.label])))) {
		console.log(`  ${a.kind.padEnd(10)} id=${a.externalId} user=${a.username} name=${a.displayName} emails=${a.emails.join('|')} active=${a.active} parent=${a.parentExternalId ?? ''} actions=${c.actionsFor(a).join(',')}`);
	}
}
await sql.end();
