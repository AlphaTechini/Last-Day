// Design fixtures for the dev preview (/preview). Fictional demo company "Northwind Labs".
// Every object conforms to #lib/types.ts so pages render exactly what the server will send.

import type {
	AccountView,
	ActionStep,
	AuditEntry,
	ConnectionCard,
	DashboardData,
	EmployeeDetail,
	EmployeeListItem,
	RunDetail,
	RunItemView,
	RunSummary,
	SessionUser,
	SettingsData,
	SystemId,
	UnknownAccount
} from '#lib/types.ts';
import type {
	AppLayoutData,
	AuditPageData,
	ConnectionsPageData,
	EmployeeProfilePageData,
	EmployeesPageData,
	LoginPageData,
	RunsPageData,
	UnknownPageData
} from './page-data.ts';

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const ago = (ms: number) => iso(NOW - ms);
const ahead = (ms: number) => iso(NOW + ms);

const DOMAIN = 'northwindlabs.dev';
const REALM = 'northwind';
const ORG = 'northwind-labs';

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type P = [id: string, name: string, role: string, dept: string, manager: string | null, start: string, status?: EmployeeListItem['status'], systems?: SystemId[]];

const ALL: SystemId[] = ['keycloak', 'mattermost', 'github', 'vultr'];
const NO_CLOUD: SystemId[] = ['keycloak', 'mattermost', 'github'];
const BIZ: SystemId[] = ['keycloak', 'mattermost'];

const PEOPLE: P[] = [
	['emp_elena', 'Elena Marsh', 'Chief Executive Officer', 'Leadership', null, '2021-02-01', 'active', ['keycloak', 'mattermost', 'vultr']],
	['emp_priya', 'Priya Raman', 'Head of Engineering', 'Engineering', 'emp_elena', '2021-04-12', 'active', ALL],
	['emp_marcus', 'Marcus Webb', 'People Operations Lead', 'People', 'emp_elena', '2021-09-06', 'active', BIZ],
	['emp_dana', 'Dana Okafor', 'Senior Platform Engineer', 'Engineering', 'emp_priya', '2023-03-13', 'offboarding', ALL],
	['emp_jun', 'Jun Park', 'Head of Product', 'Product', 'emp_elena', '2021-11-15', 'active', NO_CLOUD],
	['emp_sofia', 'Sofia Lindqvist', 'Product Designer', 'Design', 'emp_jun', '2022-05-02', 'active', NO_CLOUD],
	['emp_tomas', 'Tomás Herrera', 'Backend Engineer', 'Engineering', 'emp_priya', '2022-01-10', 'active', ALL],
	['emp_aisha', 'Aisha Bello', 'Frontend Engineer', 'Engineering', 'emp_priya', '2023-07-17', 'active', NO_CLOUD],
	['emp_liam', "Liam O'Connor", 'Site Reliability Engineer', 'Engineering', 'emp_priya', '2022-08-22', 'active', ALL],
	['emp_rahul', 'Rahul Iyer', 'Data Lead', 'Data', 'emp_elena', '2022-02-14', 'active', ALL],
	['emp_mei', 'Mei Tanaka', 'Data Engineer', 'Data', 'emp_rahul', '2023-10-02', 'active', ALL],
	['emp_hannah', 'Hannah Kowalski', 'Product Manager', 'Product', 'emp_jun', '2022-06-20', 'active', NO_CLOUD],
	['emp_grace', 'Grace Liu', 'Head of Customer', 'Customer', 'emp_elena', '2021-10-04', 'active', BIZ],
	['emp_kwame', 'Kwame Mensah', 'Customer Success Manager', 'Customer', 'emp_grace', '2023-01-09', 'active', BIZ],
	['emp_olivia', 'Olivia Grant', 'Head of Sales', 'Sales', 'emp_elena', '2022-03-07', 'active', BIZ],
	['emp_noah', 'Noah Fischer', 'Account Executive', 'Sales', 'emp_olivia', '2024-02-05', 'active', BIZ],
	['emp_yusuf', 'Yusuf Demir', 'Security Engineer', 'Engineering', 'emp_priya', '2023-05-15', 'active', ALL],
	['emp_chloe', 'Chloe Martin', 'Recruiter', 'People', 'emp_marcus', '2024-04-08', 'active', BIZ],
	['emp_diego', 'Diego Alvarez', 'Finance Manager', 'Finance', 'emp_elena', '2022-09-12', 'active', ['keycloak', 'mattermost', 'vultr']],
	['emp_amara', 'Amara Nwosu', 'QA Engineer', 'Engineering', 'emp_priya', '2024-01-15', 'active', NO_CLOUD],
	['emp_ben', 'Ben Carter', 'Support Specialist', 'Customer', 'emp_grace', '2024-06-03', 'active', BIZ],
	['emp_isabel', 'Isabel Romero', 'Marketing Lead', 'Marketing', 'emp_elena', '2022-11-21', 'active', BIZ],
	['emp_felix', 'Felix Wagner', 'Content Designer', 'Marketing', 'emp_isabel', '2024-09-09', 'active', BIZ],
	['emp_zara', 'Zara Ahmed', 'Mobile Engineer', 'Engineering', 'emp_priya', '2023-08-28', 'active', NO_CLOUD],
	['emp_ruth', 'Ruth Abebe', 'Office Manager', 'Operations', 'emp_diego', '2022-04-25', 'active', BIZ],
	['emp_leah', 'Leah Goldberg', 'Sales Development Rep', 'Sales', 'emp_olivia', '2025-01-13', 'active', BIZ],
	['emp_ethan', 'Ethan Brooks', 'Solutions Engineer', 'Sales', 'emp_olivia', '2023-04-03', 'offboarding', ALL],
	['emp_oskar', 'Oskar Nilsson', 'DevOps Engineer', 'Engineering', 'emp_priya', '2022-07-11', 'offboarded', []],
	['emp_samir', 'Samir Haddad', 'ML Engineer', 'Data', 'emp_rahul', '2023-02-20', 'offboarded', ['github']],
	['emp_nina', 'Nina Petrova', 'UX Researcher', 'Design', 'emp_jun', '2023-06-12', 'offboarded', ['mattermost']]
];

