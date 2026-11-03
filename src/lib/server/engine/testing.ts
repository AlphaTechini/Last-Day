// In-memory connectors for tests. Not imported by production code.
import type { ActionKind, ActionResult, ApiCallRecord, Connector, HealthResult, NormalizedAccount, VerifyResult } from '#lib/server/connectors/types.ts';
import type { SystemId } from '#lib/types.ts';

export interface FakeFailure {
	remaining: number;
	retryable: boolean;
	error: string;
}

export function makeAccount(system: SystemId, p: Partial<NormalizedAccount> & Pick<NormalizedAccount, 'externalId'>): NormalizedAccount {
	return {
		system,
		kind: 'user',
		username: null,
		displayName: null,
		emails: [],
		active: true,
		createdAt: null,
		lastActiveAt: null,
		raw: {},
		...p
	};
}

export class FakeConnector implements Connector {
	readonly accounts = new Map<string, NormalizedAccount>();
	readonly failures = new Map<ActionKind, FakeFailure>();
	/** Number of verify polls that answer `pending` for a snapshot before it becomes ready. */
	snapshotPendingPolls = 0;
	listFails: string | null = null;
	readonly revokeLog: { action: ActionKind; externalId: string }[] = [];
	readonly getAccountLog: string[] = [];
	listCalls = 0;
	private snapshotPolls = new Map<string, number>();
	private snapshots = new Set<string>();

	constructor(readonly system: SystemId) {}

	private key = (kind: string, id: string) => `${kind}:${id}`;

	add(a: NormalizedAccount): NormalizedAccount {
		this.accounts.set(this.key(a.kind, a.externalId), a);
		return a;
	}

	get(kind: string, id: string): NormalizedAccount | undefined {
		return this.accounts.get(this.key(kind, id));
	}

	failAction(action: ActionKind, times: number, opts: Partial<Omit<FakeFailure, 'remaining'>> = {}): void {
		this.failures.set(action, { remaining: times, retryable: opts.retryable ?? true, error: opts.error ?? `${action} exploded` });
	}

	async test(): Promise<HealthResult> {
		return { ok: true, message: `Connected to fake ${this.system}`, calls: [{ method: 'GET', endpoint: '/fake/ping', status: 200, ms: 1 }] };
	}

	async listAccounts(): Promise<NormalizedAccount[]> {
		this.listCalls++;
		if (this.listFails) throw new Error(this.listFails);
		return [...this.accounts.values()].map((a) => structuredClone(a));
	}

	async getAccount(ref: Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId'>): Promise<NormalizedAccount | null> {
		this.getAccountLog.push(`${ref.kind}:${ref.externalId}`);
		const a = this.get(ref.kind, ref.externalId);
		return a ? structuredClone(a) : null;
	}

	actionsFor(a: Pick<NormalizedAccount, 'kind' | 'parentExternalId' | 'raw'>): ActionKind[] {
		switch (this.system) {
			case 'keycloak':
				return ['keycloak.disable', 'keycloak.logout'];
			case 'mattermost':
				return ['mattermost.revoke_sessions', 'mattermost.deactivate'];
			case 'github':
				return a.kind === 'invitation' ? ['github.cancel_invitation'] : ['github.remove_member'];
			case 'vultr':
				if (a.kind === 'instance') return ['vultr.halt_instance', 'vultr.snapshot_instance'];
				if (a.kind === 'apikey') return ['vultr.delete_api_key'];
				return ['vultr.suspend_user'];
		}
	}

	private call(method: string, endpoint: string, status = 200): ApiCallRecord {
		return { method, endpoint, status, ms: 1 };
	}

	async revoke(account: Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId' | 'username' | 'raw'>, action: ActionKind): Promise<ActionResult> {
		const f = this.failures.get(action);
		const endpoint = `/fake/${this.system}/${account.kind}/${account.externalId}/${action}`;
		if (f && f.remaining > 0) {
			f.remaining--;
			return { ok: false, calls: [this.call('POST', endpoint, f.retryable ? 503 : 400)], error: f.error, retryable: f.retryable };
		}
		const a = this.get(account.kind, account.externalId);
		if (!a) return { ok: false, calls: [this.call('POST', endpoint, 404)], error: 'not found', retryable: false };
		this.revokeLog.push({ action, externalId: account.externalId });
		switch (action) {
			case 'keycloak.disable':
			case 'vultr.suspend_user':
			case 'mattermost.deactivate':
				a.active = false;
				break;
			case 'keycloak.logout':
			case 'mattermost.revoke_sessions':
				a.raw = { ...a.raw, sessions: 0 };
				break;
			case 'github.remove_member':
			case 'github.cancel_invitation':
			case 'vultr.delete_api_key':
			case 'vultr.destroy_instance':
				this.accounts.delete(this.key(account.kind, account.externalId));
				break;
			case 'vultr.halt_instance':
				a.active = false;
				a.raw = { ...a.raw, power_status: 'stopped' };
				break;
			case 'vultr.snapshot_instance': {
				const id = `snap-${account.externalId}`;
				this.snapshots.add(id);
				this.snapshotPolls.set(id, 0);
				return { ok: true, calls: [this.call('POST', '/v2/snapshots', 201)], output: { snapshotId: id, snapshotSizeGb: 25 } };
			}
			default:
				break;
		}
		return { ok: true, calls: [this.call('POST', endpoint, 200)] };
	}

	async verify(account: Pick<NormalizedAccount, 'externalId' | 'kind' | 'parentExternalId' | 'username' | 'raw'>, action: ActionKind, ctx?: { snapshotId?: string | null }): Promise<VerifyResult> {
		const endpoint = `/fake/${this.system}/${account.kind}/${account.externalId}`;
		const calls = [this.call('GET', endpoint)];
		const a = this.get(account.kind, account.externalId);
		switch (action) {
			case 'keycloak.disable':
			case 'vultr.suspend_user':
			case 'mattermost.deactivate':
				return { confirmed: !!a && !a.active, observed: a ? `enabled: ${a.active}` : 'user not found', calls };
			case 'keycloak.logout':
			case 'mattermost.revoke_sessions':
				return { confirmed: !!a && Number(a.raw.sessions ?? 0) === 0, observed: `sessions: ${a?.raw.sessions ?? 0}`, calls };
			case 'github.remove_member':
			case 'github.cancel_invitation':
			case 'vultr.delete_api_key':
				return { confirmed: !a, observed: a ? 'still present' : 'not present', calls };
			case 'vultr.destroy_instance':
				return { confirmed: !a, observed: a ? `status: ${String(a.raw.power_status ?? 'running')}` : 'not found (404)', calls };
			case 'vultr.halt_instance':
				return { confirmed: !!a && a.raw.power_status === 'stopped', observed: `status: ${String(a?.raw.power_status ?? 'unknown')}`, calls };
			case 'vultr.snapshot_instance': {
				const id = ctx?.snapshotId ?? '';
				const n = (this.snapshotPolls.get(id) ?? 0) + 1;
				this.snapshotPolls.set(id, n);
				if (!this.snapshots.has(id)) return { confirmed: false, observed: 'snapshot not found', calls };
				if (n <= this.snapshotPendingPolls) return { confirmed: false, pending: true, observed: 'snapshot pending', calls };
				return { confirmed: true, observed: `snapshot ${id}: complete`, calls };
			}
			default:
				return { confirmed: false, observed: 'unsupported', calls };
		}
	}
}
