import { HttpClient } from '#lib/server/connectors/http.ts';
import type { ConnectionConfig } from '#lib/server/connectors/types.ts';
import { DEMO_MARKER, PEOPLE, keycloakIdentity } from '../company.ts';
import { Api, DEMO_PASSWORD, type SeedCtx } from './common.ts';

/** Make Keycloak match the demo spec: create missing users, re-enable disabled ones. Touches only spec usernames. */
export async function seedKeycloak(config: ConnectionConfig, ctx: SeedCtx): Promise<void> {
	const baseUrl = config.baseUrl.replace(/\/+$/, '');
	const realm = encodeURIComponent(config.realm);
	const http = new HttpClient(baseUrl);
	const api = new Api(http, 'Keycloak');

	const t = await http.request(api.calls, { method: 'POST', path: `/realms/${realm}/protocol/openid-connect/token`, form: { grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret } });
	if (!t.ok || !t.data?.access_token) throw new Error(`Keycloak: token request failed (${t.error})`);
	const auth = { authorization: `Bearer ${t.data.access_token}` };
	const admin = (method: string, path: string, o: { query?: Record<string, string | number | boolean>; json?: unknown; ok?: number[] } = {}) => api.call(method, `/admin/realms/${realm}${path}`, { ...o, headers: auth });

	const existing = new Map<string, Record<string, any>>();
	for (let first = 0; ; first += 100) {
		const r = await admin('GET', '/users', { query: { first, max: 100 } });
		const page = (r.data ?? []) as Record<string, any>[];
		for (const u of page) existing.set(String(u.username).toLowerCase(), u);
		if (page.length < 100) break;
	}

	let created = 0;
	let enabled = 0;
	for (const p of PEOPLE) {
		if (p.keycloak === false) continue;
		const id = keycloakIdentity(p, ctx.domain);
		const cur = existing.get(id.username);
		if (!cur) {
			await admin('POST', '/users', {
				json: { ...id, attributes: { ...id.attributes, [DEMO_MARKER]: ['1'], ...(p.aliases.length ? { personalEmail: p.aliases } : {}) }, enabled: true, emailVerified: true, credentials: [{ type: 'password', value: DEMO_PASSWORD(ctx.env), temporary: false }] }
			});
			created++;
		} else if (cur.enabled === false) {
			await admin('PUT', `/users/${cur.id}`, { json: { enabled: true } });
			enabled++;
		}
	}
	ctx.log(`keycloak: ${PEOPLE.length} demo users (${created} created, ${enabled} re-enabled)`);
}
