import { HttpClient } from '#lib/server/connectors/http.ts';
import type { ConnectionConfig } from '#lib/server/connectors/types.ts';
import { CONTRACTOR, OPS_BOT, PEOPLE, chatIdentity } from '../company.ts';
import { Api, DEMO_PASSWORD, type SeedCtx } from './common.ts';

/** Make Mattermost match the demo spec: create missing users and bots, reactivate deactivated ones. Touches only spec usernames. */
export async function seedMattermost(config: ConnectionConfig, ctx: SeedCtx): Promise<void> {
	const http = new HttpClient(`${config.baseUrl.replace(/\/+$/, '')}/api/v4`, { authorization: `Bearer ${config.token}` });
	const api = new Api(http, 'Mattermost');

	const existing = new Map<string, Record<string, any>>();
	for (const filter of ['active', 'inactive']) {
		for (let page = 0; ; page++) {
			const r = await api.call('GET', '/users', { query: { page, per_page: 200, [filter]: true } });
			const rows = (r.data ?? []) as Record<string, any>[];
			for (const u of rows) existing.set(String(u.username).toLowerCase(), u);
			if (rows.length < 200) break;
		}
	}

	let created = 0;
	let reactivated = 0;
	const ensure = async (u: { username: string; email: string; firstName?: string; lastName?: string; nickname?: string; position?: string }) => {
		const cur = existing.get(u.username.toLowerCase());
		if (!cur) {
			const r = await api.call('POST', '/users', {
				json: { username: u.username, email: u.email, password: DEMO_PASSWORD(ctx.env), first_name: u.firstName ?? '', last_name: u.lastName ?? '', nickname: u.nickname ?? '', position: u.position ?? '' }
			});
			existing.set(u.username.toLowerCase(), r.data);
			created++;
		} else if (Number(cur.delete_at) > 0) {
			await api.call('PUT', `/users/${cur.id}/active`, { json: { active: true } });
			cur.delete_at = 0;
			reactivated++;
		}
	};

	for (const p of PEOPLE) {
		if (p.mattermost === false) continue;
		const c = chatIdentity(p, ctx.domain);
		await ensure({ username: c.username, email: c.email, firstName: c.firstName, lastName: c.lastName, nickname: c.nickname, position: c.position });
	}
	await ensure({ username: CONTRACTOR.username, email: CONTRACTOR.email, firstName: CONTRACTOR.firstName, lastName: CONTRACTOR.lastName, nickname: CONTRACTOR.nickname, position: CONTRACTOR.position });

	// The shared bot account.
	const bot = existing.get(OPS_BOT.username);
	if (!bot) {
		const r = await api.call('POST', '/bots', { json: { username: OPS_BOT.username, display_name: OPS_BOT.displayName, description: OPS_BOT.description }, ok: [400, 401, 403, 501] });
		if (r.ok) created++;
		else ctx.log(`mattermost: could not create the ${OPS_BOT.username} bot (${r.error}); enable ServiceSettings.EnableBotAccountCreation`);
	} else if (Number(bot.delete_at) > 0) {
		await api.call('POST', `/bots/${bot.id}/enable`);
		reactivated++;
	}
	ctx.log(`mattermost: demo users ready (${created} created, ${reactivated} reactivated)`);
}
