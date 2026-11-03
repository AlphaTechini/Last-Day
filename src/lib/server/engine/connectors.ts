// Single place the engine obtains connectors. Production code goes through #lib/server/connectors/index.ts;
// tests install a provider with fake in-memory connectors.
import type { Connector } from '#lib/server/connectors/types.ts';
import type { SystemId } from '#lib/types.ts';

export type ConnectorProvider = (system: SystemId) => Promise<Connector | null>;

let override: ConnectorProvider | null = null;

export function setConnectorProvider(p: ConnectorProvider | null): void {
	override = p;
}

export async function getConnector(system: SystemId): Promise<Connector | null> {
	if (override) return override(system);
	const mod = await import('#lib/server/connectors/index.ts');
	return mod.loadConnector(system);
}
