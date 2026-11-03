// Rule matcher (pure, no I/O). docs/ARCHITECTURE.md section 3.3.
// Order: saved manual link > SSO subject > exact work email (any account email) > username equals work-email local part.
import type { LinkMethod } from '#lib/types.ts';
import { emailLocal } from './similarity.ts';

export interface MatchEmployee {
	id: string;
	name: string;
	workEmail: string;
	aliases: string[];
	startDate?: string | null;
	department?: string;
	role?: string;
}

export interface MatchAccount {
	system: string;
	kind: string;
	username: string | null;
	displayName: string | null;
	emails: string[];
	createdAt?: string | null;
	lastActiveAt?: string | null;
	raw?: Record<string, unknown>;
}

export interface SavedLink {
	employeeId: string;
	method: LinkMethod | string;
}

export interface RuleMatch {
	employeeId: string;
	method: LinkMethod;
	confidence: number;
	evidence: string[];
	/** 'saved' = an existing manual link that must be kept as is; 'rule' = a new link to write. */
	source: 'saved' | 'rule';
}

export interface RuleContext {
	/** The account's current link, if any. Manual links always win and are never replaced. */
	saved?: SavedLink | null;
	/** Employees HR said "not her" about for this account. */
	rejected?: ReadonlySet<string>;
}

/** Account kinds that carry no identity of their own (they follow their parent user or are matched by AI). */
const NO_IDENTITY_KINDS = new Set(['instance', 'apikey']);

const lower = (s: string) => s.trim().toLowerCase();

/** Values an SSO connector may expose as the federated subject: Keycloak `federatedIdentities`, or flat fields. */
export function ssoSubjects(raw: Record<string, unknown> | undefined): string[] {
	if (!raw) return [];
	const out: string[] = [];
	const push = (v: unknown) => {
		if (typeof v === 'string' && v.trim()) out.push(lower(v));
	};
	const fed = raw.federatedIdentities;
	if (Array.isArray(fed)) {
		for (const f of fed) {
			if (f && typeof f === 'object') {
				push((f as Record<string, unknown>).userName);
				push((f as Record<string, unknown>).userId);
			}
		}
	}
	push(raw.sso_subject);
	push(raw.subject);
	push(raw.sub);
	return out;
}

function uniqueEmployee(ids: string[]): string | null {
	const set = new Set(ids);
	return set.size === 1 ? [...set][0] : null;
}

export function isManualMethod(m: string): boolean {
	return m === 'manual' || m === 'rule:manual';
}

export function matchByRules(account: MatchAccount, employees: MatchEmployee[], ctx: RuleContext = {}): RuleMatch | null {
	if (ctx.saved && isManualMethod(ctx.saved.method)) {
		return {
			employeeId: ctx.saved.employeeId,
			method: ctx.saved.method as LinkMethod,
			confidence: 1,
			evidence: ['Saved manual link'],
			source: 'saved'
		};
	}
	if (NO_IDENTITY_KINDS.has(account.kind)) return null;

	const rejected = ctx.rejected ?? new Set<string>();
	const pool = employees.filter((e) => !rejected.has(e.id) && e.workEmail);
	const accountEmails = [...new Set(account.emails.map(lower).filter(Boolean))];
	const username = account.username ? lower(account.username) : '';

	// 1. SSO subject: the identity provider's own record of who this is.
	const subjects = ssoSubjects(account.raw);
	if (subjects.length) {
		const hit = pool.filter((e) => subjects.includes(lower(e.workEmail)));
		const id = uniqueEmployee(hit.map((e) => e.id));
		if (id) {
			const e = hit[0];
			return { employeeId: id, method: 'rule:sso_subject', confidence: 1, evidence: [`SSO subject ${e.workEmail} matches the work email`], source: 'rule' };
		}
	}

	// 2. Exact work email (case-insensitive) against any email on the account, or a username that is an email.
	const emailCandidates = new Set(accountEmails);
	if (username.includes('@')) emailCandidates.add(username);
	if (emailCandidates.size) {
		const hit = pool.filter((e) => emailCandidates.has(lower(e.workEmail)));
		const id = uniqueEmployee(hit.map((e) => e.id));
		if (id) {
			const e = hit[0];
			return { employeeId: id, method: 'rule:work_email', confidence: 1, evidence: [`Work email ${e.workEmail} matches`], source: 'rule' };
		}
		if (hit.length > 1) return null; // ambiguous, leave it to a human
	}

	// 3. Username equals the work-email local part.
	if (username && !username.includes('@')) {
		const hit = pool.filter((e) => emailLocal(e.workEmail) === username);
		const id = uniqueEmployee(hit.map((e) => e.id));
		if (id) {
			const e = hit[0];
			return {
				employeeId: id,
				method: 'rule:username',
				confidence: 1,
				evidence: [`Username "${account.username}" equals the work email name of ${e.workEmail}`],
				source: 'rule'
			};
		}
	}
	return null;
}
