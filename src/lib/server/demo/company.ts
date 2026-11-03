// The fictional demo company "Northwind Labs". Everything here is invented for the demo:
// people, titles, handles and addresses are made up (the .example TLD is reserved and never routes).
// The systems and API calls the seed makes against them are real.

export const COMPANY_NAME = 'Northwind Labs';
/** Marker written to every record the seed creates where the system allows it (Vultr tags, Keycloak attribute). */
export const DEMO_MARKER = 'lastday-demo';

export function demoDomain(env: NodeJS.ProcessEnv = process.env): string {
	return (env.DEMO_EMAIL_DOMAIN || 'northwind.example').trim().toLowerCase();
}

export interface GithubIdentity {
	login: string;
	/** Name on the GitHub profile (what the AI sees). */
	profileName: string;
	/** Public profile email, if the person has one set. */
	publicEmail?: string;
	/** member of the org, or outside collaborator on `repos`. */
	role: 'member' | 'outside_collaborator';
	repos?: string[]; // owner-less names, resolved against the org
	/** Mock only: when the profile was created. */
	createdAt?: string;
}

export interface Person {
	key: string; // stable slug, also the Keycloak username
	name: string;
	title: string;
	department: string;
	managerKey: string | null;
	startDate: string; // yyyy-mm-dd
	/** HR aliases: personal or former addresses known to HR. */
	aliases: string[];
	/** Mattermost identity when it differs from the default (username = first initial + last name). */
	chat?: { username: string; nickname?: string; firstName?: string; lastName?: string; email?: string };
	github?: GithubIdentity;
	/** Key of this person in Keycloak/Mattermost. false = no account there. */
	keycloak?: boolean;
	mattermost?: boolean;
}

const P = (p: Person): Person => p;

