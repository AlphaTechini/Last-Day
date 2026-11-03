// Dev preview only: advances a run one executor tick at a time so the live run view can be watched
// without a backend. Mirrors the contract's state machine (approved -> running -> verified, servers
// approved -> running -> awaiting_manager), one action at a time per system.

import type { RunDetail, RunItemView } from '#lib/types.ts';

const READBACK: Record<string, string> = {
	keycloak: 'enabled: false, sessions: 0',
	mattermost: 'delete_at set, sessions: 0',
	github: 'not a member, pending invitations: 0',
	vultr: 'status: suspended'
};

export function startOfLiveRun(run: RunDetail): RunDetail {
	return {
		...run,
		status: 'executing',
		startedAt: new Date(Date.now() - 95_000).toISOString(),
		verifiedAt: null,
		verifiedCount: 0,
		recheck: null,
		recheckResult: null,
		stats: { ...run.stats, secondsToGreen: null },
		approvals: [{ id: 'apr_live', approverName: 'Marcus Webb', scope: 'hr_revoke', at: new Date().toISOString(), itemCount: run.items.length }],
		items: run.items.map((i) => ({
			...i,
			status: 'approved',
			verifiedState: null,
			verifiedAt: null,
			attempts: 0,
			account: { ...i.account, active: true, powerStatus: i.account.kind === 'instance' ? 'running' : i.account.powerStatus },
			actions: i.actions.map((a) => ({ ...a, status: 'pending', httpStatus: null, at: null }))
		}))
	};
}

const isDestroy = (action: string) => /destroy/i.test(action);

function advanceItem(item: RunItemView, now: string): RunItemView {
	const actions = item.actions.map((a) => ({ ...a }));
	const runnable = actions.filter((a) => !isDestroy(a.action));
	const running = runnable.find((a) => a.status === 'running');
	if (running) {
		running.status = 'done';
		running.httpStatus = running.endpoint?.startsWith('POST /v2/snapshots') ? 201 : running.endpoint?.startsWith('POST /api') ? 200 : 204;
		running.at = now;
		const next = runnable.find((a) => a.status === 'pending');
		if (next) {
			next.status = 'running';
			return { ...item, actions, status: 'running' };
		}
		if (item.matchKind === 'server') {
			return {
				...item,
				actions,
				status: 'awaiting_manager',
				verifiedState: 'power_status: stopped, snapshot: complete',
				verifiedAt: now,
				snapshotId: 'snap-9c41e7d2',
				account: { ...item.account, powerStatus: 'stopped', active: false }
			};
		}
		return { ...item, actions, status: 'verified', verifiedState: READBACK[item.account.system] ?? 'confirmed', verifiedAt: now, account: { ...item.account, active: false } };
	}
	const first = runnable.find((a) => a.status === 'pending');
	if (first) first.status = 'running';
	return { ...item, actions, status: 'running', attempts: 1 };
}

/** One tick: each system advances its current item by one step. */
export function tick(run: RunDetail): RunDetail {
	if (run.status !== 'executing') return run;
	const now = new Date().toISOString();
	const items = [...run.items];
	for (const system of ['keycloak', 'mattermost', 'github', 'vultr'] as const) {
		const idx = items.findIndex((i) => i.account.system === system && i.status === 'running');
		const pick = idx >= 0 ? idx : items.findIndex((i) => i.account.system === system && i.status === 'approved');
		if (pick >= 0) items[pick] = advanceItem(items[pick], now);
	}
	const done = items.filter((i) => i.status === 'verified' || i.status === 'awaiting_manager' || i.status === 'removed').length;
	const finished = done === items.filter((i) => i.status !== 'rejected').length;
	const secondsToGreen = finished ? Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000) : null;
	return {
		...run,
		items,
		verifiedCount: done,
		status: finished ? 'verified' : 'executing',
		verifiedAt: finished ? now : null,
		stats: { ...run.stats, secondsToGreen },
		recheck: finished ? { status: 'pending', dueAt: new Date(Date.now() + 120_000).toISOString(), firedAt: null } : null,
		recheckResult: finished ? { status: 'pending', firedAt: null, diff: [] } : null
	};
}
