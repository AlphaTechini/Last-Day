import { HttpClient } from '#lib/server/connectors/http.ts';
import type { ConnectionConfig } from '#lib/server/connectors/types.ts';
import { DANA_VULTR, DEMO_MARKER, TERRAFORM_VULTR } from '../company.ts';
import { Api, DEMO_PASSWORD, type SeedCtx } from './common.ts';

/**
 * Make the Vultr account match the demo spec through the real API:
 * service user "dana-ci" with an API key, a second unowned service user, and Dana's small server `build-runner-02`
 * (tagged owner:dana + lastday-demo). In real mode the server is only created when DEMO_VULTR_CREATE_INSTANCE=1.
 */
export async function seedVultr(config: ConnectionConfig, ctx: SeedCtx): Promise<void> {
	let apiUrl = (config.apiUrl || 'https://api.vultr.com/v2').replace(/\/+$/, '');
	if (!/\/v2$/.test(apiUrl)) apiUrl += '/v2';
	const api = new Api(new HttpClient(apiUrl, { authorization: `Bearer ${config.apiKey}` }), 'Vultr');
	const enc = encodeURIComponent;

	const listAll = async (path: string, key: string, query: Record<string, string | number> = {}) => {
		const rows: Record<string, any>[] = [];
		let cursor = '';
		for (let i = 0; i < 100; i++) {
			const r = await api.call('GET', path, { query: { per_page: 100, ...query, ...(cursor ? { cursor } : {}) }, ok: [403, 404, 405] });
			if (!r.ok) return { rows, supported: false };
			rows.push(...((r.data?.[key] ?? []) as Record<string, any>[]));
			cursor = String(r.data?.meta?.links?.next ?? '');
			if (!cursor) break;
		}
		return { rows, supported: true };
	};

	const orgs = await listAll('/organizations', 'orgs');
	const orgId = orgs.rows[0]?.id ? String(orgs.rows[0].id) : null;
	const suspended = orgId ? (await listAll(`/organizations/${enc(orgId)}/suspended-users`, 'users')).rows : [];
	const users = (await listAll('/users', 'users')).rows;
	let created = 0;
	let restored = 0;

	const ensureServiceUser = async (name: string, emailLocal: string, keyName: string) => {
		const email = `${emailLocal}@${ctx.domain}`;
		let u = users.find((x) => String(x.email).toLowerCase() === email);
		if (!u) {
			const r = await api.call('POST', '/users', { json: { email, name, password: `${DEMO_PASSWORD(ctx.env)}-${name}`, api_enabled: true, service_user: true, acls: ['subscriptions_view', 'provisioning'] } });
			u = r.data?.user ?? r.data;
			created++;
		} else {
			if (suspended.some((s) => String(s.user_id) === String(u!.id))) {
				await api.call('PUT', `/organizations/${enc(orgId!)}/user/${enc(u.id)}/unsuspend`, { ok: [400, 403, 404] });
				restored++;
			}
			if (u.api_enabled === false) {
				await api.call('PATCH', `/users/${enc(u.id)}`, { json: { api_enabled: true } });
				restored++;
			}
		}
		// API key (endpoint shape is UNVERIFIED in the reference: tolerate failure).
		try {
			const keys = await listAll(`/users/${enc(u!.id)}/apikeys`, 'api_keys');
			if (keys.supported && !keys.rows.some((k) => k.name === keyName)) {
				await api.call('POST', `/users/${enc(u!.id)}/apikeys`, { json: { name: keyName, expire: false } });
				restored++;
			}
		} catch (e) {
			ctx.log(`vultr: could not create API key ${keyName}: ${(e as Error).message}`);
		}
	};
	await ensureServiceUser(DANA_VULTR.userName, DANA_VULTR.userEmailLocal, DANA_VULTR.keyName);
	await ensureServiceUser(TERRAFORM_VULTR.userName, TERRAFORM_VULTR.userEmailLocal, TERRAFORM_VULTR.keyName);

	// Dana's server.
	const wantInstance = ctx.isMock || ctx.env.DEMO_VULTR_CREATE_INSTANCE === '1';
	if (!wantInstance) {
		ctx.log('vultr: DEMO_VULTR_CREATE_INSTANCE is not 1, so no server is created');
	} else {
		const found = (await listAll('/instances', 'instances', { label: DANA_VULTR.instanceLabel, per_page: 500 })).rows.find((i) => i.label === DANA_VULTR.instanceLabel && (i.tags ?? []).includes(DEMO_MARKER));
		if (found) {
			if (found.power_status === 'stopped') {
				await api.call('POST', `/instances/${enc(found.id)}/start`);
				restored++;
			}
		} else {
			const plans = (await listAll('/plans', 'plans', { type: 'all', per_page: 500 })).rows.filter((p) => Array.isArray(p.locations) && p.locations.length && Number(p.monthly_cost) > 0);
			plans.sort((a, b) => Number(a.monthly_cost) - Number(b.monthly_cost));
			const plan = plans[0];
			if (!plan) throw new Error('Vultr: no plans returned, cannot choose the smallest one');
			const region = ctx.env.DEMO_VULTR_REGION || plan.locations[0];
			const os = (await listAll('/os', 'os')).rows;
			const ubuntu = os.find((o) => /ubuntu 2[0-9]\.04.*x64/i.test(String(o.name))) ?? os.find((o) => /ubuntu/i.test(String(o.name))) ?? os[0];
			if (!ubuntu) throw new Error('Vultr: no operating systems returned');
			await api.call('POST', '/instances', { json: { region, plan: plan.id, os_id: ubuntu.id, label: DANA_VULTR.instanceLabel, hostname: DANA_VULTR.instanceLabel, tags: DANA_VULTR.instanceTags, backups: 'disabled' } });
			created++;
			ctx.log(`vultr: created ${DANA_VULTR.instanceLabel} (${plan.id}, $${plan.monthly_cost}/month, ${region})`);
		}
	}

	// Snapshots left over from earlier demo runs cost money: remove the ones taken of Dana's server.
	const snaps = (await listAll('/snapshots', 'snapshots')).rows.filter((s) => String(s.description ?? '').startsWith(`Last Day offboarding: ${DANA_VULTR.instanceLabel}`));
	for (const s of snaps) await api.call('DELETE', `/snapshots/${enc(s.id)}`, { ok: [404] });

	ctx.log(`vultr: demo footprint ready (${created} created, ${restored} restored, ${snaps.length} old snapshot(s) removed)`);
}