const byId = new Map(PEOPLE.map((p) => [p[0], p]));
const nameOf = (id: string | null) => (id ? (byId.get(id)?.[1] ?? null) : null);
const emailOf = (name: string) =>
	`${name
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/'/g, '')
		.replace(/\s+/g, '.')}@${DOMAIN}`;

export const employeeList: EmployeeListItem[] = PEOPLE.map(([id, name, role, department, mgr, start, status = 'active', systems = BIZ]) => ({
	id,
	name,
	workEmail: emailOf(name),
	role,
	department,
	managerName: nameOf(mgr),
	status,
	startDate: start,
	accountCount: id === 'emp_dana' ? 8 : systems.length + (systems.includes('vultr') && id !== 'emp_elena' ? 1 : 0),
	systems
}));

function detail(id: string, extra: Partial<EmployeeDetail> = {}): EmployeeDetail {
	const base = employeeList.find((e) => e.id === id)!;
	const p = byId.get(id)!;
	return { ...base, aliases: [], managerId: p[4], endDate: null, ...extra };
}

export const dana: EmployeeDetail = detail('emp_dana', {
	aliases: ['dana.o@gmail.com', 'dokafor', 'D. Okafor'],
	endDate: iso(NOW),
	status: 'offboarding'
});

export const users: Record<'hr' | 'judge' | 'manager' | 'admin', SessionUser> = {
	hr: { id: 'usr_marcus', email: emailOf('Marcus Webb'), name: 'Marcus Webb', role: 'hr', employeeId: 'emp_marcus' },
	judge: { id: 'usr_judge', email: 'judge@lastday.demo', name: 'Demo Judge', role: 'judge', employeeId: null },
	manager: { id: 'usr_priya', email: emailOf('Priya Raman'), name: 'Priya Raman', role: 'manager', employeeId: 'emp_priya' },
	admin: { id: 'usr_liam', email: emailOf("Liam O'Connor"), name: "Liam O'Connor", role: 'admin', employeeId: 'emp_liam' }
};

export const layoutData: AppLayoutData = {
	user: users.hr,
	nav: { unknownCount: 5, needsAttentionCount: 1, pendingDestroyCount: 1 },
	isDemo: true
};

// ---------------------------------------------------------------------------
// Dana's accounts
// ---------------------------------------------------------------------------

const acc = (a: Partial<AccountView> & Pick<AccountView, 'id' | 'system' | 'kind' | 'externalId'>): AccountView => ({
	username: null,
	displayName: null,
	emails: [],
	createdAt: null,
	lastActiveAt: null,
	active: true,
	linkMethod: null,
	confidence: null,
	evidence: [],
	...a
});

const kcUser = acc({
	id: 'acc_kc_dana',
	system: 'keycloak',
	kind: 'user',
	externalId: '7c1e4a92-5b0d-4f3e-9a61-2d8f0b3c9e15',
	username: 'dana.okafor',
	displayName: 'Dana Okafor',
	emails: [`dana.okafor@${DOMAIN}`],
	createdAt: '2023-03-13T08:02:00Z',
	lastActiveAt: ago(2 * HOUR),
	linkMethod: 'rule:work_email'
});

const mmUser = acc({
	id: 'acc_mm_dana',
	system: 'mattermost',
	kind: 'user',
	externalId: 'k9x3m1qz7bfu8nd4r2w6ecjy5h',
	username: 'dana.okafor',
	displayName: 'Dana Okafor',
	emails: [`dana.okafor@${DOMAIN}`],
	createdAt: '2023-03-13T09:15:00Z',
	lastActiveAt: ago(38 * MIN),
	linkMethod: 'rule:work_email'
});

const mmNick = acc({
	id: 'acc_mm_do',
	system: 'mattermost',
	kind: 'user',
	externalId: 'p4t8w2ys6gq1cvh9za3mxk7rbe',
	username: 'do',
	displayName: 'D. O.',
	emails: ['dana.o@gmail.com'],
	createdAt: '2023-03-15T18:40:00Z',
	lastActiveAt: ago(3 * DAY),
	linkMethod: 'ai',
	confidence: 0.84,
	evidence: [
		'Email dana.o@gmail.com is one of her known aliases in the HR record',
		'Display name "D. O." matches her initials',
		'Created 2 days after her start date, from the same office network',
		'Posts mostly in #platform and #infra, the channels her team uses'
	]
});

const ghMember = acc({
	id: 'acc_gh_dokdev',
	system: 'github',
	kind: 'user',
	externalId: '91482736',
	username: 'dok-dev',
	displayName: 'D. Okafor',
	emails: ['dana.o@gmail.com'],
	createdAt: '2023-03-16T11:20:00Z',
	lastActiveAt: ago(5 * HOUR),
	linkMethod: 'ai',
	confidence: 0.91,
	evidence: [
		'Commit email dana.o@gmail.com appears in her profile aliases',
		'GitHub display name is "D. Okafor"',
		'Joined the northwind-labs org the week she started (16 Mar 2023)',
		'Most pushes go to platform-infra, a repository owned by her team'
	]
});

const ghInvite = acc({
	id: 'acc_gh_invite',
	system: 'github',
	kind: 'invitation',
	externalId: 'inv_48151623',
	username: null,
	displayName: 'Invitation to billing-service',
	emails: [`dana.okafor@${DOMAIN}`],
	createdAt: ago(9 * DAY),
	linkMethod: 'rule:work_email'
});

const vuUser = acc({
	id: 'acc_vu_dana',
	system: 'vultr',
	kind: 'user',
	externalId: 'b5e2f7a1-3c9d-4e8b-a0f6-1d2c3b4a5e6f',
	username: 'dana.okafor',
	displayName: 'Dana Okafor',
	emails: [`dana.okafor@${DOMAIN}`],
	createdAt: '2023-03-20T10:00:00Z',
	lastActiveAt: ago(26 * HOUR),
	linkMethod: 'rule:work_email'
});

