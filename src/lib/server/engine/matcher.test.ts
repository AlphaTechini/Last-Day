import { describe, expect, it } from 'vitest';
import { matchByRules, type MatchEmployee } from './matcher.ts';

const dana: MatchEmployee = { id: 'e1', name: 'Dana Okafor', workEmail: 'Dana.Okafor@northwind.example', aliases: ['dana.o@gmail.example'] };
const priya: MatchEmployee = { id: 'e2', name: 'Priya Raman', workEmail: 'priya.raman@northwind.example', aliases: [] };
const employees = [dana, priya];

const acct = (p: Partial<Parameters<typeof matchByRules>[0]>) => ({ system: 'github', kind: 'user', username: null, displayName: null, emails: [], ...p });

describe('matchByRules', () => {
	it('matches the exact work email case-insensitively on any account email', () => {
		const m = matchByRules(acct({ emails: ['other@x.example', 'DANA.OKAFOR@NORTHWIND.EXAMPLE'] }), employees);
		expect(m).toMatchObject({ employeeId: 'e1', method: 'rule:work_email', confidence: 1, source: 'rule' });
		expect(m!.evidence[0]).toContain('Dana.Okafor@northwind.example');
	});

	it('matches an SSO subject (federated identity) to the work email', () => {
		const m = matchByRules(acct({ username: 'zzz', raw: { federatedIdentities: [{ identityProvider: 'google', userId: '1234', userName: 'priya.raman@northwind.example' }] } }), employees);
		expect(m).toMatchObject({ employeeId: 'e2', method: 'rule:sso_subject' });
	});

	it('prefers the SSO subject over email and email over username', () => {
		const both = matchByRules(acct({ username: 'priya.raman', emails: ['dana.okafor@northwind.example'], raw: { sso_subject: 'priya.raman@northwind.example' } }), employees);
		expect(both?.method).toBe('rule:sso_subject');
		const emailVsUser = matchByRules(acct({ username: 'priya.raman', emails: ['dana.okafor@northwind.example'] }), employees);
		expect(emailVsUser).toMatchObject({ employeeId: 'e1', method: 'rule:work_email' });
	});

	it('matches a username equal to the work email local part', () => {
		const m = matchByRules(acct({ username: 'Priya.Raman' }), employees);
		expect(m).toMatchObject({ employeeId: 'e2', method: 'rule:username' });
	});

	it('does not match on name similarity, aliases or personal emails (that is the AI job)', () => {
		expect(matchByRules(acct({ username: 'dok-dev', displayName: 'Dana O.', emails: ['dana.o@gmail.example'] }), employees)).toBeNull();
	});

	it('keeps a saved manual link and never replaces it', () => {
		const m = matchByRules(acct({ emails: ['priya.raman@northwind.example'] }), employees, { saved: { employeeId: 'e1', method: 'manual' } });
		expect(m).toMatchObject({ employeeId: 'e1', method: 'manual', source: 'saved' });
	});

	it('does not treat a saved AI link as authoritative', () => {
		const m = matchByRules(acct({ emails: ['priya.raman@northwind.example'] }), employees, { saved: { employeeId: 'e1', method: 'ai' } });
		expect(m?.employeeId).toBe('e2');
	});

	it('never re-links an employee that HR rejected for this account', () => {
		const m = matchByRules(acct({ emails: ['dana.okafor@northwind.example'] }), employees, { rejected: new Set(['e1']) });
		expect(m).toBeNull();
	});

	it('refuses ambiguous matches', () => {
		const twin: MatchEmployee = { id: 'e3', name: 'Dana Okafor', workEmail: 'dana.okafor@other.example', aliases: [] };
		expect(matchByRules(acct({ username: 'dana.okafor' }), [dana, twin])).toBeNull();
		expect(matchByRules(acct({ emails: ['dana.okafor@northwind.example'] }), [dana, twin])?.employeeId).toBe('e1');
	});

	it('ignores servers and API keys (they follow their owner or go to the AI)', () => {
		expect(matchByRules(acct({ kind: 'instance', username: 'dana.okafor', emails: ['dana.okafor@northwind.example'] }), employees)).toBeNull();
		expect(matchByRules(acct({ kind: 'apikey', username: 'dana.okafor' }), employees)).toBeNull();
	});
});
