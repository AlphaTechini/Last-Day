// One mapping from every status enum in the contract to a label + tone.
// StatusPill and Badge render these; pages never invent their own status copy.

import type {
	AccountKind,
	ConnectionStatus,
	EmployeeStatus,
	LinkMethod,
	RecheckStatus,
	RunItemStatus,
	RunStatus
} from '#lib/types.ts';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'ai';

export interface StatusMeta {
	label: string;
	tone: Tone;
	/** Animated dot: something is actively happening. */
	live?: boolean;
	/** Longer, plain-language explanation for tooltips and screen readers. */
	hint?: string;
}

export const RUN_STATUS: Record<RunStatus, StatusMeta> = {
	review: { label: 'In review', tone: 'warning', hint: 'Waiting for a person to review matches and approve.' },
	executing: { label: 'Revoking', tone: 'accent', live: true, hint: 'Approved actions are running now.' },
	verified: { label: 'Verified', tone: 'success', hint: 'Every system confirmed the revocation.' },
	partial: { label: 'Partly verified', tone: 'warning', hint: 'Some actions are confirmed, others need attention.' },
	failed: { label: 'Failed', tone: 'danger', hint: 'Actions failed and need a retry.' },
	regressed: { label: 'Regressed', tone: 'danger', hint: 'The re-check found access that came back.' }
};

export const RUN_ITEM_STATUS: Record<RunItemStatus, StatusMeta> = {
	proposed: { label: 'Needs decision', tone: 'ai', hint: 'A probable match. Confirm or reject it.' },
	rejected: { label: 'Not a match', tone: 'neutral', hint: 'Rejected. Nothing will happen to this account.' },
	pending: { label: 'Ready', tone: 'neutral', hint: 'Confirmed. Runs when you approve.' },
	approved: { label: 'Queued', tone: 'accent', hint: 'Approved and waiting its turn.' },
	running: { label: 'Revoking', tone: 'accent', live: true, hint: 'Running now.' },
	verified: { label: 'Verified', tone: 'success', hint: 'The system itself confirmed it.' },
	failed: { label: 'Failed', tone: 'danger', hint: 'The action failed. You can retry it.' },
	awaiting_manager: {
		label: 'Awaiting manager',
		tone: 'warning',
		hint: 'Halted and snapshotted. The manager decides whether to destroy it.'
	},
	destroying: { label: 'Destroying', tone: 'accent', live: true, hint: 'Destroying the server now.' },
	removed: { label: 'Removed', tone: 'success', hint: 'Destroyed and confirmed gone.' }
};

export const CONNECTION_STATUS: Record<ConnectionStatus, StatusMeta> = {
	not_configured: { label: 'Not connected', tone: 'neutral', hint: 'No credentials saved yet.' },
	healthy: { label: 'Healthy', tone: 'success', hint: 'The last read call succeeded.' },
	error: { label: 'Error', tone: 'danger', hint: 'The last test failed.' },
	untested: { label: 'Not tested', tone: 'warning', hint: 'Saved but not tested yet.' }
};

export const RECHECK_STATUS: Record<RecheckStatus, StatusMeta> = {
	pending: { label: 'Re-check scheduled', tone: 'neutral', hint: 'One re-check will run at the scheduled time.' },
	running: { label: 'Re-checking', tone: 'accent', live: true, hint: 'Re-reading every revoked account now.' },
	clean: { label: 'Still clean', tone: 'success', hint: 'Nothing came back.' },
	regressed: { label: 'Regressed', tone: 'danger', hint: 'Something came back after revocation.' }
};

export const EMPLOYEE_STATUS: Record<EmployeeStatus, StatusMeta> = {
	active: { label: 'Active', tone: 'success' },
	offboarding: { label: 'Offboarding', tone: 'warning' },
	offboarded: { label: 'Offboarded', tone: 'neutral' }
};

export type AnyStatusKind = 'run' | 'item' | 'connection' | 'recheck' | 'employee';

export function statusMeta(kind: AnyStatusKind, value: string): StatusMeta {
	const table: Record<AnyStatusKind, Record<string, StatusMeta>> = {
		run: RUN_STATUS,
		item: RUN_ITEM_STATUS,
		connection: CONNECTION_STATUS,
		recheck: RECHECK_STATUS,
		employee: EMPLOYEE_STATUS
	};
	return table[kind][value] ?? { label: value, tone: 'neutral' };
}

export const LINK_METHOD: Record<LinkMethod, { label: string; short: string; ai: boolean }> = {
	'rule:work_email': { label: 'Matched by work email', short: 'Work email', ai: false },
	'rule:sso_subject': { label: 'Matched by SSO subject ID', short: 'SSO subject', ai: false },
	'rule:username': { label: 'Matched by username', short: 'Username', ai: false },
	'rule:manual': { label: 'Matched by saved link', short: 'Saved link', ai: false },
	manual: { label: 'Linked by a person', short: 'Manual link', ai: false },
	ai: { label: 'AI match', short: 'AI match', ai: true }
};

export const ACCOUNT_KIND: Record<AccountKind, string> = {
	user: 'User',
	service: 'Service user',
	invitation: 'Pending invitation',
	apikey: 'API key',
	instance: 'Server'
};

export const AUDIT_KIND: Record<string, { label: string; tone: Tone }> = {
	sweep: { label: 'Sweep', tone: 'neutral' },
	match: { label: 'Match', tone: 'ai' },
	approval: { label: 'Approval', tone: 'warning' },
	api_call: { label: 'API call', tone: 'accent' },
	verify: { label: 'Verify', tone: 'success' },
	recheck: { label: 'Re-check', tone: 'success' },
	ai_call: { label: 'AI call', tone: 'ai' },
	auth: { label: 'Sign in', tone: 'neutral' },
	connection: { label: 'Connection', tone: 'neutral' },
	demo_reset: { label: 'Demo reset', tone: 'neutral' }
};

export function auditKind(kind: string) {
	return AUDIT_KIND[kind] ?? { label: kind.replace(/_/g, ' '), tone: 'neutral' as Tone };
}

/** Confidence band for AI matches. */
export function confidenceBand(c: number): { label: string; level: 'high' | 'medium' | 'low' } {
	if (c >= 0.85) return { label: 'High confidence', level: 'high' };
	if (c >= 0.6) return { label: 'Medium confidence', level: 'medium' };
	return { label: 'Low confidence', level: 'low' };
}