const vuService = acc({
	id: 'acc_vu_svc',
	system: 'vultr',
	kind: 'service',
	externalId: 'svc-3f9a2c71',
	username: 'dana-ci',
	displayName: 'dana-ci (service user)',
	emails: [],
	createdAt: '2024-06-02T14:30:00Z',
	lastActiveAt: ago(40 * MIN),
	linkMethod: 'rule:username'
});

const vuKey = acc({
	id: 'acc_vu_key',
	system: 'vultr',
	kind: 'apikey',
	externalId: 'VK7Q-3F9A',
	username: 'dana-ci',
	displayName: 'terraform-ci key',
	emails: [],
	createdAt: '2024-06-02T14:31:00Z',
	lastActiveAt: ago(40 * MIN),
	linkMethod: 'rule:username'
});

const vuServer = acc({
	id: 'acc_vu_srv',
	system: 'vultr',
	kind: 'instance',
	externalId: 'a3d9c2e1-7f4b-4c8a-9e2d-5b6f1a0c3d7e',
	username: null,
	displayName: 'build-runner-02',
	emails: [],
	createdAt: '2025-08-19T16:05:00Z',
	lastActiveAt: ago(12 * MIN),
	linkMethod: 'rule:username',
	plan: 'vc2-1c-1gb (1 vCPU, 1 GB RAM, 25 GB SSD)',
	monthlyCostUsd: 5,
	region: 'Amsterdam (ams)',
	powerStatus: 'running'
});

export const danaAccounts: AccountView[] = [kcUser, mmUser, mmNick, ghMember, ghInvite, vuUser, vuService, vuKey, vuServer];

// ---------------------------------------------------------------------------
// Action steps
// ---------------------------------------------------------------------------

type StepDef = [action: string, label: string, endpoint: string];

const STEPS: Record<string, StepDef[]> = {
	acc_kc_dana: [
		['keycloak.disable', 'Disable user', `PUT /admin/realms/${REALM}/users/7c1e4a92`],
		['keycloak.logout', 'End all sessions', `POST /admin/realms/${REALM}/users/7c1e4a92/logout`]
	],
	acc_mm_dana: [
		['mattermost.revoke_sessions', 'Revoke all sessions', 'POST /api/v4/users/k9x3m1qz/sessions/revoke/all'],
		['mattermost.deactivate', 'Deactivate user', 'DELETE /api/v4/users/k9x3m1qz']
	],
	acc_mm_do: [
		['mattermost.revoke_sessions', 'Revoke all sessions', 'POST /api/v4/users/p4t8w2ys/sessions/revoke/all'],
		['mattermost.deactivate', 'Deactivate user', 'DELETE /api/v4/users/p4t8w2ys']
	],
	acc_gh_dokdev: [
		['github.remove_member', 'Remove from organization', `DELETE /orgs/${ORG}/members/dok-dev`],
		['github.remove_collaborator', 'Remove as outside collaborator', `DELETE /repos/${ORG}/platform-infra/collaborators/dok-dev`]
	],
	acc_gh_invite: [['github.cancel_invitation', 'Cancel pending invitation', `DELETE /orgs/${ORG}/invitations/48151623`]],
	acc_vu_dana: [['vultr.suspend_user', 'Suspend organization user', 'PATCH /v2/users/b5e2f7a1']],
	acc_vu_svc: [['vultr.suspend_service_user', 'Suspend service user', 'PATCH /v2/users/svc-3f9a2c71']],
	acc_vu_key: [['vultr.delete_api_key', 'Delete API key', 'DELETE /v2/users/svc-3f9a2c71/apikeys/VK7Q-3F9A']],
	acc_vu_srv: [
		['vultr.halt', 'Halt server', 'POST /v2/instances/a3d9c2e1/halt'],
		['vultr.snapshot', 'Take snapshot', 'POST /v2/snapshots'],
		['vultr.destroy', 'Destroy server (manager approval)', 'DELETE /v2/instances/a3d9c2e1']
	]
};

const OK_CODE: Record<string, number> = {
	'keycloak.disable': 204,
	'keycloak.logout': 204,
	'mattermost.revoke_sessions': 200,
	'mattermost.deactivate': 200,
	'github.remove_member': 204,
	'github.remove_collaborator': 204,
	'github.cancel_invitation': 204,
	'vultr.suspend_user': 204,
	'vultr.suspend_service_user': 204,
	'vultr.delete_api_key': 204,
	'vultr.halt': 204,
	'vultr.snapshot': 201,
	'vultr.destroy': 204
};

/** done = number of finished steps; running = whether the next one is in progress. */
function steps(accountId: string, done: number, opts: { running?: boolean; failed?: { code: number }; t0?: number } = {}): ActionStep[] {
	const t0 = opts.t0 ?? NOW - 4 * MIN;
	return STEPS[accountId].map(([action, label, endpoint], i) => {
		if (i < done) return { action, label, endpoint, status: 'done', httpStatus: OK_CODE[action] ?? 200, at: iso(t0 + (i + 1) * 3200) };
		if (i === done && opts.failed) return { action, label, endpoint, status: 'failed', httpStatus: opts.failed.code, at: iso(t0 + (i + 1) * 3200) };
		if (i === done && opts.running) return { action, label, endpoint, status: 'running', httpStatus: null, at: null };
		return { action, label, endpoint, status: 'pending', httpStatus: null, at: null };
	});
}

function item(account: AccountView, matchKind: RunItemView['matchKind'], status: RunItemView['status'], s: ActionStep[], extra: Partial<RunItemView> = {}): RunItemView {
	return {
		id: `item_${account.id.replace('acc_', '')}`,
		account,
		matchKind,
		actions: s,
		status,
		attempts: s.some((x) => x.status !== 'pending') ? 1 : 0,
		lastError: null,
		verifiedState: null,
		verifiedAt: null,
		...extra
	};
}

