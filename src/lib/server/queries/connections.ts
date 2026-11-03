import { sql } from '#lib/server/db/index.ts';
import { decryptJson } from '#lib/server/crypto.ts';
import { SYSTEM_DEFS } from '#lib/server/connection-fields.ts';
import type { ConnectionCard, ConnectionStatus, SessionUser, SystemId } from '#lib/types.ts';
import { can } from '#lib/server/permissions.ts';
import { iso, num0 } from './mappers.ts';

/** All four systems, always present. Never returns secrets. */
export async function listConnectionCards(user: SessionUser | null): Promise<ConnectionCard[]> {
	const rows = await sql`
		SELECT c.id, c.system, c.config_json, c.credential_ciphertext IS NOT NULL AS has_secret, c.status, c.last_error, c.last_tested_at,
		       (SELECT count(*)::int FROM accounts a WHERE a.connection_id = c.id AND a.gone_at IS NULL) AS account_count
		FROM connections c`;
	const bySystem = new Map(rows.map((r) => [r.system as SystemId, r]));
	const canEdit = can(user, 'connections.save');
	return SYSTEM_DEFS.map((def) => {
		const r = bySystem.get(def.id);
		const cfg = (r?.config_json ?? {}) as Record<string, unknown>;
		const config: Record<string, string> = {};
		for (const f of def.configFields) config[f.key] = typeof cfg[f.key] === 'string' ? (cfg[f.key] as string) : '';
		return {
			id: r?.id ?? null,
			system: def.id,
			name: def.name,
			description: def.description,
			status: (r ? r.status : 'not_configured') as ConnectionStatus,
			lastTestedAt: iso(r?.last_tested_at),
			lastError: r?.last_error ?? null,
			accountCount: num0(r?.account_count),
			config,
			configFields: def.configFields,
			secretFields: def.secretFields,
			hasSecret: !!r?.has_secret,
			canEdit
		};
	});
}

/** Existing decrypted secrets (server-side only, used to merge on save). Returns {} when absent or undecryptable. */
export async function getStoredSecrets(system: SystemId): Promise<Record<string, string>> {
	const [r] = await sql`SELECT credential_ciphertext FROM connections WHERE system = ${system}`;
	if (!r?.credential_ciphertext) return {};
	try {
		return decryptJson<Record<string, string>>(r.credential_ciphertext);
	} catch {
		return {};
	}
}
