import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sql } from '#lib/server/db/index.ts';
import { encryptJson } from '#lib/server/crypto.ts';
import { audit } from '#lib/server/audit.ts';
import { getSystemDef, isSystemId } from '#lib/server/connection-fields.ts';
import { testConnection } from '#lib/server/engine/index.ts';
import { deny, formString, requireUser, safely } from '#lib/server/queries/actions.ts';
import { toActor } from '#lib/server/permissions.ts';
import { getStoredSecrets, listConnectionCards } from '#lib/server/queries/connections.ts';

export const load: PageServerLoad = async ({ locals }) => {
	return { connections: await listConnectionCards(locals.user) };
};

const URL_KEYS = new Set(['baseUrl', 'apiUrl']);

export const actions: Actions = {
	save: async (event) => {
		const user = requireUser(event);
		const denied = deny(user, 'connections.save');
		if (denied) return denied;
		const fd = await event.request.formData();
		const system = formString(fd, 'system');
		if (!isSystemId(system)) return fail(400, { error: 'Unknown system.', field: 'system' });
		const def = getSystemDef(system);

		const config: Record<string, string> = {};
		for (const f of def.configFields) {
			let v = formString(fd, f.key);
			if (URL_KEYS.has(f.key) && v) {
				try {
					const u = new URL(v);
					if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
					v = v.replace(/\/+$/, '');
				} catch {
					return fail(400, { error: `${f.label} must be a valid http(s) URL.`, field: f.key });
				}
			}
			config[f.key] = v;
		}

		return safely(async () => {
			const existing = await getStoredSecrets(system);
			const merged: Record<string, string> = { ...existing };
			const changedSecrets: string[] = [];
			for (const f of def.secretFields) {
				const v = formString(fd, f.key); // empty = keep existing
				if (v) {
					merged[f.key] = v;
					changedSecrets.push(f.key);
				}
			}
			const hasAny = Object.keys(merged).length > 0;
			await sql`
				INSERT INTO connections (system, config_json, credential_ciphertext, status)
				VALUES (${system}, ${sql.json(config)}, ${hasAny ? encryptJson(merged) : null}, 'untested')
				ON CONFLICT (system) DO UPDATE SET config_json = EXCLUDED.config_json,
					credential_ciphertext = EXCLUDED.credential_ciphertext, status = 'untested', last_error = NULL`;
			await audit({
				actorId: user.id,
				actorName: user.name,
				system,
				kind: 'connection',
				summary: `${user.name} saved the ${def.name} connection`,
				detail: { config, secretsUpdated: changedSecrets } // secret values are never logged
			});
			return { ok: true as const, message: `${def.name} connection saved. Test it to confirm.` };
		});
	},

	test: async (event) => {
		const user = requireUser(event);
		const denied = deny(user, 'connections.test');
		if (denied) return denied;
		const fd = await event.request.formData();
		const system = formString(fd, 'system');
		if (!isSystemId(system)) return fail(400, { error: 'Unknown system.', field: 'system' });
		return safely(async () => {
			const r = await testConnection(system, toActor(user));
			if (!r.ok) return fail(400, { error: r.message || 'Connection test failed.' });
			return { ok: true as const, message: r.message };
		});
	}
};
