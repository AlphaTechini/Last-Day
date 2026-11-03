import { z } from 'zod';
import { getSettings } from '#lib/server/settings.ts';
import { AVAILABLE_MODELS, isKnownModel } from '#lib/server/models.ts';
import { can } from '#lib/server/permissions.ts';
import type { SessionUser, SettingsData } from '#lib/types.ts';

export async function getSettingsData(user: SessionUser | null): Promise<SettingsData> {
	const s = await getSettings();
	return {
		recheckDelaySeconds: s.recheckDelaySeconds,
		aiConfidenceThreshold: s.aiConfidenceThreshold,
		defaultModel: s.defaultModel,
		escalationModel: s.escalationModel,
		availableModels: AVAILABLE_MODELS.map((m) => ({ id: m.id, inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M })),
		canEdit: can(user, 'settings.save')
	};
}

/** Validation for the Settings form. */
export const settingsSchema = z.object({
	recheckDelaySeconds: z.coerce.number('Re-check delay must be a number').int('Re-check delay must be whole seconds').min(10, 'Re-check delay must be at least 10 seconds').max(30 * 86400, 'Re-check delay must be 30 days or less'),
	aiConfidenceThreshold: z.coerce.number('Confidence threshold must be a number').min(0, 'Threshold must be between 0 and 1').max(1, 'Threshold must be between 0 and 1'),
	defaultModel: z.string().refine(isKnownModel, 'Choose a model from the list'),
	escalationModel: z.string().refine(isKnownModel, 'Choose a model from the list')
});
