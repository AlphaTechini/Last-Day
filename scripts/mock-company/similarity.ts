// DEV/TEST SANDBOX ONLY. Not used by the production app.
// Deterministic stand-in for the LLM identity resolver: computes a match score from string similarity between an
// employee profile and a candidate account found anywhere in the prompt, and answers in the json_schema shape
// the real resolver asks for ({employee_id, confidence, evidence[], reason_if_none}).
//
// The prompt shape of the real resolver is not fixed, so extraction is defensive: it looks for JSON in the user
// message and classifies objects as "person-like" (work_email / aliases / department / employee_id) or
// "account-like" (username / login / emails / display_name).
type Obj = Record<string, any>;

export interface PersonView {
	id: string | null;
	name: string;
	emails: string[];
	domain: string | null;
}
export interface AccountView {
	handles: string[];
	names: string[];
	emails: string[];
	kind: string;
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9@. -]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const letters = (s: string) => norm(s).replace(/[^a-z]/g, '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(strs) : typeof v === 'string' && v.trim() ? [v.trim()] : []);

function walk(v: unknown, visit: (o: Obj, path: string) => void, path = '') {
	if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`));
	else if (v && typeof v === 'object') {
		visit(v as Obj, path);
		for (const [k, x] of Object.entries(v)) walk(x, visit, `${path}.${k}`);
	}
}

function parseJsonLoose(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		const a = text.indexOf('{');
		const b = text.lastIndexOf('}');
		if (a >= 0 && b > a) {
			try {
				return JSON.parse(text.slice(a, b + 1));
			} catch {
				/* fall through */
			}
		}
	}
	return null;
}

const isPerson = (o: Obj) => ('work_email' in o || 'workEmail' in o || 'aliases' in o || 'department' in o || 'employee_id' in o || 'employeeId' in o) && ('name' in o || 'full_name' in o || 'fullName' in o);
const isAccount = (o: Obj) => ('username' in o || 'login' in o || 'externalId' in o || 'external_id' in o || 'display_name' in o || 'displayName' in o) && !('work_email' in o || 'workEmail' in o || 'aliases' in o);

export function extract(text: string): { people: PersonView[]; account: AccountView | null } {
	const doc = parseJsonLoose(text);
	const people: PersonView[] = [];
	let account: AccountView | null = null;
	if (doc) {
		walk(doc, (o, path) => {
			if (isPerson(o)) {
				const emails = strs([o.work_email, o.workEmail, o.email, o.aliases]).map((e) => e.toLowerCase());
				const work = emails[0] ?? null;
				people.push({ id: strs([o.employee_id, o.employeeId, o.id])[0] ?? null, name: strs([o.name, o.full_name, o.fullName])[0] ?? '', emails, domain: work?.split('@')[1] ?? null });
			} else if (isAccount(o) && (!account || /account|candidate/i.test(path))) {
				const raw = (o.raw ?? {}) as Obj;
				const profile = (raw.profile ?? {}) as Obj;
				account = {
					handles: strs([o.username, o.login, raw.username, raw.login]),
					names: strs([o.display_name, o.displayName, o.name, raw.nickname, raw.first_name, raw.last_name, raw.name, profile.name, [raw.first_name, raw.last_name].filter(Boolean).join(' ')]),
					emails: strs([o.emails, o.email, raw.email, profile.email]).map((e) => e.toLowerCase()),
					kind: String(o.kind ?? '')
				};
			}
		});
	}
	return { people, account };
}

export interface MatchResult {
	employeeId: string | null;
	score: number;
	evidence: string[];
}

function noisyOr(ps: number[]): number {
	return 1 - ps.reduce((acc, p) => acc * (1 - p), 1);
}

export function scorePair(person: PersonView, acct: AccountView): MatchResult {
	const evidence: string[] = [];
	const signals: number[] = [];
	const parts = norm(person.name).split(' ').filter(Boolean);
	const first = parts[0] ?? '';
	const last = parts[parts.length - 1] ?? '';

	const emailHit = acct.emails.find((e) => person.emails.includes(e));
	if (emailHit) {
		signals.push(0.96);
		evidence.push(`account email ${emailHit} is on the employee record`);
	}

	const display = acct.names.map(norm).filter(Boolean);
	for (const d of display) {
		const toks = d.split(/[ .]+/).filter(Boolean);
		if (norm(person.name) === d) {
			signals.push(0.9);
			evidence.push(`display name "${d}" equals the employee name`);
			break;
		}
		if (toks.includes(first) && toks.some((t) => t === last || (t.length === 1 && t === last[0]))) {
			signals.push(toks.includes(last) ? 0.88 : 0.72);
			evidence.push(`display name "${d}" matches first name and ${toks.includes(last) ? 'last name' : 'last initial'}`);
			break;
		}
		const initials = toks.filter((t) => t.length === 1).join('');
		if (initials.length >= 2 && initials === first[0] + last[0]) {
			signals.push(0.45);
			evidence.push(`display name "${d}" has the employee's initials`);
			break;
		}
		if (toks.length === 1 && first && (toks[0] === first || first.startsWith(toks[0]) && toks[0].length >= 3)) {
			signals.push(0.35);
			evidence.push(`display name "${d}" is a short form of the first name`);
			break;
		}
	}

	for (const h of acct.handles.concat(acct.emails.map((e) => e.split('@')[0])).map(letters).filter(Boolean)) {
		if (!first || !last) break;
		if (h === first + last || h === first[0] + last || h === last + first[0]) {
			signals.push(0.8);
			evidence.push(`handle "${h}" is derived from the employee name`);
			break;
		}
		if (h.length >= 3 && h.startsWith(first[0]) && last.startsWith(h.slice(1)) && h.length <= 5) {
			signals.push(0.5);
			evidence.push(`handle "${h}" looks like first initial plus start of last name`);
			break;
		}
		if (h.startsWith(first) && first.length >= 3) {
			signals.push(0.5);
			evidence.push(`handle "${h}" starts with the first name`);
			break;
		}
		if (h.includes(first[0] + last.slice(0, 2)) && h.length <= 8) {
			signals.push(0.45);
			evidence.push(`handle "${h}" contains the initials pattern`);
			break;
		}
	}

	if (person.domain && acct.emails.some((e) => e.endsWith(`@${person.domain}`)) && signals.length && !emailHit) {
		signals.push(0.2);
		evidence.push(`account email is on the company domain ${person.domain}`);
	}
	if (acct.kind === 'service' && signals.length) signals.push(0); // services are never certain

	const score = signals.length ? Math.min(0.97, noisyOr(signals)) : 0.05;
	return { employeeId: person.id, score, evidence };
}