const READBACK: Record<string, string> = {
	acc_kc_dana: 'enabled: false, sessions: 0',
	acc_mm_dana: 'delete_at: 1762179143000, sessions: 0',
	acc_mm_do: 'delete_at: 1762179146000, sessions: 0',
	acc_gh_dokdev: 'GET /orgs/northwind-labs/members/dok-dev -> 404 not a member',
	acc_gh_invite: 'pending invitations for dana.okafor: 0',
	acc_vu_dana: 'status: suspended',
	acc_vu_svc: 'status: suspended',
	acc_vu_key: 'api keys for dana-ci: 0',
	acc_vu_srv: 'power_status: stopped, snapshot: complete'
};

function verified(account: AccountView, matchKind: RunItemView['matchKind'], t0 = NOW - 4 * MIN, offset = 0): RunItemView {
	const s = steps(account.id, STEPS[account.id].length, { t0 });
	return item({ ...account, active: false }, matchKind, 'verified', s, {
		verifiedState: READBACK[account.id],
		verifiedAt: iso(t0 + 9000 + offset)
	});
}

// ---------------------------------------------------------------------------
// Dana's run in each state
// ---------------------------------------------------------------------------

const runBase = {
	id: 'run_7f3k2',
	employeeId: 'emp_dana',
	employeeName: 'Dana Okafor',
	startedBy: 'Marcus Webb',
	itemCount: 9,
	aiCostUsd: 0.0012,
	employee: dana,
	stats: { foundByRules: 6, foundByAi: 2, servers: 1, secondsToGreen: null, aiCalls: 3, aiTokens: 4812 },
	canApprove: true,
	canDestroy: false
} satisfies Partial<RunDetail>;

export const runReview: RunDetail = {
	...runBase,
	status: 'review',
	startedAt: ago(2 * MIN),
	verifiedAt: null,
	verifiedCount: 0,
	recheck: null,
	items: [
		item(kcUser, 'exact', 'pending', steps('acc_kc_dana', 0)),
		item(mmUser, 'exact', 'pending', steps('acc_mm_dana', 0)),
		item(mmNick, 'probable', 'proposed', steps('acc_mm_do', 0)),
		item(ghMember, 'probable', 'proposed', steps('acc_gh_dokdev', 0)),
		item(ghInvite, 'exact', 'pending', steps('acc_gh_invite', 0)),
		item(vuUser, 'exact', 'pending', steps('acc_vu_dana', 0)),
		item(vuService, 'exact', 'pending', steps('acc_vu_svc', 0)),
		item(vuKey, 'exact', 'pending', steps('acc_vu_key', 0)),
		item(vuServer, 'server', 'pending', steps('acc_vu_srv', 0), { stillBillingUsdMonth: 5, snapshotCostUsdMonth: 0.85 })
	],
	approvals: [],
	recheckResult: null
};

/** Review after HR has decided both probable matches: approve becomes available. */
export const runReviewDecided: RunDetail = {
	...runReview,
	items: runReview.items.map((i) => (i.status === 'proposed' ? { ...i, status: 'pending' } : i))
};

const tExec = NOW - 40_000;
export const runExecuting: RunDetail = {
	...runBase,
	status: 'executing',
	startedAt: ago(3 * MIN),
	verifiedAt: null,
	verifiedCount: 3,
	recheck: null,
	items: [
		verified(kcUser, 'exact', tExec),
		verified(mmUser, 'exact', tExec, 4000),
		item(mmNick, 'probable', 'running', steps('acc_mm_do', 1, { running: true, t0: tExec + 8000 })),
		item(ghMember, 'probable', 'running', steps('acc_gh_dokdev', 1, { running: true, t0: tExec })),
		item(ghInvite, 'exact', 'approved', steps('acc_gh_invite', 0)),
		verified(vuUser, 'exact', tExec, 2000),
		item(vuService, 'exact', 'running', steps('acc_vu_svc', 0, { running: true })),
		item(vuKey, 'exact', 'approved', steps('acc_vu_key', 0)),
		item(vuServer, 'server', 'approved', steps('acc_vu_srv', 0), { stillBillingUsdMonth: 5, snapshotCostUsdMonth: 0.85 })
	],
	approvals: [{ id: 'apr_1', approverName: 'Marcus Webb', scope: 'hr_revoke', at: iso(tExec - 2000), itemCount: 9 }],
	recheckResult: null
};

const tDone = NOW - 6 * MIN;
const serverAwaiting = item(
	{ ...vuServer, powerStatus: 'stopped', active: false },
	'server',
	'awaiting_manager',
	steps('acc_vu_srv', 2, { t0: tDone }),
	{
		verifiedState: READBACK.acc_vu_srv,
		verifiedAt: iso(tDone + 41_000),
		snapshotId: 'snap-9c41e7d2',
		snapshotCostUsdMonth: 0.85,
		stillBillingUsdMonth: 5
	}
);

export const runVerified: RunDetail = {
	...runBase,
	status: 'verified',
	startedAt: iso(tDone - 95_000),
	verifiedAt: iso(tDone + 47_000),
	verifiedCount: 9,
	recheck: { status: 'pending', dueAt: ahead(1 * MIN + 52_000), firedAt: null },
	items: [
		verified(kcUser, 'exact', tDone),
		verified(mmUser, 'exact', tDone, 4000),
		verified(mmNick, 'probable', tDone, 11_000),
		verified(ghMember, 'probable', tDone, 7000),
		verified(ghInvite, 'exact', tDone, 15_000),
		verified(vuUser, 'exact', tDone, 2000),
		verified(vuService, 'exact', tDone, 19_000),
		verified(vuKey, 'exact', tDone, 24_000),
		serverAwaiting
	],
	stats: { ...runBase.stats, secondsToGreen: 47 },
	approvals: [{ id: 'apr_1', approverName: 'Marcus Webb', scope: 'hr_revoke', at: iso(tDone - 4000), itemCount: 9 }],
	recheckResult: { status: 'pending', firedAt: null, diff: [] }
};

/** Same run, seen by Dana's manager: the Destroy button is available. */
export const runManager: RunDetail = { ...runVerified, canDestroy: true, canApprove: false };

