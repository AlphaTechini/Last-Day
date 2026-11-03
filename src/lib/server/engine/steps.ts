import { ACTION_LABELS, type ActionKind, type Connector } from '#lib/server/connectors/types.ts';
import type { ActionStep } from '#lib/types.ts';

/** Method + path templates shown on the review screen before anything runs (docs/API_REFERENCE.md). */
export const ENDPOINT_TEMPLATES: Record<ActionKind, string> = {
	'keycloak.disable': 'PUT /admin/realms/{realm}/users/{id}',
	'keycloak.logout': 'POST /admin/realms/{realm}/users/{id}/logout',
	'mattermost.revoke_sessions': 'POST /api/v4/users/{id}/sessions/revoke/all',
	'mattermost.deactivate': 'DELETE /api/v4/users/{id}',
	'github.remove_member': 'DELETE /orgs/{org}/memberships/{username}',
	'github.cancel_invitation': 'DELETE /orgs/{org}/invitations/{id}',
	'github.remove_outside_collaborator': 'DELETE /orgs/{org}/outside_collaborators/{username}',
	'github.cancel_repo_invitation': 'DELETE /repos/{owner}/{repo}/invitations/{id}',
	'vultr.suspend_user': 'PUT /v2/organizations/{org-id}/user/{user-id}/suspend',
	'vultr.delete_api_key': 'DELETE /v2/users/{user-id}/apikeys/{apikey-id}',
	'vultr.halt_instance': 'POST /v2/instances/{id}/halt',
	'vultr.snapshot_instance': 'POST /v2/snapshots',
	'vultr.destroy_instance': 'DELETE /v2/instances/{id}'
};

export function pendingStep(action: ActionKind): ActionStep {
	return { action, label: ACTION_LABELS[action] ?? action, status: 'pending', endpoint: ENDPOINT_TEMPLATES[action] ?? null, httpStatus: null, at: null };
}

export function stepsFor(connector: Connector, account: Parameters<Connector['actionsFor']>[0]): ActionStep[] {
	return connector.actionsFor(account).map(pendingStep);
}

export function parseSteps(v: unknown): ActionStep[] {
	return Array.isArray(v) ? (v as ActionStep[]).map((s) => ({ ...s })) : [];
}
