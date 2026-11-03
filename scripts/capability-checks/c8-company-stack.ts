/**
 * C8: Company stack fits on VM 2 (Keycloak, Mattermost, Postgres on a VX1 2 vCPU / 8 GB).
 *
 * Checks that both web consoles answer, then prints the memory commands to run
 * on the VM under light load, and the host memory this script can read.
 * Read-only.
 */
import { readFileSync } from 'node:fs';
import { isMain, parseFlags, req, runCheck, type Ctx, type Outcome, type RunFlags } from './lib.js';

const NAME = 'c8-company-stack';

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C8 Company stack on VM 2: consoles respond, memory under light load',
			required: ['KEYCLOAK_BASE_URL', 'MATTERMOST_BASE_URL'],
			body: c8,
		},
		flags,
	);
}

async function c8(x: Ctx): Promise<void> {
	const c = x.c;
	const kc = x.need('KEYCLOAK_BASE_URL').replace(/\/+$/, '');
	const realm = x.opt('KEYCLOAK_REALM') ?? 'company';
	const mm = x.need('MATTERMOST_BASE_URL').replace(/\/+$/, '');

	c.title('Both consoles respond');
	const discovery = await req('GET', `${kc}/realms/${realm}/.well-known/openid-configuration`);
	c.assert(discovery.status === 200, `Keycloak realm "${realm}" discovery answers`, discovery);
	const kcAdmin = await req('GET', `${kc}/admin/`);
	c.assert(kcAdmin.status === 200, 'Keycloak admin console answers (after redirects)', kcAdmin);
	const ping = await req('GET', `${mm}/api/v4/system/ping`);
	c.assert(ping.status === 200 && ping.json?.status === 'OK', 'Mattermost API ping', ping);
	const web = await req('GET', `${mm}/`);
	c.assert(web.status === 200, 'Mattermost web app answers', web);

	c.title('Memory under light load');
	c.info('Run the C3 and C4 flows first, wait about 10 minutes, then on the VM run:');
	c.info('  docker stats --no-stream --format "table {{.Name}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.CPUPerc}}"');
	c.info('Record the MemUsage of the Keycloak, Mattermost and Postgres containers. They must leave headroom on 8 GB for the OS and the app.');
	const meminfo = readMeminfo();
	c.info(meminfo ? `this host: ${meminfo}` : 'this host: /proc/meminfo not readable (not Linux, or not the VM)');
}

/** MemTotal and MemAvailable from /proc/meminfo, if this script runs on Linux. */
function readMeminfo(): string | undefined {
	try {
		const text = readFileSync('/proc/meminfo', 'utf8');
		const field = (name: string) => text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1];
		return `MemTotal ${field('MemTotal')} kB, MemAvailable ${field('MemAvailable')} kB`;
	} catch {
		return undefined;
	}
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