/** The "model": flash models hedge on indirect evidence, the stronger model commits a little more. */
export function answer(userText: string, model: string): { employee_id: string | null; confidence: number; evidence: string[]; reason_if_none: string } {
	const { people, account } = extract(userText);
	if (!account || people.length === 0) {
		return { employee_id: null, confidence: 0, evidence: [], reason_if_none: 'No employee profile and candidate account could be identified in the input.' };
	}
	const ranked = people.map((p) => scorePair(p, account)).sort((a, b) => b.score - a.score);
	const best = ranked[0];
	const strong = /glm-5\.2|glm-5\.3$|pro|opus/.test(model);
	let confidence = best.score;
	const direct = best.evidence.some((e) => e.includes('is on the employee record') || e.includes('equals the employee name'));
	if (!direct) confidence = strong ? Math.min(0.93, confidence + 0.08) : confidence > 0.72 ? confidence - 0.12 : confidence;
	confidence = Math.round(Math.min(0.95, Math.max(0, confidence)) * 100) / 100;
	if (confidence < 0.3) {
		return { employee_id: null, confidence, evidence: best.evidence, reason_if_none: 'No employee shares a name, handle or address with this account.' };
	}
	return { employee_id: best.employeeId, confidence, evidence: best.evidence.length ? best.evidence : ['weak similarity'], reason_if_none: '' };
}
