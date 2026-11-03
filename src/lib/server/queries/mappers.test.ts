import { describe, expect, it } from 'vitest';
import { dateOnly, iso, isUuid, mapAccount, mapRecheckDiff, mapRunItem, mapRunSummary, mapStep, num, secondsBetween } from './mappers.ts';

describe('conversions', () => {
	it('iso converts dates and strings, null otherwise', () => {
		expect(iso(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
		expect(iso('2026-01-02T03:04:05+01:00')).toBe('2026-01-02T02:04:05.000Z');
		expect(iso(null)).toBeNull();
		expect(iso('garbage')).toBeNull();
	});

	it('num converts numeric strings from postgres to numbers', () => {
		expect(num('5.0000')).toBe(5);
		expect(num('0.001200')).toBe(0.0012);
		expect(num(null)).toBeNull();
		expect(num('abc')).toBeNull();
	});

	it('secondsBetween rounds and clamps', () => {
		expect(secondsBetween('2026-01-01T00:00:00Z', '2026-01-01T00:01:30.4Z')).toBe(90);
		expect(secondsBetween('2026-01-01T00:00:00Z', null)).toBeNull();
		expect(secondsBetween('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
	});

	it('dateOnly', () => {
		expect(dateOnly('2024-03-04')).toBe('2024-03-04');
		expect(dateOnly(new Date(2024, 2, 4))).toBe('2024-03-04');
		expect(dateOnly(null)).toBeNull();
	});

	it('isUuid', () => {
		expect(isUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
		expect(isUuid('nope')).toBe(false);
	});
});

describe('mappers', () => {
	it('mapAccount adds instance fields only for instances', () => {
		const base = { account_id: 'a1', system: 'vultr', external_id: 'x', username: null, display_name: 'build-runner-02', emails: [], active: true, account_created_at: new Date('2026-01-01T00:00:00Z'), last_active_at: null };
		const inst = mapAccount({ ...base, kind: 'instance', plan: 'vc2-1c-1gb', monthly_cost: '5.00', region: 'ewr', power_status: 'running' }, { method: 'rule:username', confidence: 0.5, evidence: ['a', 'b'] });
		expect(inst).toMatchObject({ plan: 'vc2-1c-1gb', monthlyCostUsd: 5, region: 'ewr', powerStatus: 'running', linkMethod: 'rule:username', confidence: 0.5, evidence: ['a', 'b'], createdAt: '2026-01-01T00:00:00.000Z' });
		const user = mapAccount({ ...base, kind: 'user', plan: 'x' });
		expect('plan' in user).toBe(false);
		expect(user.linkMethod).toBeNull();
	});

	it('mapStep normalizes partial steps', () => {
		expect(mapStep({ action: 'keycloak.disable', label: 'Disable user' })).toEqual({ action: 'keycloak.disable', label: 'Disable user', status: 'pending', endpoint: null, httpStatus: null, at: null });
		expect(mapStep({ action: 'a', status: 'bogus', httpStatus: 204, at: '2026-01-01T00:00:00Z' })).toMatchObject({ status: 'pending', httpStatus: 204, at: '2026-01-01T00:00:00.000Z' });
	});

	it('mapRunSummary maps counts, cost and recheck', () => {
		const s = mapRunSummary({
			id: 'r', employee_id: 'e', employee_name: 'Dana', status: 'verified', started_at: new Date('2026-01-01T00:00:00Z'), started_by_name: null,
			verified_at: null, ai_cost_usd: '0.001200', item_count: 4, verified_count: 3, recheck_status: 'pending', recheck_due_at: new Date('2026-01-02T00:00:00Z'), recheck_fired_at: null
		});
		expect(s).toEqual({
			id: 'r', employeeId: 'e', employeeName: 'Dana', status: 'verified', startedAt: '2026-01-01T00:00:00.000Z', startedBy: 'system', verifiedAt: null,
			itemCount: 4, verifiedCount: 3, aiCostUsd: 0.0012, recheck: { status: 'pending', dueAt: '2026-01-02T00:00:00.000Z', firedAt: null }
		});
		expect(mapRunSummary({ id: 'r', employee_id: 'e', employee_name: 'D', status: 'review', started_at: new Date(), ai_cost_usd: '0' }).recheck).toBeNull();
	});

	it('mapRunItem includes server fields only for servers', () => {
		const row = { account_id: 'a', system: 'vultr', kind: 'instance', external_id: 'i', emails: [], active: true, item_id: 'it', match_kind: 'server', steps_json: [], item_status: 'awaiting_manager', attempts: 1, snapshot_id: 's1', snapshot_cost_usd_month: '0.0500', still_billing_usd_month: '5.0000' };
		expect(mapRunItem(row)).toMatchObject({ snapshotId: 's1', snapshotCostUsdMonth: 0.05, stillBillingUsdMonth: 5 });
		expect('snapshotId' in mapRunItem({ ...row, match_kind: 'exact' })).toBe(false);
	});

	it('mapRecheckDiff tolerates missing data', () => {
		expect(mapRecheckDiff(null)).toEqual([]);
		expect(mapRecheckDiff({ diff: [{ itemId: 'i', label: 'Keycloak', observed: 'enabled: true' }] })).toEqual([{ itemId: 'i', label: 'Keycloak', observed: 'enabled: true' }]);
	});
});
