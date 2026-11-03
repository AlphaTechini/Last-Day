// Dev preview catalogue: every page component in every state worth designing.
// Used only by src/routes/preview (guarded by `dev`).

import type { Component } from 'svelte';
import * as fx from './fixtures.ts';
import type { AppLayoutData } from './page-data.ts';
import LoginPage from '#lib/components/pages/LoginPage.svelte';
import DashboardPage from '#lib/components/pages/DashboardPage.svelte';
import EmployeesPage from '#lib/components/pages/EmployeesPage.svelte';
import EmployeeProfilePage from '#lib/components/pages/EmployeeProfilePage.svelte';
import RunsPage from '#lib/components/pages/RunsPage.svelte';
import RunDetailPage from '#lib/components/pages/RunDetailPage.svelte';
import UnknownPage from '#lib/components/pages/UnknownPage.svelte';
import ConnectionsPage from '#lib/components/pages/ConnectionsPage.svelte';
import AuditPage from '#lib/components/pages/AuditPage.svelte';
import SettingsPage from '#lib/components/pages/SettingsPage.svelte';
import ErrorPage from '#lib/components/pages/ErrorPage.svelte';

export interface PreviewEntry {
	slug: string;
	group: string;
	title: string;
	note?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	props: Record<string, unknown>;
	/** Path the shell should treat as current (for the active nav item). */
	path?: string;
	shell?: boolean;
	layout?: AppLayoutData;
	/** Run the client-side executor simulation. */
	live?: boolean;
}

const page = (data: unknown, form: unknown = null) => ({ data, form });

export const previews: PreviewEntry[] = [
	{ slug: 'login', group: 'Sign in', title: 'Sign in with judge access', component: LoginPage, props: page(fx.login), shell: false },
	{ slug: 'login-error', group: 'Sign in', title: 'Sign in, wrong password', component: LoginPage, props: page(fx.loginPlain, { error: 'Invalid email or password.' }), shell: false },

	{ slug: 'dashboard', group: 'Dashboard', title: 'Dashboard', component: DashboardPage, props: page(fx.dashboard), path: '/' },
	{ slug: 'dashboard-empty', group: 'Dashboard', title: 'Dashboard, nothing open', component: DashboardPage, props: page(fx.dashboardEmpty), path: '/', layout: { ...fx.layoutData, nav: { unknownCount: 0, needsAttentionCount: 0, pendingDestroyCount: 0 } } },

	{ slug: 'employees', group: 'Employees', title: 'Employee directory', component: EmployeesPage, props: page(fx.employeesPage), path: '/employees' },
	{ slug: 'employee', group: 'Employees', title: 'Dana Okafor, before offboarding', component: EmployeeProfilePage, props: page(fx.employeeProfile), path: '/employees' },
	{ slug: 'employee-offboarding', group: 'Employees', title: 'Dana Okafor, offboarding', component: EmployeeProfilePage, props: page(fx.employeeProfileOffboarding), path: '/employees' },

	{ slug: 'runs', group: 'Runs', title: 'All runs', component: RunsPage, props: page(fx.runsList), path: '/runs' },
	{ slug: 'run-review', group: 'Runs', title: 'Review: two AI matches to decide', component: RunDetailPage, props: page({ run: fx.runReview }), path: '/runs' },
	{ slug: 'run-review-decided', group: 'Runs', title: 'Review: ready to approve', component: RunDetailPage, props: page({ run: fx.runReviewDecided }), path: '/runs' },
	{ slug: 'run-executing', group: 'Runs', title: 'Executing: mixed running and verified', component: RunDetailPage, props: page({ run: fx.runExecuting }), path: '/runs' },
	{ slug: 'run-live', group: 'Runs', title: 'Live: watch lines turn green', note: 'Simulated client-side', component: RunDetailPage, props: page({ run: fx.runReviewDecided }), path: '/runs', live: true },
	{ slug: 'run-verified', group: 'Runs', title: 'Verified, re-check pending (HR view)', component: RunDetailPage, props: page({ run: fx.runVerified }), path: '/runs' },
	{ slug: 'run-manager', group: 'Runs', title: 'Verified, manager can destroy', component: RunDetailPage, props: page({ run: fx.runManager }), path: '/runs', layout: { ...fx.layoutData, user: fx.users.manager } },
	{ slug: 'run-clean', group: 'Runs', title: 'Server removed, re-check clean', component: RunDetailPage, props: page({ run: fx.runClean }), path: '/runs' },
	{ slug: 'run-regressed', group: 'Runs', title: 'Regressed after re-check', component: RunDetailPage, props: page({ run: fx.runRegressed }), path: '/runs' },
	{ slug: 'run-failed', group: 'Runs', title: 'Partly verified, one failed item', component: RunDetailPage, props: page({ run: fx.runFailed }), path: '/runs' },

	{ slug: 'unknown', group: 'Admin', title: 'Unknown owners', component: UnknownPage, props: page(fx.unknownPage), path: '/unknown' },
	{ slug: 'connections', group: 'Admin', title: 'Connections (admin)', component: ConnectionsPage, props: page(fx.connectionsPage), path: '/connections', layout: { ...fx.layoutData, user: fx.users.admin } },
	{ slug: 'connections-readonly', group: 'Admin', title: 'Connections (judge, read-only)', component: ConnectionsPage, props: page(fx.connectionsReadOnly), path: '/connections', layout: { ...fx.layoutData, user: fx.users.judge } },
	{ slug: 'audit', group: 'Admin', title: 'Audit log', component: AuditPage, props: page(fx.auditPage), path: '/audit' },
	{ slug: 'audit-filtered', group: 'Admin', title: 'Audit log, filtered', component: AuditPage, props: page(fx.auditPageFiltered), path: '/audit' },
	{ slug: 'settings', group: 'Admin', title: 'Settings', component: SettingsPage, props: page(fx.settings), path: '/settings', layout: { ...fx.layoutData, user: fx.users.admin } },
	{ slug: 'settings-readonly', group: 'Admin', title: 'Settings (judge, read-only)', component: SettingsPage, props: page(fx.settingsReadOnly), path: '/settings', layout: { ...fx.layoutData, user: fx.users.judge } },

	{ slug: 'error-404', group: 'System', title: 'Not found', component: ErrorPage, props: { status: 404 }, shell: false }
];

export const previewBySlug = new Map(previews.map((p) => [p.slug, p]));
export const defaultLayout = fx.layoutData;