export const PEOPLE: Person[] = [
	P({ key: 'marguerite.solano', name: 'Marguerite Solano', title: 'Chief Executive Officer', department: 'Executive', managerKey: null, startDate: '2019-02-01', aliases: [] }),
	P({ key: 'tomasz.wieczorek', name: 'Tomasz Wieczorek', title: 'Chief Technology Officer', department: 'Engineering', managerKey: 'marguerite.solano', startDate: '2019-03-11', aliases: ['tomasz.w@fastmail.example'], github: { login: 'twieczorek', profileName: 'Tomasz Wieczorek', publicEmail: 'tomasz.wieczorek@{domain}', role: 'member', createdAt: '2013-05-02T09:12:00Z' } }),
	P({ key: 'priya.raman', name: 'Priya Raman', title: 'Engineering Manager, Platform', department: 'Engineering', managerKey: 'tomasz.wieczorek', startDate: '2020-06-01', aliases: ['priya.raman@outlook.example'], github: { login: 'praman-eng', profileName: 'Priya Raman', role: 'member', createdAt: '2014-09-18T14:40:00Z' } }),
	P({
		key: 'dana.okafor',
		name: 'Dana Okafor',
		title: 'Platform Engineer',
		department: 'Engineering',
		managerKey: 'priya.raman',
		startDate: '2022-03-14',
		// Both are personal addresses HR knows about. The first is the one on her chat account, the second was used to join GitHub.
		aliases: ['dana.o@gmail.example', 'dokafor.dev@proton.example'],
		chat: { username: 'dok', nickname: 'D. O.', email: 'dana.o@gmail.example' },
		// Mock GitHub only. In real mode her GitHub footprint comes from DEMO_GITHUB_DANA_LOGIN / DEMO_GITHUB_INVITE_EMAILS.
		github: { login: 'dok-dev', profileName: 'Dana O.', role: 'outside_collaborator', repos: ['platform'], createdAt: '2017-01-23T18:05:00Z' }
	}),
	P({ key: 'leo.brandt', name: 'Leo Brandt', title: 'Senior Platform Engineer', department: 'Engineering', managerKey: 'priya.raman', startDate: '2021-01-18', aliases: [], github: { login: 'lbrandt', profileName: 'Leo Brandt', publicEmail: 'leo.brandt@{domain}', role: 'member', createdAt: '2012-11-30T08:00:00Z' } }),
	P({ key: 'aiko.tanaka', name: 'Aiko Tanaka', title: 'Site Reliability Engineer', department: 'Engineering', managerKey: 'priya.raman', startDate: '2023-04-03', aliases: [], github: { login: 'aikot', profileName: 'Aiko Tanaka', role: 'member', createdAt: '2016-07-14T11:30:00Z' } }),
	P({ key: 'hannah.berg', name: 'Hannah Berg', title: 'Engineering Manager, Product', department: 'Engineering', managerKey: 'tomasz.wieczorek', startDate: '2020-09-14', aliases: [], github: { login: 'hberg', profileName: 'Hannah Berg', publicEmail: 'hannah.berg@{domain}', role: 'member', createdAt: '2013-02-09T10:00:00Z' } }),
	P({ key: 'marcus.odell', name: 'Marcus Odell', title: 'Backend Engineer', department: 'Engineering', managerKey: 'hannah.berg', startDate: '2021-08-23', aliases: ['marcus.odell@icloud.example'], github: { login: 'modell-codes', profileName: 'Marcus Odell', role: 'member', createdAt: '2015-03-21T20:15:00Z' } }),
	P({ key: 'sofia.marchetti', name: 'Sofia Marchetti', title: 'Frontend Engineer', department: 'Engineering', managerKey: 'hannah.berg', startDate: '2022-01-10', aliases: [], github: { login: 'sofiam', profileName: 'Sofia Marchetti', role: 'member', createdAt: '2018-06-05T07:45:00Z' } }),
	P({ key: 'yusuf.demir', name: 'Yusuf Demir', title: 'Mobile Engineer', department: 'Engineering', managerKey: 'hannah.berg', startDate: '2022-10-17', aliases: [], github: { login: 'ydemir', profileName: 'Yusuf Demir', role: 'member', createdAt: '2016-12-01T13:20:00Z' } }),
	P({ key: 'chloe.nguyen', name: 'Chloe Nguyen', title: 'QA Engineer', department: 'Engineering', managerKey: 'hannah.berg', startDate: '2023-02-06', aliases: [] }),
	P({
		key: 'rahul.mehta',
		name: 'Rahul Mehta',
		title: 'Data Engineer',
		department: 'Engineering',
		managerKey: 'tomasz.wieczorek',
		startDate: '2021-05-03',
		aliases: [],
		chat: { username: 'rm-data', nickname: 'Rahul (data)', firstName: 'Rahul', lastName: 'M.' },
		github: { login: 'rm-data', profileName: 'R. Mehta', role: 'member', createdAt: '2014-04-11T16:00:00Z' }
	}),
	P({ key: 'elena.petrova', name: 'Elena Petrova', title: 'VP Product', department: 'Product', managerKey: 'marguerite.solano', startDate: '2019-10-07', aliases: ['elena.petrova@gmail.example'], chat: { username: 'lena', nickname: 'Lena' } }),
	P({ key: 'jonah.whitfield', name: 'Jonah Whitfield', title: 'Product Manager', department: 'Product', managerKey: 'elena.petrova', startDate: '2021-03-01', aliases: [] }),
	P({ key: 'imani.clarke', name: 'Imani Clarke', title: 'Product Designer', department: 'Design', managerKey: 'elena.petrova', startDate: '2022-05-23', aliases: [] }),
	P({ key: 'felix.aaltonen', name: 'Felix Aaltonen', title: 'UX Researcher', department: 'Design', managerKey: 'elena.petrova', startDate: '2023-06-12', aliases: [] }),
	P({ key: 'grace.lindqvist', name: 'Grace Lindqvist', title: 'Head of Sales', department: 'Sales', managerKey: 'marguerite.solano', startDate: '2020-01-13', aliases: [] }),
	P({ key: 'diego.ramos', name: 'Diego Ramos', title: 'Account Executive', department: 'Sales', managerKey: 'grace.lindqvist', startDate: '2021-09-06', aliases: [] }),
	P({ key: 'nadia.haddad', name: 'Nadia Haddad', title: 'Account Executive', department: 'Sales', managerKey: 'grace.lindqvist', startDate: '2022-02-14', aliases: [] }),
	P({ key: 'owen.gallagher', name: 'Owen Gallagher', title: 'Sales Development Representative', department: 'Sales', managerKey: 'grace.lindqvist', startDate: '2023-09-18', aliases: [] }),
	P({ key: 'bianca.rossi', name: 'Bianca Rossi', title: 'Marketing Lead', department: 'Marketing', managerKey: 'marguerite.solano', startDate: '2020-11-02', aliases: [] }),
	P({ key: 'kenji.watanabe', name: 'Kenji Watanabe', title: 'Content Marketer', department: 'Marketing', managerKey: 'bianca.rossi', startDate: '2022-08-08', aliases: [] }),
	P({ key: 'tessa.brooks', name: 'Tessa Brooks', title: 'People Operations Manager', department: 'People', managerKey: 'marguerite.solano', startDate: '2020-04-20', aliases: [] }),
	P({ key: 'samir.qureshi', name: 'Samir Qureshi', title: 'Recruiter', department: 'People', managerKey: 'tessa.brooks', startDate: '2022-11-28', aliases: [] }),
	P({ key: 'olivia.hartmann', name: 'Olivia Hartmann', title: 'Finance Controller', department: 'Finance', managerKey: 'marguerite.solano', startDate: '2019-08-19', aliases: [] }),
	P({ key: 'pavel.novak', name: 'Pavel Novak', title: 'Accountant', department: 'Finance', managerKey: 'olivia.hartmann', startDate: '2021-10-04', aliases: [] }),
	P({ key: 'ruth.abebe', name: 'Ruth Abebe', title: 'IT and Operations Lead', department: 'Operations', managerKey: 'marguerite.solano', startDate: '2020-02-24', aliases: [], chat: { username: 'rabebe', nickname: 'Ruth A.' } }),
	P({ key: 'meiling.chow', name: 'Mei-Ling Chow', title: 'Head of Customer Success', department: 'Customer Success', managerKey: 'marguerite.solano', startDate: '2020-07-06', aliases: [], chat: { username: 'mlchow', nickname: 'ML' } }),
	P({ key: 'carlos.mendez', name: 'Carlos Mendez', title: 'Customer Success Manager', department: 'Customer Success', managerKey: 'meiling.chow', startDate: '2021-12-06', aliases: [] }),
	P({ key: 'ingrid.solheim', name: 'Ingrid Solheim', title: 'Support Engineer', department: 'Customer Success', managerKey: 'meiling.chow', startDate: '2023-01-16', aliases: [] })
];

