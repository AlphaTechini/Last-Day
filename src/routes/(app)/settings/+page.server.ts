import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit } from '#lib/server/audit.ts';
import { saveSettings } from '#lib/server/settings.ts';
import { deny, requireUser, safely } from '#lib/server/queries/actions.ts';
import { getSettingsData, settingsSchema } from '#lib/server/queries/settings.ts';

export const load: PageServerLoad = async ({ locals }) => {
	return getSettingsData(locals.user);
};

export const actions: Actions = {
	save: async (event) => {
		const user = requireUser(event);
		const denied = deny(user, 'settings.save');
		if (denied) return denied;
		const fd = await event.request.formData();
		const parsed = settingsSchema.safeParse({
			recheckDelaySeconds: fd.get('recheckDelaySeconds'),
			aiConfidenceThreshold: fd.get('aiConfidenceThreshold'),
			defaultModel: fd.get('defaultModel'),
			escalationModel: fd.get('escalationModel')
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return fail(400, { error: issue.message, field: String(issue.path[0] ?? '') });
		}
		return safely(async () => {
			await saveSettings(parsed.data);
			await audit({ actorId: user.id, actorName: user.name, kind: 'settings', summary: `${user.name} updated settings`, detail: parsed.data });
			return { ok: true as const, message: 'Settings saved.' };
		});
	}
};
