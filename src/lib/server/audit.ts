import { sql } from './db';
import type { SystemId } from '#lib/types.ts';

export interface AuditInput {
	actorId?: string | null;
	actorName?: string; // defaults to 'system'
	runId?: string | null;
	employeeId?: string | null;
	system?: SystemId | null;
	kind: 'sweep' | 'match' | 'approval' | 'api_call' | 'verify' | 'recheck' | 'ai_call' | 'auth' | 'connection' | 'demo_reset' | 'run' | 'settings' | 'employee';
	summary: string;
	detail?: Record<string, unknown>;
}

export async function audit(e: AuditInput): Promise<void> {
	await sql`
		INSERT INTO audit_log (actor_id, actor_name, run_id, employee_id, system, kind, summary, detail_json)
		VALUES (${e.actorId ?? null}, ${e.actorName ?? 'system'}, ${e.runId ?? null}, ${e.employeeId ?? null},
		        ${e.system ?? null}, ${e.kind}, ${e.summary}, ${sql.json((e.detail ?? {}) as never)})`;
}
