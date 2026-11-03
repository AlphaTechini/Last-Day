import { describe, expect, it } from 'vitest';
import { can, toActor } from './permissions.ts';
import type { Role, SessionUser } from '#lib/types.ts';

const u = (role: Role, employeeId: string | null = null): SessionUser => ({ id: 'u1', email: 'a@b.c', name: 'Pat', role, employeeId });

describe('permissions', () => {
	it('denies everything when signed out', () => {
		expect(can(null, 'sweep')).toBe(false);
	});

	it('admin can do everything', () => {
		for (const p of ['sweep', 'resetDemo', 'employees.write', 'offboard', 'run.approve', 'run.destroy', 'connections.save', 'connections.test', 'settings.save'] as const) {
			expect(can(u('admin'), p)).toBe(true);
		}
	});

	it('hr does everything except resetDemo and server destroy', () => {
		expect(can(u('hr'), 'offboard')).toBe(true);
		expect(can(u('hr'), 'run.approve')).toBe(true);
		expect(can(u('hr'), 'connections.save')).toBe(true);
		expect(can(u('hr'), 'settings.save')).toBe(true);
		expect(can(u('hr'), 'resetDemo')).toBe(false);
		expect(can(u('hr'), 'run.destroy', { employeeManagerId: 'm1' })).toBe(false);
	});

	it('judge is read-only for connections and settings, and limited to demo employees for runs', () => {
		const j = u('judge');
		expect(can(j, 'connections.save')).toBe(false);
		expect(can(j, 'connections.test')).toBe(false);
		expect(can(j, 'settings.save')).toBe(false);
		expect(can(j, 'resetDemo')).toBe(true);
		expect(can(j, 'sweep')).toBe(true);
		expect(can(j, 'offboard', { employeeIsDemo: true })).toBe(true);
		expect(can(j, 'offboard', { employeeIsDemo: false })).toBe(false);
		expect(can(j, 'run.approve', { employeeIsDemo: false })).toBe(false);
	});

	it('manager can only destroy for their own reports', () => {
		const m = u('manager', 'emp-manager');
		expect(can(m, 'run.destroy', { employeeManagerId: 'emp-manager' })).toBe(true);
		expect(can(m, 'run.destroy', { employeeManagerId: 'someone-else' })).toBe(false);
		expect(can(m, 'run.destroy', { employeeManagerId: null })).toBe(false);
		expect(can(m, 'run.destroy')).toBe(false);
		for (const p of ['sweep', 'offboard', 'run.approve', 'run.decide', 'run.retry', 'run.recheck', 'unknown.resolve', 'employees.write', 'settings.save'] as const) {
			expect(can(m, p, { employeeManagerId: 'emp-manager' })).toBe(false);
		}
	});

	it('manager without an employee record can never destroy', () => {
		expect(can(u('manager', null), 'run.destroy', { employeeManagerId: null })).toBe(false);
	});

	it('maps a session user to an engine actor', () => {
		expect(toActor(u('hr'))).toEqual({ id: 'u1', name: 'Pat', role: 'hr' });
	});
});
