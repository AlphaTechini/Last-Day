import { sql } from './db';

export interface Settings {
	recheckDelaySeconds: number;
	aiConfidenceThreshold: number;
	defaultModel: string;
	escalationModel: string;
	lastSweepAt: string | null;
}

export async function getSettings(): Promise<Settings> {
	const [r] = await sql`SELECT * FROM settings WHERE id = 1`;
	return {
		recheckDelaySeconds: r.recheck_delay_seconds,
		aiConfidenceThreshold: Number(r.ai_confidence_threshold),
		defaultModel: r.default_model,
		escalationModel: r.escalation_model,
		lastSweepAt: r.last_sweep_at ? new Date(r.last_sweep_at).toISOString() : null
	};
}

export async function saveSettings(s: Omit<Settings, 'lastSweepAt'>): Promise<void> {
	await sql`UPDATE settings SET recheck_delay_seconds = ${s.recheckDelaySeconds},
		ai_confidence_threshold = ${s.aiConfidenceThreshold}, default_model = ${s.defaultModel},
		escalation_model = ${s.escalationModel} WHERE id = 1`;
}
