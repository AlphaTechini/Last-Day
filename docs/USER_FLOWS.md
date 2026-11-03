# Last Day: User Flows

Screen-by-screen flows. Pitched as offboarding for any small company; Vultr appears as one of the connected systems.

## Roles

| Role | What they do |
|---|---|
| People-ops / HR | Main user. Offboards people, reviews matches, approves revocation. |
| Leaver's manager | Approves only the final destroy of servers the leaver left behind. |
| Admin / IT | Connects systems once at setup; handles Unknown owner accounts. |
| Judge (demo) | Judge login scoped to the demo company: can reset it, offboard demo employees and view the audit log; cannot change connections or settings. |

## Screens

1. Sign in
2. Dashboard (open runs, needs attention, recent activity, Sweep now)
3. Employees (list + profile)
4. Offboarding run (review, approve, live run, verification, re-check)
5. Connections (one card per system)
6. Unknown owners
7. Audit log
8. Settings (re-check delay, confidence threshold, models)

## Flow 1: One-time setup (admin)

1. Sign in.
2. **Connections:** one card per system (Keycloak, Mattermost, GitHub org, Vultr account). Paste the admin credential, click **Test**. The card turns green when a read call succeeds. The credential is encrypted and never shown again.
3. **Employees:** import a CSV or add people manually: name, work email, role, department, manager, status.
4. Click **Sweep now**. Last Day pulls every account from every connected system:
   - Rules link exact matches (work email, SSO subject id, saved manual link).
   - The AI resolver proposes owners for the rest, with evidence and confidence.
   - Anything still unlinked goes to **Unknown owners**.
5. Admin reviews Unknown owners: link to an employee, mark as a service/shared account, or leave flagged.

## Flow 2: Offboard now (HR)

1. **Employees**, open Dana Okafor's profile.
2. Click **Offboard now**. Confirm dialog: "This will revoke Dana's access in every connected system. Continue?"
3. Last Day re-sweeps the connected systems for Dana only and opens **Offboarding: Dana Okafor**.
4. The review screen groups cards by system:
   - **Exact matches:** "Keycloak: dana.okafor@company (matched by work email)".
   - **Probable matches:** "GitHub: dok-dev. AI match, 91%. Evidence: commit email dana.o@gmail.com appears on her profile aliases; display name 'D. Okafor'; account created the week she joined." Buttons: **Yes, that's Dana** / **Not her**.
   - **Leftover servers:** "Vultr: build-runner-02, launched by Dana, $X/month." Shows the plan and hourly price from the Vultr plans API.
5. HR confirms or rejects each probable match.
6. HR clicks **Approve revocation** (all), or approves card by card.

## Flow 3: Live run and verification (automatic, HR watches)

1. **Live run** view. Each action ticks off in order:
   - Keycloak: disable user, end all sessions.
   - Mattermost: deactivate user, revoke all sessions.
   - GitHub: remove from org, cancel pending invitations, remove as outside collaborator.
   - Vultr: suspend organization user, delete their API keys.
   - Vultr server: halt, then snapshot.
2. After each action, Last Day re-reads that system's API. The line turns green only when the system itself confirms ("enabled: false", "delete_at set", "not a member", "suspended", "status: stopped").
3. A failed action shows red with the error, retries with backoff, and can be retried by hand.
4. Server card: "Halted and snapshotted. Still billing $X/month until destroyed. Snapshot storage $Y/month." Status: awaiting manager.
5. Run summary: accounts found (how many by rules, how many by AI), time from click to all green, AI cost for the run.

## Flow 4: Manager's server decision

1. The manager sees a pending item on their dashboard: "Dana left a server. Snapshot taken. Anything to keep?"
2. They check the snapshot or hand it over, then click **Destroy**.
3. Last Day destroys the instance and verifies it is gone. The card moves to "Removed" and the "still billing" figure drops to the snapshot cost (or zero if the snapshot is also deleted).

## Flow 5: 24-hour re-check (automatic)

1. When every action in Dana's run is verified, Last Day stores one re-check time: 24 hours later.
2. At that time it re-reads every revoked account in every system.
3. Result:
   - **Still clean:** the run shows "Re-checked 24h later: clean" with the time.
   - **Regressed:** something came back (re-enabled, re-invited, new key). The run turns red and appears in **Needs attention** with what changed.
4. **Re-check now** on the run page runs the same check immediately. The delay is a setting (default 24 hours; set to a few minutes for the demo).

There are no other scheduled or recurring jobs.

## Flow 6: Sweep now (admin, manual)

1. Dashboard, **Sweep now**.
2. Re-scans every system. New unexplained accounts go to Unknown owners; accounts of already-offboarded people that are active again go to Needs attention.

## Flow 7: Audit (HR / admin)

1. **Audit log**: filter by employee, run, system or actor.
2. Each entry shows: what happened, who approved it, the exact API call (method, endpoint, status code), the verification read-back, and for AI matches the model id, tokens, cost and the evidence it gave.

## Flow 8: Judge path (demo)

1. Open the public URL and sign in with the judge login (scoped to the demo company).
2. Click **Reset demo company** (reseeds the fictional 30-person company through the real APIs).
3. Open Dana Okafor, click **Offboard now**, review the probable matches, approve.
4. Watch every line turn green, open the audit log, then click **Re-check now**.
