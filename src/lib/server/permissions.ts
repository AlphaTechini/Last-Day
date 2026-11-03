import type { Role, SessionUser } from '#lib/types.ts';
import type { Actor } from '#lib/server/engine/index.ts';

export type Permission =
	| 'sweep'
	| 'resetDemo'
	| 'employees.write'
	| 'offboard'
	| 'run.decide'
	| 'run.approve'
	| 'run.retry'
	| 'run.recheck'
	| 'run.destroy'
	| 'unknown.resolve'
	| 'connections.save'
	| 'connections.test'
	| 'settings.save';

/** Facts about the target of an action that some rules depend on. */
export interface PermissionContext {
	/** employees.manager_id of the employee the run/offboarding concerns */
	employeeManagerId?: string | null;
	/** employees.is_demo of that employee */
	employeeIsDemo?: boolean;
}

type User = Pick<SessionUser, 'role' | 'employeeId'>;

const JUDGE_DENIED: Permission[] = ['connections.save', 'connections.test', 'settings.save'];
const HR_DENIED: Permission[] = ['resetDemo', 'run.destroy'];
const SCOPED_TO_DEMO_FOR_JUDGE: Permission[] = ['offboard', 'run.decide', 'run.approve', 'run.retry', 'run.recheck', 'run.destroy', 'unknown.resolve'];

/**
 * Role rules (docs/ROUTES_CONTRACT.md):
 * - admin: everything.
 * - hr: everything except resetDemo and run.destroy (the server destroy is the manager's separate approval).
 * - judge: everything except connections.save/test and settings.save; run/offboard/link actions only on demo employees.
 * - manager: only run.destroy, and only for runs of their own reports (employee.manager_id === user.employeeId).
 */
export function can(user: User | null | undefined, permission: Permission, ctx: PermissionContext = {}): boolean {
	if (!user) return false;
	switch (user.role as Role) {
		case 'admin':
			return true;
		case 'hr':
			return !HR_DENIED.includes(permission);
		case 'judge':
			if (JUDGE_DENIED.includes(permission)) return false;
			if (SCOPED_TO_DEMO_FOR_JUDGE.includes(permission) && ctx.employeeIsDemo === false) return false;
			return true;
		case 'manager':
			return permission === 'run.destroy' && !!user.employeeId && !!ctx.employeeManagerId && ctx.employeeManagerId === user.employeeId;
		default:
			return false;
	}
}

export function toActor(user: SessionUser): Actor {
	return { id: user.id, name: user.name, role: user.role };
}
