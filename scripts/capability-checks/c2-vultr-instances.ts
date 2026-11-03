/**
 * C2: Vultr instances, halt, snapshot, destroy.
 *
 * Without --apply: reads the smallest Regular (vc2) plan, its price, the
 * Ubuntu 24.04 image and existing owner:dana instances. Changes nothing.
 * With --apply: creates a tagged instance, waits for it, halts it, snapshots
 * it, destroys the instance and deletes the snapshot. Anything created is
 * destroyed in a finally block, even when a step fails.
 */
import {
	arrayIn,
	bearer,
	fmtMs,
	isMain,
	parseFlags,
	req,
	runCheck,
	stamp,
	vultrAll,
	vultrApiUrl,
	waitFor,
	type Ctx,
	type Outcome,
	type Res,
	type RunFlags,
} from './lib.js';

const NAME = 'c2-vultr-instances';

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C2 Vultr instances: create, plan price, halt, snapshot, destroy',
			required: ['VULTR_API_KEY'],
			body: c2,
		},
		flags,
	);
}

async function c2(x: Ctx): Promise<void> {
	const c = x.c;
	const api = vultrApiUrl();
	const token = x.need('VULTR_API_KEY');
	const v = (method: string, path: string, body?: unknown) =>
		req(method, `${api}${path}`, { headers: bearer(token), body });

	c.title('Plan, price, image and existing instances (read-only)');
	const plans = await v('GET', '/plans?type=all&per_page=500');
	c.assert(plans.status === 200, 'GET /plans?type=all', plans);
	const regular = arrayIn(plans.json, 'plans')
		.filter((p) => p.type === 'vc2')
		.sort((a, b) => Number(a.monthly_cost) - Number(b.monthly_cost));
	const plan = regular[0];
	if (!c.assert(!!plan, 'smallest Regular (vc2) plan found')) return;

	const monthly = Number(plan.monthly_cost);
	const hourlyApi = typeof plan.hourly_cost === 'number' ? plan.hourly_cost : undefined;
	const hourly = hourlyApi ?? monthly / 730;
	c.info(
		`plan ${plan.id}: ${plan.vcpu_count} vCPU, ${plan.ram} MB RAM, ${plan.disk} GB disk, $${monthly}/month, $${hourly.toFixed(4)}/hour (${hourlyApi === undefined ? 'estimate monthly/730: hourly_cost is not in the API' : 'from the API'})`,
	);
	const region: string | undefined = plan.locations?.includes('ewr') ? 'ewr' : plan.locations?.[0];
	c.assert(!!region, `plan offered in a region: ${region ?? 'none'}`);

	const osRes = await v('GET', '/os');
	c.assert(osRes.status === 200, 'GET /os', osRes);
	const os = arrayIn(osRes.json, 'os').find((o) => /Ubuntu 24\.04/.test(String(o.name)) && o.arch === 'x64');
	c.assert(!!os, `Ubuntu 24.04 x64 image found (os_id ${os?.id ?? 'none'})`);

	const existing = await vultrAll(api, token, '/instances', 'instances');
	c.assert(
		existing.first?.status === 200,
		`GET /instances: ${existing.items.length} instance(s) on the account`,
		existing.first,
	);
	const leftovers = existing.items.filter((i) => (i.tags ?? []).includes('owner:dana'));
	if (leftovers.length > 0) {
		c.info(`existing owner:dana instances, left untouched: ${leftovers.map((i) => i.id).join(', ')}`);
	}

	c.title('Plan');
	c.info(
		`would create ${plan.id} in ${region} tagged owner:dana, measure create->active, halt, snapshot, destroy the instance and delete the snapshot`,
	);
	if (!x.apply) {
		c.info('dry run: nothing created. Rerun with --apply (billed resources; everything created is removed in a finally block).');
		return;
	}
	if (!os || !region) return;

	const label = `last-day-c2-${stamp()}`;
	const state: { last?: Res } = {};
	const timings: string[] = [];
	let instanceId: string | undefined;
	let snapshotId: string | undefined;
	let instanceGone = false;
	let snapshotGone = false;

	try {
		// Create and wait until active and running.
		const cr = await v('POST', '/instances', {
			region,
			plan: plan.id,
			os_id: os.id,
			label,
			hostname: label,
			tags: ['owner:dana'],
		});
		c.assert(cr.status === 201 || cr.status === 202, 'POST /instances: create owner:dana instance', cr);
		instanceId = cr.json?.instance?.id;
		if (!c.assert(!!instanceId, 'instance id returned')) return;

		const tCreate = Date.now();
		const active = await waitFor(
			async () => {
				state.last = await v('GET', `/instances/${instanceId}`);
				const i = state.last.json?.instance;
				return i?.status === 'active' && i?.power_status === 'running' && i?.server_status === 'ok';
			},
			15 * 60_000,
			15_000,
		);
		timings.push(`create->active ${fmtMs(Date.now() - tCreate)}`);
		c.assert(active, 'instance active, running, server_status ok', state.last);
		if (!active) return;

		// The list must show the label, hostname and tag.
		const list = await vultrAll(api, token, '/instances', 'instances');
		const row = list.items.find((i) => i.id === instanceId);
		c.assert(
			!!row && row.label === label && row.hostname === label && (row.tags ?? []).includes('owner:dana'),
			'GET /instances: label, hostname and owner:dana tag returned',
			list.first,
			`tags=${JSON.stringify(row?.tags)}`,
		);

		// Halt, then confirm stopped.
		const tHalt = Date.now();
		const halt = await v('POST', `/instances/${instanceId}/halt`);
		c.assert(halt.status === 200 || halt.status === 204, 'POST /instances/{id}/halt', halt);
		const stopped = await waitFor(
			async () => {
				state.last = await v('GET', `/instances/${instanceId}`);
				return state.last.json?.instance?.power_status === 'stopped';
			},
			5 * 60_000,
			10_000,
		);
		timings.push(`halt->stopped ${fmtMs(Date.now() - tHalt)}`);
		c.assert(stopped, 'instance power_status = stopped', state.last);
		c.info('halted instances keep billing until destroyed: confirm on the console billing view');

		// Snapshot, then poll until complete and record size and storage cost.
		const tSnap = Date.now();
		const snap = await v('POST', '/snapshots', { instance_id: instanceId, description: `last-day c2 ${label}` });
		c.assert(snap.status === 201 || snap.status === 202, 'POST /snapshots', snap);
		snapshotId = snap.json?.snapshot?.id;
		if (!c.assert(!!snapshotId, 'snapshot id returned')) return;
		const complete = await waitFor(
			async () => {
				state.last = await v('GET', `/snapshots/${snapshotId}`);
				return state.last.json?.snapshot?.status === 'complete';
			},
			20 * 60_000,
			15_000,
		);
		timings.push(`snapshot complete ${fmtMs(Date.now() - tSnap)}`);
		c.assert(complete, 'snapshot status complete', state.last);
		const s = state.last?.json?.snapshot ?? {};
		if (complete) {
			const storage = (Number(s.compressed_size) / 1e9) * 0.05;
			c.info(
				`snapshot size ${s.size} B, compressed ${s.compressed_size} B; storage estimate $${storage.toFixed(4)}/month at $0.05/GB-month (MEDIUM: confirm on the billing page)`,
			);
		}

		// Destroy the instance, then confirm it is gone.
		const tDel = Date.now();
		const del = await v('DELETE', `/instances/${instanceId}`);
		c.assert(del.status === 200 || del.status === 202 || del.status === 204, 'DELETE /instances/{id}', del);
		instanceGone = await waitFor(async () => (await v('GET', `/instances/${instanceId}`)).status === 404, 5 * 60_000, 10_000);
		timings.push(`destroy->404 ${fmtMs(Date.now() - tDel)}`);
		c.assert(instanceGone, 'GET /instances/{id}: 404 after destroy');

		// The snapshot keeps billing after the instance is gone, so delete it too.
		const dsnap = await v('DELETE', `/snapshots/${snapshotId}`);
		c.assert(
			dsnap.status === 200 || dsnap.status === 202 || dsnap.status === 204,
			'DELETE /snapshots/{id} (route not in API_REFERENCE: standard Vultr route, verify)',
			dsnap,
		);
		snapshotGone = await waitFor(async () => {
			const r = await v('GET', `/snapshots/${snapshotId}`);
			return r.status === 404 || r.json?.snapshot?.status === 'deleted';
		}, 5 * 60_000, 10_000);
		c.assert(snapshotGone, 'snapshot gone after delete');
	} finally {
		// Destroy anything still standing, whatever happened above.
		if (instanceId && !instanceGone) {
			const d = await v('DELETE', `/instances/${instanceId}`);
			c.assert(d.status === 200 || d.status === 202 || d.status === 204 || d.status === 404, 'cleanup: destroy instance', d);
			instanceGone = await waitFor(async () => (await v('GET', `/instances/${instanceId}`)).status === 404, 5 * 60_000, 10_000);
			c.assert(instanceGone, `cleanup: instance ${instanceId} gone`);
		}
		if (snapshotId && !snapshotGone) {
			const d = await v('DELETE', `/snapshots/${snapshotId}`);
			c.assert(d.status === 200 || d.status === 202 || d.status === 204 || d.status === 404, 'cleanup: delete snapshot', d);
		}
		c.info(`timings: ${timings.join(', ') || 'no step completed'}`);
	}
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
