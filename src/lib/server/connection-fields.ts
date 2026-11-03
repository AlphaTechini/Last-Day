import type { SystemId } from '#lib/types.ts';

export interface FieldDef {
	key: string;
	label: string;
	placeholder: string;
}

export interface SystemDef {
	id: SystemId;
	name: string;
	description: string;
	configFields: FieldDef[];
	secretFields: FieldDef[];
}

/** Order here is the display order of the connection cards. */
export const SYSTEM_DEFS: SystemDef[] = [
	{
		id: 'keycloak',
		name: 'Keycloak',
		description: 'Single sign-on. Last Day disables the user and ends all sessions.',
		configFields: [
			{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://sso.example.com' },
			{ key: 'realm', label: 'Realm', placeholder: 'company' },
			{ key: 'clientId', label: 'Client ID', placeholder: 'last-day' }
		],
		secretFields: [{ key: 'clientSecret', label: 'Client secret', placeholder: 'Service account client secret' }]
	},
	{
		id: 'mattermost',
		name: 'Mattermost',
		description: 'Team chat. Last Day revokes all sessions and deactivates the user.',
		configFields: [{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://chat.example.com' }],
		secretFields: [{ key: 'token', label: 'Admin access token', placeholder: 'System admin personal access token' }]
	},
	{
		id: 'github',
		name: 'GitHub organization',
		description: 'Code hosting. Last Day removes org membership, invitations and outside collaborator access.',
		configFields: [
			{ key: 'apiUrl', label: 'API URL', placeholder: 'https://api.github.com' },
			{ key: 'org', label: 'Organization', placeholder: 'my-company' },
			{ key: 'repos', label: 'Repositories (comma separated)', placeholder: 'my-company/app, my-company/infra' }
		],
		secretFields: [{ key: 'token', label: 'Access token', placeholder: 'Fine-grained personal access token' }]
	},
	{
		id: 'vultr',
		name: 'Vultr account',
		description: 'Cloud account. Last Day suspends users, deletes API keys and halts leftover servers.',
		configFields: [{ key: 'apiUrl', label: 'API URL', placeholder: 'https://api.vultr.com/v2' }],
		secretFields: [{ key: 'apiKey', label: 'API key', placeholder: 'Vultr API key' }]
	}
];

export const SYSTEM_IDS: SystemId[] = SYSTEM_DEFS.map((s) => s.id);

export function isSystemId(v: unknown): v is SystemId {
	return typeof v === 'string' && (SYSTEM_IDS as string[]).includes(v);
}

export function getSystemDef(id: SystemId): SystemDef {
	return SYSTEM_DEFS.find((s) => s.id === id)!;
}
