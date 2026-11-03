// DEV / TEST ONLY. Points all four connections at the local sandbox (`pnpm mock`) with its dev credentials.
// Usage: MASTER_KEY=dev-master-key-change-me pnpm connect:mock   (env MOCK_URL, default http://localhost:4010)
import { sql } from '../src/lib/server/db/index.ts';
import { encryptJson } from '../src/lib/server/crypto.ts';
import { MOCK_CREDENTIALS, MOCK_REPOS } from './mock-company/server.ts';

const base = (process.env.MOCK_URL || `http://localhost:${process.env.MOCK_PORT || 4010}`).replace(/\/+$/, '');

const rows = [
	{ system: 'keycloak', config: { baseUrl: `${base}/keycloak`, realm: MOCK_CREDENTIALS.keycloak.realm, clientId: MOCK_CREDENTIALS.keycloak.clientId }, secrets: { clientSecret: MOCK_CREDENTIALS.keycloak.clientSecret } },
	{ system: 'mattermost', config: { baseUrl: `${base}/mattermost` }, secrets: { token: MOCK_CREDENTIALS.mattermost.token } },
	{ system: 'github', config: { apiUrl: `${base}/github`, org: MOCK_CREDENTIALS.github.org, repos: MOCK_REPOS.slice(0, 2).join(',') }, secrets: { token: MOCK_CREDENTIALS.github.token } },
	{ system: 'vultr', config: { apiUrl: `${base}/vultr/v2` }, secrets: { apiKey: MOCK_CREDENTIALS.vultr.apiKey } }
];

try {
	for (const r of rows) {
		await sql`
			INSERT INTO connections (system, config_json, credential_ciphertext, status, last_error, last_tested_at)
			VALUES (${r.system}, ${sql.json(r.config)}, ${encryptJson(r.secrets)}, 'untested', NULL, NULL)
			ON CONFLICT (system) DO UPDATE SET
				config_json = EXCLUDED.config_json, credential_ciphertext = EXCLUDED.credential_ciphertext,
				status = 'untested', last_error = NULL, last_tested_at = NULL`;
		console.log(`[connect:mock] ${r.system} -> ${r.config.baseUrl ?? r.config.apiUrl}`);
	}
	console.log(`[connect:mock] inference endpoint for the resolver: ${base}/inference/v1  key: ${MOCK_CREDENTIALS.inference.apiKey}`);
} finally {
	await sql.end({ timeout: 5 });
}
