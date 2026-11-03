// Prop types for page components, mirroring docs/ROUTES_CONTRACT.md exactly.
// (Shapes not already named in #lib/types.ts are spelled out here.)

import type {
	AccountView,
	AuditEntry,
	ConnectionCard,
	DashboardData,
	EmployeeDetail,
	EmployeeListItem,
	RunDetail,
	RunSummary,
	SessionUser,
	SettingsData,
	UnknownAccount
} from '#lib/types.ts';

/** Every action returns fail(400, { error, field? }) or { ok: true, message? }. */
export type FormResult = { error?: string; field?: string; ok?: boolean; message?: string } | null | undefined;

export interface NavCounts {
	unknownCount: number;
	needsAttentionCount: number;
	pendingDestroyCount: number;
}

export interface AppLayoutData {
	user: SessionUser;
	nav: NavCounts;
	isDemo: boolean;
}

export interface LoginPageData {
	demoHint: { email: string; password: string } | null;
}

export type DashboardPageData = DashboardData;

export interface EmployeesPageData {
	employees: EmployeeListItem[];
	departments: string[];
	managers: { id: string; name: string }[];
	canEdit: boolean;
}

export interface EmployeeProfilePageData {
	employee: EmployeeDetail;
	accounts: AccountView[];
	runs: RunSummary[];
	canOffboard: boolean;
}

export interface RunsPageData {
	runs: RunSummary[];
}

export interface RunDetailPageData {
	run: RunDetail;
}

export interface UnknownPageData {
	accounts: UnknownAccount[];
	employees: { id: string; name: string; workEmail: string }[];
}

export interface ConnectionsPageData {
	connections: ConnectionCard[];
}

export interface AuditPageData {
	entries: AuditEntry[];
	total: number;
	page: number;
	pageSize: number;
	filters: { employee?: string; runId?: string; system?: string; actor?: string; kind?: string };
	employees: { id: string; name: string }[];
}

export type SettingsPageData = SettingsData;

export interface PageProps<D> {
	data: D;
	form?: FormResult;
}
