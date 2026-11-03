// Connector factory and loader. The engine calls loadConnector / loadAllConnectors; nothing else needs to know
// how a connection row maps to a connector.
import { sql as sharedSql, type Sql } from '#lib/server/db/index.ts';
import { decryptJson } from '#lib/server/crypto.ts';
import { getSystemDef, SYSTEM_IDS } from '#lib/server/connection-fields.ts';
import type { SystemId } from '#lib/types.ts';
import { createGithubConnector } from './github.ts';
import { createKeycloakConnector } from './keycloak.ts';
import { createMattermostConnector } from './mattermost.ts';
import { createVultrConnector } from './vultr.ts';
import type { ConnectionConfig, Connector } from './types.ts';
import type { ConnectorOptions } from './http.ts';

export { snapshotMonthlyCost } from './vultr.ts';
export type { ConnectorOptions } from './http.ts';

export function createConnector(system: SystemId, config: ConnectionConfig, options?: ConnectorOptions): Connector {
	switch (system) {
		case 'keycloak':
			return createKeycloakConnector(config, options);
		case 'mattermost':
			return createMattermostConnector(config, options);
		case 'github':
			return createGithubConnector(config, options);
		case 'vultr':
			return createVultrConnector(config, options);
	}
}

/** Fields that must be present for a connection to count as configured (github repos is optional). */
function requiredKeys(system: SystemId): string[] {
	const def = getSystemDef(system);
	return [...def.configFields, ...def.secretFields].map((f) => f.key).filter((k) => !(system === 'github' && k === 'repos'));
}

/** config_json merged with the decrypted credentials, or null when there is no (complete) connection row. */
export async function loadConnectionConfig(system: SystemId, db: Sql = sharedSql): Promise<ConnectionConfig | null> {
	const [row] = await db`SELECT config_json, credential_ciphertext FROM connections WHERE system = ${system}`;
	if (!row) return null;
	const config: ConnectionConfig = {};
	for (const [k, v] of Object.entries((row.config_json ?? {}) as Record<string, unknown>)) config[k] = v == null ? '' : String(v);
	if (row.credential_ciphertext) {
		try {
			Object.assign(config, decryptJson<Record<string, string>>(row.credential_ciphertext));
		} catch {
			return null; // wrong MASTER_KEY or corrupt ciphertext: treat as not configured
		}
	}
	if (requiredKeys(system).some((k) => !config[k]?.trim())) return null;
	return config;
}

export async function loadConnector(system: SystemId, options?: ConnectorOptions & { db?: Sql }): Promise<Connector | null> {
	const config = await loadConnectionConfig(system, options?.db);
	return config ? createConnector(system, config, options) : null;
}

/** Every configured connector, in display order. */
export async function loadAllConnectors(options?: ConnectorOptions & { db?: Sql }): Promise<Connector[]> {
	const out: Connector[] = [];
	for (const system of SYSTEM_IDS) {
		const c = await loadConnector(system, options);
		if (c) out.push(c);
	}
	return out;
}