export const LEAVER_KEY = 'dana.okafor';
export const MANAGER_KEY = 'priya.raman';

/** A chat account with no HR record. Lands in "Unknown owners". */
export const CONTRACTOR = { username: 'swhitlock', firstName: 'Sam', lastName: 'Whitlock', nickname: 'Sam W.', email: 'sam@whitlock-consulting.example', position: 'Contract designer' } as const;

/** The shared chat bot (a Mattermost bot account owned by IT). */
export const OPS_BOT = { username: 'ops-bot', displayName: 'Ops Bot', description: 'Shared deploy and alert notifications' } as const;

export const GITHUB_ORG_REPOS = ['platform', 'infra', 'website'] as const;

export interface DanaVultr {
	userName: string;
	userEmailLocal: string;
	keyName: string;
	instanceLabel: string;
	instanceTags: string[];
}
export const DANA_VULTR: DanaVultr = {
	userName: 'dana-ci',
	userEmailLocal: 'dana-ci',
	keyName: 'dana-ci-deploy',
	instanceLabel: 'build-runner-02',
	instanceTags: ['owner:dana', DEMO_MARKER]
};
/** Another service user nobody owns on paper (lands in Unknown owners / flagged as service). */
export const TERRAFORM_VULTR = { userName: 'terraform-ci', userEmailLocal: 'terraform-ci', keyName: 'terraform-state' } as const;

export function workEmail(p: Person, domain = demoDomain()): string {
	return `${p.key}@${domain}`;
}

export function chatIdentity(p: Person, domain = demoDomain()) {
	const [first, ...rest] = p.name.split(' ');
	const last = rest.join(' ');
	const defUser = `${first[0]}${last}`.toLowerCase().replace(/[^a-z0-9]/g, '');
	return {
		username: p.chat?.username ?? defUser,
		nickname: p.chat?.nickname ?? '',
		firstName: p.chat?.firstName ?? (p.chat ? '' : first),
		lastName: p.chat?.lastName ?? (p.chat ? '' : last),
		email: (p.chat?.email ?? workEmail(p, domain)).toLowerCase(),
		position: p.title
	};
}

export function keycloakIdentity(p: Person, domain = demoDomain()) {
	const [first, ...rest] = p.name.split(' ');
	return { username: p.key, firstName: first, lastName: rest.join(' '), email: workEmail(p, domain), attributes: { department: [p.department], title: [p.title] } };
}

/** GitHub profile email with the {domain} placeholder resolved. */
export function githubPublicEmail(g: GithubIdentity, domain = demoDomain()): string | undefined {
	return g.publicEmail?.replace('{domain}', domain);
}

/** Real mode: consenting GitHub identity for Dana from the environment, or null (then GitHub is skipped for her). */
export function realGithubTargets(env: NodeJS.ProcessEnv = process.env): { login: string | null; inviteEmails: string[] } {
	return {
		login: (env.DEMO_GITHUB_DANA_LOGIN || '').trim() || null,
		inviteEmails: (env.DEMO_GITHUB_INVITE_EMAILS || '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
	};
}