/** Server destroyed, re-check came back clean. */
export const runClean: RunDetail = {
	...runVerified,
	startedAt: iso(NOW - DAY - 8 * MIN),
	verifiedAt: iso(NOW - DAY - 7 * MIN),
	recheck: { status: 'clean', dueAt: ago(7 * MIN), firedAt: ago(7 * MIN) },
	items: runVerified.items.map((i) =>
		i.matchKind === 'server'
			? { ...i, status: 'removed', stillBillingUsdMonth: 0.85, actions: steps('acc_vu_srv', 3, { t0: NOW - DAY }), verifiedState: 'GET /v2/instances/a3d9c2e1 -> 404 not found' }
			: i
	),
	approvals: [
		...runVerified.approvals,
		{ id: 'apr_2', approverName: 'Priya Raman', scope: 'manager_destroy', at: ago(20 * HOUR), itemCount: 1 }
	],
	recheckResult: { status: 'clean', firedAt: ago(7 * MIN), diff: [] }
};

// ---------------------------------------------------------------------------
// Other runs
// ---------------------------------------------------------------------------

const samir = detail('emp_samir', { aliases: ['samir.h@proton.me', 'sam-h'], endDate: '2026-10-30' });
const samKc = acc({ id: 'acc_kc_samir', system: 'keycloak', kind: 'user', externalId: '2b7d', username: 'samir.haddad', displayName: 'Samir Haddad', emails: [emailOf('Samir Haddad')], linkMethod: 'rule:work_email', active: false });
const samMm = acc({ id: 'acc_mm_samir', system: 'mattermost', kind: 'user', externalId: '8hq2', username: 'samir', displayName: 'Samir Haddad', emails: [emailOf('Samir Haddad')], linkMethod: 'rule:work_email', active: false });
const samGh = acc({ id: 'acc_gh_samir', system: 'github', kind: 'user', externalId: '55102938', username: 'sam-h', displayName: 'Samir H.', emails: ['samir.h@proton.me'], linkMethod: 'ai', confidence: 0.88, evidence: ['Commit email samir.h@proton.me is a known alias', 'Username "sam-h" matches his alias list'], active: true });
const samKey = acc({ id: 'acc_vu_samkey', system: 'vultr', kind: 'apikey', externalId: 'VK2M-81C0', username: 'samir.haddad', displayName: 'ml-batch key', linkMethod: 'rule:work_email', active: true });

const tSam = NOW - DAY - 3 * HOUR;
const simple = (a: AccountView, kind: RunItemView['matchKind'], label: string, endpoint: string, code: number, rb: string, t: number): RunItemView => ({
	id: `item_${a.id}`,
	account: a,
	matchKind: kind,
	actions: [{ action: label.toLowerCase().replace(/\s+/g, '_'), label, endpoint, status: 'done', httpStatus: code, at: iso(t) }],
	status: 'verified',
	attempts: 1,
	lastError: null,
	verifiedState: rb,
	verifiedAt: iso(t + 2000)
});

export const runRegressed: RunDetail = {
	id: 'run_2q8w1',
	employeeId: 'emp_samir',
	employeeName: 'Samir Haddad',
	status: 'regressed',
	startedAt: iso(tSam),
	startedBy: 'Marcus Webb',
	verifiedAt: iso(tSam + 38_000),
	itemCount: 4,
	verifiedCount: 4,
	aiCostUsd: 0.0009,
	recheck: { status: 'regressed', dueAt: ago(3 * HOUR), firedAt: ago(3 * HOUR) },
	employee: samir,
	items: [
		simple(samKc, 'exact', 'Disable user', `PUT /admin/realms/${REALM}/users/2b7d`, 204, 'enabled: false, sessions: 0', tSam + 5000),
		simple(samMm, 'exact', 'Deactivate user', 'DELETE /api/v4/users/8hq2', 200, 'delete_at: 1762092741000', tSam + 7000),
		simple(samGh, 'probable', 'Remove from organization', `DELETE /orgs/${ORG}/members/sam-h`, 204, 'not a member', tSam + 9000),
		simple(samKey, 'exact', 'Delete API key', 'DELETE /v2/users/9e1f/apikeys/VK2M-81C0', 204, 'api keys for samir.haddad: 0', tSam + 12_000)
	],
	stats: { foundByRules: 3, foundByAi: 1, servers: 0, secondsToGreen: 38, aiCalls: 2, aiTokens: 3104 },
	approvals: [{ id: 'apr_9', approverName: 'Marcus Webb', scope: 'hr_revoke', at: iso(tSam - 3000), itemCount: 4 }],
	recheckResult: {
		status: 'regressed',
		firedAt: ago(3 * HOUR),
		diff: [
			{ itemId: `item_${samGh.id}`, label: 'GitHub: sam-h', observed: 'Pending invitation to northwind-labs, created by liam-oc 2 hours after removal' },
			{ itemId: `item_${samKey.id}`, label: 'Vultr: API key for samir.haddad', observed: 'New API key "ml-batch-2" created 26 Oct, last used 4 hours ago' }
		]
	},
	canApprove: true,
	canDestroy: false
};

const nina = detail('emp_nina', { aliases: ['nina.p'], endDate: '2026-11-02' });
const ninaMm = acc({ id: 'acc_mm_nina', system: 'mattermost', kind: 'user', externalId: '3kd9', username: 'nina.petrova', displayName: 'Nina Petrova', emails: [emailOf('Nina Petrova')], linkMethod: 'rule:work_email', active: true, lastActiveAt: ago(20 * HOUR) });
const ninaKc = acc({ id: 'acc_kc_nina', system: 'keycloak', kind: 'user', externalId: '6f0a', username: 'nina.petrova', displayName: 'Nina Petrova', emails: [emailOf('Nina Petrova')], linkMethod: 'rule:work_email', active: false });
const ninaGh = acc({ id: 'acc_gh_nina', system: 'github', kind: 'invitation', externalId: 'inv_5521', displayName: 'Invitation to research-notes', emails: [emailOf('Nina Petrova')], linkMethod: 'rule:work_email', active: false });
const tNina = NOW - 25 * MIN;

