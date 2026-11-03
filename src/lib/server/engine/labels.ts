// How an account is named in audit summaries and read-backs: the resource's own name, never an owner tag or internal id.
interface LabelRow {
	kind?: string | null;
	username?: string | null;
	display_name?: string | null;
	external_id?: string | null;
}

/** Users and service users: their username. API keys, servers and invitations: their own name (their username is the owner's handle). */
export function accountLabel(a: LabelRow): string {
	if (a.kind === 'apikey' || a.kind === 'instance' || a.kind === 'invitation') return a.display_name ?? a.username ?? a.external_id ?? '';
	return a.username ?? a.display_name ?? a.external_id ?? '';
}
