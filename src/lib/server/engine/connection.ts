import { sql } from '#lib/server/db/index.ts';
import { audit } from '#lib/server/audit.ts';
import { isSystemId } from '#lib/server/connection-fields.ts';
import { SYSTEM_NAMES } from '#lib/types.ts';
import { getConnector } from './connectors.ts';
import type { Actor } from './index.ts';
import { errMessage } from './state.ts';

export async function testConnectionImpl(system: string, actor: Actor): Promise<{ ok: boolean; message: string }> {
	if (!isSystemId(system)) return { ok: false, message: `Unknown system "${system}"` };
	const name = SYSTEM_NAMES[system];
	let ok = false;
	let message: string;
	let calls: unknown[] = [];
	try {
		const connector = await getConnector(system);
		if (!connector) {
			message = `${name} is not configured. Save its settings and credential first.`;
		} else {
			const res = await connector.test();
			ok = res.ok;
			message = res.message;
			calls = res.calls ?? [];
		}
	} catch (e) {
		message = `Test failed: ${errMessage(e)}`;
	}
	await sql`
		UPDATE connections SET status = ${ok ? 'healthy' : 'error'}, last_error = ${ok ? null : message}, last_tested_at = now() WHERE system = ${system}`;
	const last = (calls as { method?: string; endpoint?: string; status?: number }[]).at(-1);
	await audit({
		actorId: actor.id,
		actorName: actor.name,
		system,
		kind: 'connection',
		summary: `${name} connection test ${ok ? 'passed' : 'failed'}: ${message}`,
		detail: { ok, message, calls, ...(last ? { method: last.method, endpoint: last.endpoint, status: last.status } : {}) }
	});
	return { ok, message };
}
