/**
 * Runs every capability check in order (C1, C7, C2 to C6, C8) and prints a summary.
 *
 *   pnpm tsx scripts/capability-checks/run-all.ts                 # dry run, read-only probes
 *   pnpm tsx scripts/capability-checks/run-all.ts --apply         # creates and removes test resources
 *   pnpm tsx scripts/capability-checks/run-all.ts --escalation    # adds glm-5.2 calls to C6
 *
 * Exit code 1 when any check fails. SKIP (missing .env variables) exits 0.
 */
import { isMain, parseFlags, type Outcome, type RunFlags } from './lib.js';
import { run as runC1 } from './c1-vultr-iam.js';
import { run as runC2 } from './c2-vultr-instances.js';
import { run as runC3 } from './c3-keycloak.js';
import { run as runC4 } from './c4-mattermost.js';
import { run as runC5 } from './c5-github.js';
import { run as runC6 } from './c6-inference.js';
import { run as runC7 } from './c7-billing.js';
import { run as runC8 } from './c8-company-stack.js';

/** C1 and C7 can change the design, so they run first (CAPABILITY_CHECKS.md). */
const ORDER: Array<(flags: RunFlags) => Promise<Outcome>> = [
	runC1,
	runC7,
	runC2,
	runC3,
	runC4,
	runC5,
	runC6,
	runC8,
];

export async function runAll(flags: RunFlags): Promise<Outcome[]> {
	const outcomes: Outcome[] = [];
	for (const run of ORDER) {
		outcomes.push(await run(flags));
	}
	return outcomes;
}

if (isMain(import.meta.url)) {
	const flags = parseFlags();
	console.log(
		`Capability checks. Mode: ${flags.apply ? '--apply (creates and removes test resources)' : 'dry run (read-only probes)'}${flags.escalation ? ', with escalation' : ''}`,
	);
	const outcomes = await runAll(flags);

	console.log('\n== Summary');
	console.log(`${'check'.padEnd(20)}${'status'.padEnd(8)}summary`);
	for (const o of outcomes) {
		console.log(`${o.name.padEnd(20)}${o.status.padEnd(8)}${o.summary}`);
	}
	const failed = outcomes.filter((o) => o.status === 'FAIL').length;
	console.log(failed > 0 ? `${failed} check(s) FAILED: see the logs under evidence/capability-checks/` : 'no failures');
	process.exitCode = failed > 0 ? 1 : 0;
}
