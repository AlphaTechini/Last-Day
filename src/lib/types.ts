// Shared DTOs between server (load functions / actions / API) and UI.
// This file is the contract. Server code returns exactly these shapes; UI renders them.
// Dates are ISO strings (serializable across the load boundary).

export type SystemId = 'keycloak' | 'mattermost' | 'github' | 'vultr';
export type Role = 'admin' | 'hr' | 'manager' | 'judge';

export type EmployeeStatus = 'active' | 'offboarding' | 'offboarded';
export type AccountKind = 'user' | 'service' | 'invitation' | 'apikey' | 'instance';
export type LinkMethod = 'rule:manual' | 'rule:sso_subject' | 'rule:work_email' | 'rule:username' | 'ai' | 'manual';

export type RunStatus = 'review' | 'executing' | 'verified' | 'partial' | 'failed' | 'regressed';
export type RunItemStatus =
	| 'proposed' // probable match waiting for HR yes/no
	| 'rejected' // HR said "not her"
	| 'pending' // confirmed, waiting for approval
	| 'approved' // approved, queued for executor
	| 'running'
	| 'verified' // the target system confirmed
	| 'failed'
	| 'awaiting_manager' // server halted + snapshotted, waiting for manager destroy
	| 'destroying'
	| 'removed'; // server destroyed and verified gone

export type MatchKind = 'exact' | 'probable' | 'server';
export type RecheckStatus = 'pending' | 'running' | 'clean' | 'regressed';
export type ConnectionStatus = 'not_configured' | 'healthy' | 'error' | 'untested';

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	role: Role;
	employeeId: string | null;
}

export interface EmployeeListItem {
	id: string;
	name: string;
	workEmail: string;
	role: string; // job title
	department: string;
	managerName: string | null;
	status: EmployeeStatus;
	startDate: string | null;
	accountCount: number; // linked accounts across systems
	systems: SystemId[]; // systems where they have a linked account
}

export interface EmployeeDetail extends EmployeeListItem {
	aliases: string[];
	managerId: string | null;
	endDate: string | null;
}

export interface AccountView {
	id: string;
	system: SystemId;
	kind: AccountKind;
	externalId: string;
	username: string | null;
	displayName: string | null;
	emails: string[];
	createdAt: string | null;
	lastActiveAt: string | null;
	active: boolean; // enabled / member / not deleted / running
	linkMethod: LinkMethod | null;
	confidence: number | null; // 0..1 for AI links
	evidence: string[];
	// instance-only
	plan?: string | null;
	monthlyCostUsd?: number | null;
	region?: string | null;
	powerStatus?: string | null;
}

export interface UnknownAccount extends AccountView {
	aiSuggestion: { employeeId: string; employeeName: string; confidence: number; evidence: string[] } | null;
	flag: 'unlinked' | 'service' | 'flagged';
}

export interface RunItemView {
	id: string;
	account: AccountView;
	matchKind: MatchKind;
	actions: ActionStep[]; // ordered steps the executor performs for this item
	status: RunItemStatus;
	attempts: number;
	lastError: string | null;
	verifiedState: string | null; // human readable read-back, e.g. "enabled: false, sessions: 0"
	verifiedAt: string | null;
	// servers
	snapshotId?: string | null;
	snapshotCostUsdMonth?: number | null;
	stillBillingUsdMonth?: number | null;
}

export interface ActionStep {
	action: string; // machine id, e.g. 'keycloak.disable'
	label: string; // "Disable user"
	status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
	endpoint: string | null; // "PUT /admin/realms/company/users/{id}"
	httpStatus: number | null;
	at: string | null;
	readBack?: string; // what the system reported when this step was verified
}

export interface RunSummary {
	id: string;
	employeeId: string;
	employeeName: string;
	status: RunStatus;
	startedAt: string;
	startedBy: string;
	verifiedAt: string | null;
	itemCount: number;
	verifiedCount: number; // items confirmed and still clean (a regressed run excludes the items that came back)
	regressedCount: number; // distinct items the re-check found switched back on
	aiCostUsd: number;
	recheck: { status: RecheckStatus; dueAt: string; firedAt: string | null } | null;
}

export interface RunDetail extends RunSummary {
	employee: EmployeeDetail;
	items: RunItemView[];
	regressedItemIds: string[]; // run item ids that came back, from the re-check diff
	stats: {
		foundByRules: number;
		foundByAi: number;
		servers: number;
		secondsToGreen: number | null; // from start to all verified
		aiCalls: number;
		aiTokens: number;
	};
	approvals: { id: string; approverName: string; scope: 'hr_revoke' | 'manager_destroy'; at: string; itemCount: number }[];
	recheckResult: { status: RecheckStatus; firedAt: string | null; diff: { itemId: string; label: string; observed: string }[] } | null;
	canApprove: boolean; // current user may approve HR revocation
	canDestroy: boolean; // current user is the leaver's manager (or admin)
}

export interface ConnectionCard {
	id: string | null;
	system: SystemId;
	name: string; // "Keycloak", "Mattermost", "GitHub organization", "Vultr account"
	description: string;
	status: ConnectionStatus;
	lastTestedAt: string | null;
	lastError: string | null;
	accountCount: number;
	config: Record<string, string>; // non-secret config (base URL, realm, org) shown in the form
	configFields: { key: string; label: string; placeholder: string }[];
	secretFields: { key: string; label: string; placeholder: string }[];
	hasSecret: boolean; // credentials saved (never returned)
	canEdit: boolean;
}

export interface AuditEntry {
	id: string;
	at: string;
	actor: string; // user name or 'system'
	runId: string | null;
	employeeName: string | null;
	system: SystemId | null;
	kind: string; // 'sweep' | 'match' | 'approval' | 'api_call' | 'verify' | 'recheck' | 'ai_call' | 'auth' | 'connection' | 'demo_reset'
	summary: string; // one line
	detail: {
		method?: string;
		endpoint?: string;
		status?: number;
		readBack?: string;
		model?: string;
		tokens?: number;
		costUsd?: number;
		evidence?: string[];
		[k: string]: unknown;
	};
}

export interface DashboardData {
	stats: {
		employees: number;
		activeAccounts: number;
		unknownAccounts: number;
		openRuns: number;
		needsAttention: number;
		monthlyServerSpendUsd: number; // leftover servers still billing
	};
	openRuns: RunSummary[];
	needsAttention: RunSummary[];
	pendingDestroys: { runId: string; itemId: string; employeeName: string; serverLabel: string; stillBillingUsdMonth: number; snapshotCostUsdMonth: number }[];
	recentActivity: AuditEntry[];
	connections: Pick<ConnectionCard, 'system' | 'name' | 'status' | 'accountCount' | 'lastTestedAt'>[];
	lastSweepAt: string | null;
	isDemo: boolean;
}

export interface SettingsData {
	recheckDelaySeconds: number;
	aiConfidenceThreshold: number;
	defaultModel: string;
	escalationModel: string;
	availableModels: { id: string; inputPer1M: number; outputPer1M: number }[];
	canEdit: boolean;
}

export const SYSTEM_NAMES: Record<SystemId, string> = {
	keycloak: 'Keycloak',
	mattermost: 'Mattermost',
	github: 'GitHub',
	vultr: 'Vultr'
};