export const runFailed: RunDetail = {
	id: 'run_9d4m0',
	employeeId: 'emp_nina',
	employeeName: 'Nina Petrova',
	status: 'partial',
	startedAt: iso(tNina),
	startedBy: 'Marcus Webb',
	verifiedAt: null,
	itemCount: 3,
	verifiedCount: 2,
	aiCostUsd: 0.0004,
	recheck: null,
	employee: nina,
	items: [
		simple(ninaKc, 'exact', 'Disable user', `PUT /admin/realms/${REALM}/users/6f0a`, 204, 'enabled: false, sessions: 0', tNina + 4000),
		{
			id: 'item_mm_nina',
			account: ninaMm,
			matchKind: 'exact',
			actions: [
				{ action: 'mattermost.revoke_sessions', label: 'Revoke all sessions', endpoint: 'POST /api/v4/users/3kd9/sessions/revoke/all', status: 'done', httpStatus: 200, at: iso(tNina + 5000) },
				{ action: 'mattermost.deactivate', label: 'Deactivate user', endpoint: 'DELETE /api/v4/users/3kd9', status: 'failed', httpStatus: 503, at: iso(tNina + 41_000) }
			],
			status: 'failed',
			attempts: 3,
			lastError: 'Mattermost answered 503 Service Unavailable on all 3 attempts. The server may be restarting; retry in a minute.',
			verifiedState: null,
			verifiedAt: null
		},
		simple(ninaGh, 'exact', 'Cancel pending invitation', `DELETE /orgs/${ORG}/invitations/5521`, 204, 'pending invitations: 0', tNina + 6000)
	],
	stats: { foundByRules: 3, foundByAi: 0, servers: 0, secondsToGreen: null, aiCalls: 1, aiTokens: 1210 },
	approvals: [{ id: 'apr_7', approverName: 'Marcus Webb', scope: 'hr_revoke', at: iso(tNina - 2000), itemCount: 3 }],
	recheckResult: null,
	canApprove: true,
	canDestroy: false
};

const summary = (r: RunDetail): RunSummary => ({
	id: r.id,
	employeeId: r.employeeId,
	employeeName: r.employeeName,
	status: r.status,
	startedAt: r.startedAt,
	startedBy: r.startedBy,
	verifiedAt: r.verifiedAt,
	itemCount: r.itemCount,
	verifiedCount: r.verifiedCount,
	aiCostUsd: r.aiCostUsd,
	recheck: r.recheck
});

const ethanRun: RunSummary = {
	id: 'run_5h1c8',
	employeeId: 'emp_ethan',
	employeeName: 'Ethan Brooks',
	status: 'review',
	startedAt: ago(14 * MIN),
	startedBy: 'Marcus Webb',
	verifiedAt: null,
	itemCount: 6,
	verifiedCount: 0,
	aiCostUsd: 0.0007,
	recheck: null
};

const oskarRun: RunSummary = {
	id: 'run_1a6z3',
	employeeId: 'emp_oskar',
	employeeName: 'Oskar Nilsson',
	status: 'verified',
	startedAt: iso(NOW - 9 * DAY),
	startedBy: 'Marcus Webb',
	verifiedAt: iso(NOW - 9 * DAY + 52_000),
	itemCount: 7,
	verifiedCount: 7,
	aiCostUsd: 0.0011,
	recheck: { status: 'clean', dueAt: iso(NOW - 8 * DAY), firedAt: iso(NOW - 8 * DAY) }
};

export const runsList: RunsPageData = {
	runs: [summary(runExecuting), ethanRun, summary(runFailed), summary(runRegressed), oskarRun]
};

// ---------------------------------------------------------------------------
// Employee profile
// ---------------------------------------------------------------------------

export const employeeProfile: EmployeeProfilePageData = {
	employee: { ...dana, status: 'active', endDate: null },
	accounts: danaAccounts,
	runs: [],
	canOffboard: true
};

export const employeeProfileOffboarding: EmployeeProfilePageData = {
	employee: dana,
	accounts: danaAccounts,
	runs: [summary(runExecuting)],
	canOffboard: false
};

export const employeesPage: EmployeesPageData = {
	employees: employeeList,
	departments: [...new Set(employeeList.map((e) => e.department))].sort(),
	managers: PEOPLE.filter(([id]) => ['emp_elena', 'emp_priya', 'emp_jun', 'emp_rahul', 'emp_grace', 'emp_olivia', 'emp_marcus', 'emp_isabel', 'emp_diego'].includes(id)).map(([id, name]) => ({ id, name })),
	canEdit: true
};

// ---------------------------------------------------------------------------
// Unknown owners
// ---------------------------------------------------------------------------

const unk = (a: Partial<UnknownAccount> & Pick<UnknownAccount, 'id' | 'system' | 'kind' | 'externalId'>): UnknownAccount => ({
	...acc(a),
	aiSuggestion: null,
	flag: 'unlinked',
	...a
});

