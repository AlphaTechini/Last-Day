// Connector contract. One module per system implements `Connector`.
// The engine (sweep, executor, verifier, recheck) only talks to systems through this interface.
import type { AccountKind, SystemId } from '#lib/types.ts';

export interface NormalizedAccount {
	system: SystemId;
	externalId: string; // stable id in the target system (keycloak user id, mattermost user id, github login or invitation id, vultr user id / key id / instance id)
	kind: AccountKind;
	username: string | null;
	displayName: string | null;
	emails: string[]; // lowercased
	active: boolean; // enabled / member / not deactivated / instance running
	createdAt: string | null; // ISO
	lastActiveAt: string | null; // ISO
	parentExternalId?: string | null; // e.g. vultr api key -> owning vultr user id; github repo invitation -> repo full name
	raw: Record<string, unknown>; // for kind 'instance' MUST include: plan, monthly_cost (number), region, power_status, label, tags
}

/** Every action the executor can perform. Ordered per system in ACTION_PLAN below. */
export type ActionKind =
	| 'keycloak.disable'
	| 'keycloak.logout'
	| 'mattermost.revoke_sessions'
	| 'mattermost.deactivate'
	| 'github.remove_member'
	| 'github.cancel_invitation'
	| 'github.remove_outside_collaborator'
	| 'github.cancel_repo_invitation'
	| 'vultr.suspend_user'
	| 'vultr.delete_api_key'
	| 'vultr.halt_instance'
	| 'vultr.snapshot_instance'
	| 'vultr.destroy_instance'; // only after manager approval

export interface ApiCallRecord {
	method: string;
	endpoint: string; // path with ids filled in, no secrets, no query tokens
	status: number;
	ms: number;
}

export interface ActionResult {
	ok: boolean;
	calls: ApiCallRecord[]; // every HTTP call made (the engine writes each to the audit log)
	error?: string;
	output?: Record<string, unknown>; // e.g. { snapshotId, snapshotSizeGb }
	retryable?: boolean; // network/5xx/429 = true, 4xx validation = false
}

export interface VerifyResult {
	confirmed: boolean; // the system itself confirms the revoked state
	observed: string; // human readable read-back, e.g. "enabled: false, sessions: 0"
	calls: ApiCallRecord[];
	pending?: boolean; // e.g. snapshot still being created; verifier should poll again
	/** Optional structured read-back (additive): e.g. { snapshotId, compressedSizeBytes, snapshotSizeGb, snapshotMonthlyCostUsd } for vultr.snapshot_instance. */
	output?: Record<string, unknown>;
}

export interface HealthResult {
	ok: boolean;
	message: string; // "Connected to realm company: 31 users" / error text
	calls: ApiCallRecord[];
}

export interface Connector {
	system: SystemId;
	test(): Promise<HealthResult>;
	listAccounts(): Promise<NormalizedAccount[]>;
	/** Re-read just one account (used by sweep-for-one-employee and recheck). null = gone. */
	getAccount(account: Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId'>): Promise<NormalizedAccount | null>;
	revoke(account: Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId' | 'username' | 'raw'>, action: ActionKind, ctx?: { snapshotId?: string | null }): Promise<ActionResult>;
	verify(account: Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId' | 'username' | 'raw'>, action: ActionKind, ctx?: { snapshotId?: string | null }): Promise<VerifyResult>;
	/**
	 * Ordered revoke actions for this account (excluding vultr.destroy_instance, which needs manager approval).
	 * keycloak user: [disable, logout]; mattermost user/bot: [revoke_sessions, deactivate];
	 * github member: [remove_member]; outside collaborator: [remove_outside_collaborator];
	 * org invitation: [cancel_invitation]; repo invitation (parentExternalId = 'owner/repo'): [cancel_repo_invitation];
	 * vultr user/service user: [suspend_user]; api key (parentExternalId = vultr user id): [delete_api_key];
	 * vultr instance: [halt_instance, snapshot_instance].
	 */
	actionsFor(account: Pick<NormalizedAccount, 'kind' | 'parentExternalId' | 'raw'>): ActionKind[];
}

/** Connection config as stored: non-secret config_json merged with decrypted credential JSON. */
export type ConnectionConfig = Record<string, string>;

export const ACTION_LABELS: Record<ActionKind, string> = {
	'keycloak.disable': 'Disable user',
	'keycloak.logout': 'End all sessions',
	'mattermost.revoke_sessions': 'Revoke all sessions',
	'mattermost.deactivate': 'Deactivate user',
	'github.remove_member': 'Remove from organization',
	'github.cancel_invitation': 'Cancel pending invitation',
	'github.remove_outside_collaborator': 'Remove outside collaborator',
	'github.cancel_repo_invitation': 'Cancel repository invitation',
	'vultr.suspend_user': 'Suspend organization user',
	'vultr.delete_api_key': 'Delete API key',
	'vultr.halt_instance': 'Halt server',
	'vultr.snapshot_instance': 'Take snapshot',
	'vultr.destroy_instance': 'Destroy server'
};