export const unknownPage: UnknownPageData = {
	accounts: [
		unk({
			id: 'acc_mm_alex',
			system: 'mattermost',
			kind: 'user',
			externalId: 'r7c2',
			username: 'alex.contractor',
			displayName: 'Alex Rivera',
			emails: ['alex@rivera-studio.io'],
			createdAt: ago(41 * DAY),
			lastActiveAt: ago(2 * DAY),
			evidence: ['No HR record uses this name or email', 'Only active in #website-redesign'],
			aiSuggestion: null
		}),
		unk({
			id: 'acc_mm_jkow',
			system: 'mattermost',
			kind: 'user',
			externalId: 'm1x8',
			username: 'hkowal',
			displayName: 'H.K.',
			emails: ['hannah.k@fastmail.com'],
			createdAt: '2022-06-24T10:00:00Z',
			lastActiveAt: ago(6 * HOUR),
			aiSuggestion: {
				employeeId: 'emp_hannah',
				employeeName: 'Hannah Kowalski',
				confidence: 0.73,
				evidence: ['Username "hkowal" is a contraction of her name', 'Created 4 days after her start date', 'Mentions the same roadmap channels as her work account']
			}
		}),
		unk({
			id: 'acc_gh_tm',
			system: 'github',
			kind: 'user',
			externalId: '77120394',
			username: 'therrera-dev',
			displayName: 'Tomás',
			emails: [],
			createdAt: '2022-01-14T09:00:00Z',
			lastActiveAt: ago(1 * DAY),
			aiSuggestion: {
				employeeId: 'emp_tomas',
				employeeName: 'Tomás Herrera',
				confidence: 0.94,
				evidence: ['Display name "Tomás" plus username "therrera" matches his name', 'Joined the org 4 days after he started', 'Commits to the same repositories as his work account']
			}
		}),
		unk({
			id: 'acc_mm_ops',
			system: 'mattermost',
			kind: 'service',
			externalId: 'b0t1',
			username: 'ops-bot',
			displayName: 'Ops Bot',
			createdAt: '2021-05-02T12:00:00Z',
			lastActiveAt: ago(9 * MIN),
			flag: 'service'
		}),
		unk({
			id: 'acc_vu_legacy',
			system: 'vultr',
			kind: 'apikey',
			externalId: 'VK0B-77D2',
			username: 'legacy-backup',
			displayName: 'legacy-backup key',
			createdAt: '2022-03-30T08:00:00Z',
			lastActiveAt: ago(118 * DAY),
			flag: 'flagged'
		}),
		unk({
			id: 'acc_kc_test',
			system: 'keycloak',
			kind: 'user',
			externalId: '0e9c',
			username: 'sso-test-user',
			displayName: 'SSO Test',
			emails: [`qa+sso@${DOMAIN}`],
			createdAt: '2024-02-11T08:00:00Z',
			lastActiveAt: ago(60 * DAY)
		})
	],
	employees: employeeList.filter((e) => e.status === 'active').map((e) => ({ id: e.id, name: e.name, workEmail: e.workEmail }))
};

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export const connections: ConnectionCard[] = [
	{
		id: 'con_kc',
		system: 'keycloak',
		name: 'Keycloak',
		description: 'Company single sign-on. Last Day disables users and ends their sessions.',
		status: 'healthy',
		lastTestedAt: ago(4 * MIN),
		lastError: null,
		accountCount: 31,
		config: { baseUrl: 'https://sso.northwindlabs.dev', realm: REALM },
		configFields: [
			{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://sso.example.com' },
			{ key: 'realm', label: 'Realm', placeholder: 'company' }
		],
		secretFields: [
			{ key: 'clientId', label: 'Admin client ID', placeholder: 'last-day-admin' },
			{ key: 'clientSecret', label: 'Client secret', placeholder: 'Paste the client secret' }
		],
		hasSecret: true,
		canEdit: true
	},
	{
		id: 'con_mm',
		system: 'mattermost',
		name: 'Mattermost',
		description: 'Team chat. Last Day deactivates users and revokes their sessions.',
		status: 'healthy',
		lastTestedAt: ago(4 * MIN),
		lastError: null,
		accountCount: 34,
		config: { baseUrl: 'https://chat.northwindlabs.dev' },
		configFields: [{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://chat.example.com' }],
		secretFields: [{ key: 'token', label: 'Personal access token', placeholder: 'System admin token' }],
		hasSecret: true,
		canEdit: true
	},
	{
		id: 'con_gh',
		system: 'github',
		name: 'GitHub organization',
		description: 'Company code. Last Day removes members, cancels invitations and removes outside collaborators.',
		status: 'error',
		lastTestedAt: ago(2 * HOUR),
		lastError: '401 Bad credentials. The token may have expired; paste a new one and test again.',
		accountCount: 19,
		config: { org: ORG },
		configFields: [{ key: 'org', label: 'Organization', placeholder: 'your-org' }],
		secretFields: [{ key: 'token', label: 'Fine-grained token', placeholder: 'github_pat_...' }],
		hasSecret: true,
		canEdit: true
	},
	{
		id: null,
		system: 'vultr',
		name: 'Vultr account',
		description: 'Company cloud. Last Day suspends users, deletes their API keys, and halts and snapshots their servers.',
		status: 'not_configured',
		lastTestedAt: null,
		lastError: null,
		accountCount: 0,
		config: {},
		configFields: [],
		secretFields: [{ key: 'apiKey', label: 'API key', placeholder: 'Account API key with IAM access' }],
		hasSecret: false,
		canEdit: true
	}
];

export const connectionsPage: ConnectionsPageData = { connections };
export const connectionsReadOnly: ConnectionsPageData = {
	connections: connections.map((c) => ({
		...c,
		canEdit: false,
		...(c.system === 'github' ? { status: 'healthy' as const, lastError: null, lastTestedAt: ago(4 * MIN) } : {}),
		...(c.system === 'vultr' ? { id: 'con_vu', status: 'healthy' as const, hasSecret: true, accountCount: 14, lastTestedAt: ago(4 * MIN) } : {})
	}))
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

let auditN = 0;
const audit = (msAgo: number, e: Omit<AuditEntry, 'id' | 'at'>): AuditEntry => ({ id: `aud_${++auditN}`, at: ago(msAgo), ...e });

export const auditEntries: AuditEntry[] = [
	audit(5 * MIN + 10_000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'vultr', kind: 'verify', summary: 'build-runner-02 is stopped and the snapshot is complete', detail: { method: 'GET', endpoint: '/v2/instances/a3d9c2e1', status: 200, readBack: 'power_status: stopped, snapshot: complete' } }),
	audit(5 * MIN + 14_000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'vultr', kind: 'api_call', summary: 'Took snapshot of build-runner-02', detail: { method: 'POST', endpoint: '/v2/snapshots', status: 201, snapshotId: 'snap-9c41e7d2' } }),
	audit(5 * MIN + 22_000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'github', kind: 'verify', summary: 'dok-dev is no longer a member of northwind-labs', detail: { method: 'GET', endpoint: '/orgs/northwind-labs/members/dok-dev', status: 404, readBack: 'not a member' } }),
	audit(5 * MIN + 25_000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'github', kind: 'api_call', summary: 'Removed dok-dev from northwind-labs', detail: { method: 'DELETE', endpoint: '/orgs/northwind-labs/members/dok-dev', status: 204 } }),
	audit(5 * MIN + 31_000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'keycloak', kind: 'verify', summary: 'dana.okafor is disabled with no active sessions', detail: { method: 'GET', endpoint: '/admin/realms/northwind/users/7c1e4a92', status: 200, readBack: 'enabled: false, sessions: 0' } }),
	audit(5 * MIN + 34_000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'keycloak', kind: 'api_call', summary: 'Disabled dana.okafor', detail: { method: 'PUT', endpoint: '/admin/realms/northwind/users/7c1e4a92', status: 204 } }),
	audit(6 * MIN, { actor: 'Marcus Webb', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: null, kind: 'approval', summary: 'Approved revocation of 9 items', detail: { itemCount: 9, scope: 'hr_revoke' } }),
	audit(6 * MIN + 20_000, { actor: 'Marcus Webb', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'github', kind: 'match', summary: 'Confirmed dok-dev belongs to Dana Okafor', detail: { decision: 'yes', confidence: 0.91 } }),
	audit(7 * MIN, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'github', kind: 'ai_call', summary: 'AI proposed dok-dev as Dana Okafor (91%)', detail: { model: 'glm-5.3-flash', tokens: 1630, costUsd: 0.0004, evidence: ghMember.evidence } }),
	audit(7 * MIN + 2000, { actor: 'system', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: 'mattermost', kind: 'ai_call', summary: 'AI proposed "D. O." as Dana Okafor (84%), escalated once', detail: { model: 'glm-5.2', tokens: 2104, costUsd: 0.0006, evidence: mmNick.evidence, escalatedFrom: 'glm-5.3-flash' } }),
	audit(7 * MIN + 9000, { actor: 'Marcus Webb', runId: 'run_7f3k2', employeeName: 'Dana Okafor', system: null, kind: 'sweep', summary: 'Started offboarding for Dana Okafor and swept 4 systems', detail: { accounts: 9 } }),
	audit(3 * HOUR, { actor: 'system', runId: 'run_2q8w1', employeeName: 'Samir Haddad', system: 'github', kind: 'recheck', summary: 'Re-check found a new invitation for sam-h', detail: { method: 'GET', endpoint: '/orgs/northwind-labs/invitations', status: 200, readBack: 'pending invitation for sam-h, invited by liam-oc' } }),
	audit(4 * HOUR, { actor: "Liam O'Connor", runId: null, employeeName: null, system: 'github', kind: 'connection', summary: 'Tested GitHub organization connection', detail: { method: 'GET', endpoint: '/orgs/northwind-labs', status: 401 } }),
	audit(5 * HOUR, { actor: 'Demo Judge', runId: null, employeeName: null, system: null, kind: 'auth', summary: 'Signed in', detail: { ip: '203.0.113.24' } }),
	audit(26 * HOUR, { actor: 'Demo Judge', runId: null, employeeName: null, system: null, kind: 'demo_reset', summary: 'Reset the demo company (30 employees, 4 systems)', detail: { employees: 30 } })
];

export const auditPage: AuditPageData = {
	entries: auditEntries,
	total: 312,
	page: 1,
	pageSize: 50,
	filters: {},
	employees: employeeList.map((e) => ({ id: e.id, name: e.name }))
};

export const auditPageFiltered: AuditPageData = {
	...auditPage,
	entries: auditEntries.filter((e) => e.employeeName === 'Dana Okafor' && e.system === 'github'),
	total: 3,
	filters: { employee: 'emp_dana', system: 'github' }
};

// ---------------------------------------------------------------------------
// Dashboard + settings + login
// ---------------------------------------------------------------------------

export const dashboard: DashboardData = {
	stats: {
		employees: 30,
		activeAccounts: 112,
		unknownAccounts: 5,
		openRuns: 3,
		needsAttention: 1,
		monthlyServerSpendUsd: 5
	},
	openRuns: [summary(runExecuting), ethanRun, summary(runFailed)],
	needsAttention: [summary(runRegressed)],
	pendingDestroys: [
		{ runId: 'run_7f3k2', itemId: 'item_vu_srv', employeeName: 'Dana Okafor', serverLabel: 'build-runner-02', stillBillingUsdMonth: 5, snapshotCostUsdMonth: 0.85 }
	],
	recentActivity: auditEntries.slice(0, 8),
	connections: connectionsReadOnly.connections.map(({ system, name, status, accountCount, lastTestedAt }) => ({ system, name, status, accountCount, lastTestedAt })),
	lastSweepAt: ago(12 * MIN),
	isDemo: true
};

export const dashboardEmpty: DashboardData = {
	stats: { employees: 30, activeAccounts: 98, unknownAccounts: 0, openRuns: 0, needsAttention: 0, monthlyServerSpendUsd: 0 },
	openRuns: [],
	needsAttention: [],
	pendingDestroys: [],
	recentActivity: [],
	connections: dashboard.connections,
	lastSweepAt: null,
	isDemo: true
};

export const settings: SettingsData = {
	recheckDelaySeconds: 120,
	aiConfidenceThreshold: 0.8,
	defaultModel: 'glm-5.3-flash',
	escalationModel: 'glm-5.2',
	availableModels: [
		{ id: 'glm-5.3-flash', inputPer1M: 0.1, outputPer1M: 0.35 },
		{ id: 'glm-5.2', inputPer1M: 0.6, outputPer1M: 2.2 },
		{ id: 'deepseek-v4.1-flash-1017', inputPer1M: 0.14, outputPer1M: 0.28 }
	],
	canEdit: true
};

export const settingsReadOnly: SettingsData = { ...settings, canEdit: false };

export const login: LoginPageData = { demoHint: { email: 'judge@lastday.demo', password: 'northwind-demo-2026' } };
export const loginPlain: LoginPageData = { demoHint: null };
