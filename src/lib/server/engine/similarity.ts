// Pure string helpers for identity matching. No I/O.

/** Lowercase, strip diacritics, split camelCase boundaries, keep letters and digits as space separated tokens. */
export function tokens(s: string | null | undefined): string[] {
	if (!s) return [];
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);
}

/** Letters and digits only, lowercased, diacritics removed: "D. Okafor-Reyes" -> "dokaforreyes". */
export function squash(s: string | null | undefined): string {
	return tokens(s).join('');
}

export function emailLocal(email: string): string {
	const i = email.lastIndexOf('@');
	return (i >= 0 ? email.slice(0, i) : email).toLowerCase();
}

export function emailDomain(email: string): string {
	const i = email.lastIndexOf('@');
	return i >= 0 ? email.slice(i + 1).toLowerCase() : '';
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
	if (a === b) return a.length === 0 ? 0 : 1;
	if (!a.length || !b.length) return 0;
	const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
	const aMatch = new Array<boolean>(a.length).fill(false);
	const bMatch = new Array<boolean>(b.length).fill(false);
	let matches = 0;
	for (let i = 0; i < a.length; i++) {
		const lo = Math.max(0, i - range);
		const hi = Math.min(b.length - 1, i + range);
		for (let j = lo; j <= hi; j++) {
			if (bMatch[j] || a[i] !== b[j]) continue;
			aMatch[i] = bMatch[j] = true;
			matches++;
			break;
		}
	}
	if (!matches) return 0;
	let t = 0;
	let k = 0;
	for (let i = 0; i < a.length; i++) {
		if (!aMatch[i]) continue;
		while (!bMatch[k]) k++;
		if (a[i] !== b[k]) t++;
		k++;
	}
	const m = matches;
	const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
	let prefix = 0;
	for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
		if (a[i] === b[i]) prefix++;
		else break;
	}
	return jaro + prefix * 0.1 * (1 - jaro);
}

const NICKNAME_GROUPS: string[][] = [
	['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'],
	['william', 'bill', 'billy', 'will', 'willy', 'liam'],
	['richard', 'rick', 'ricky', 'dick', 'rich'],
	['james', 'jim', 'jimmy', 'jamie'],
	['john', 'jon', 'johnny', 'jack'],
	['michael', 'mike', 'mikey', 'mick'],
	['elizabeth', 'liz', 'lizzy', 'beth', 'betty', 'eliza', 'lisa'],
	['katherine', 'catherine', 'kate', 'katie', 'kathy', 'kat', 'cathy'],
	['margaret', 'maggie', 'meg', 'peggy', 'greta'],
	['alexander', 'alex', 'sandy', 'xander'],
	['alexandra', 'alex', 'sandra', 'lexi'],
	['christopher', 'chris', 'topher', 'kit'],
	['christine', 'christina', 'chris', 'tina', 'chrissy'],
	['daniel', 'dan', 'danny'],
	['david', 'dave', 'davey'],
	['thomas', 'tom', 'tommy'],
	['joseph', 'joe', 'joey'],
	['matthew', 'matt'],
	['nicholas', 'nick', 'nico'],
	['samuel', 'sam', 'sammy'],
	['samantha', 'sam', 'sammy'],
	['stephen', 'steven', 'steve'],
	['andrew', 'andy', 'drew'],
	['anthony', 'tony'],
	['benjamin', 'ben', 'benny'],
	['jonathan', 'jon', 'jonny'],
	['patrick', 'pat', 'paddy'],
	['patricia', 'pat', 'trish', 'patty'],
	['rebecca', 'becca', 'becky'],
	['jennifer', 'jen', 'jenny'],
	['jessica', 'jess', 'jessie'],
	['victoria', 'vicky', 'tori'],
	['theodore', 'theo', 'ted', 'teddy'],
	['olufemi', 'femi'],
	['oluwaseun', 'seun'],
	['chukwuemeka', 'emeka'],
	['aleksandr', 'alexander', 'sasha'],
	['dmitri', 'dmitry', 'dima']
];

const nickIndex = new Map<string, Set<string>>();
for (const group of NICKNAME_GROUPS) {
	for (const n of group) {
		const set = nickIndex.get(n) ?? new Set<string>();
		group.forEach((g) => set.add(g));
		nickIndex.set(n, set);
	}
}

/** True when two given-name tokens are the same name, a known nickname pair, or an unambiguous prefix ("dan"/"daniel"). */
export function sameGivenName(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	if (nickIndex.get(a)?.has(b)) return true;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	return short.length >= 3 && long.startsWith(short);
}

export interface NameParts {
	first: string;
	last: string;
	all: string[];
}

export function nameParts(name: string): NameParts {
	const all = tokens(name);
	return { first: all[0] ?? '', last: all.length > 1 ? all[all.length - 1] : '', all };
}

/** Rough "how much does this string look like the person's name" in [0, 1], with a short reason. */
export function nameSimilarity(candidate: string | null | undefined, personName: string): { score: number; reason: string } | null {
	const cand = tokens(candidate);
	if (!cand.length) return null;
	const p = nameParts(personName);
	if (!p.first) return null;
	const hasFirst = cand.some((t) => sameGivenName(t, p.first));
	const hasLast = !!p.last && cand.includes(p.last);
	const initialLast = !!p.last && cand.some((t) => t.length === 1 && t === p.first[0]) && hasLast;
	const firstPlusInitial = hasFirst && !!p.last && cand.some((t) => t.length === 1 && t === p.last[0]);
	if (hasFirst && hasLast) return { score: 0.9, reason: `name "${candidate}" contains first and last name` };
	if (initialLast) return { score: 0.8, reason: `name "${candidate}" is first initial plus last name` };
	if (firstPlusInitial) return { score: 0.7, reason: `name "${candidate}" is first name plus last initial` };
	// fused tokens such as "dokafor" or "danaokafor" are handled by handleSimilarity; here compare whole strings.
	const jw = jaroWinkler(cand.join(''), p.all.join(''));
	if (jw >= 0.92) return { score: jw * 0.9, reason: `name "${candidate}" is very similar` };
	if (hasLast) return { score: 0.4, reason: `name "${candidate}" shares the last name` };
	if (hasFirst && cand.length === 1) return { score: 0.5, reason: `name "${candidate}" matches the first name` };
	if (hasFirst) return { score: 0.3, reason: `name "${candidate}" shares the first name` };
	return null;
}

/** Compare a handle (username or email local part) to the ways people derive handles from their name. */
export function handleSimilarity(handle: string | null | undefined, personName: string): { score: number; reason: string } | null {
	const h = squash(handle);
	if (h.length < 2) return null;
	const p = nameParts(personName);
	if (!p.first) return null;
	const firsts = new Set<string>([p.first, ...(nickIndex.get(p.first) ?? [])]);
	const forms = new Set<string>();
	for (const f of firsts) {
		if (p.last) {
			forms.add(f + p.last);
			forms.add(p.last + f);
			forms.add(f[0] + p.last);
			forms.add(p.last + f[0]);
			forms.add(f + p.last[0]);
		}
	}
	if (forms.has(h)) return { score: 0.85, reason: `handle "${handle}" is built from the name` };
	let best = 0;
	for (const f of forms) best = Math.max(best, jaroWinkler(h, f));
	if (best >= 0.92) return { score: best * 0.9, reason: `handle "${handle}" is very close to the name` };
	if (p.last && p.last.length >= 5 && h.includes(p.last)) return { score: 0.6, reason: `handle "${handle}" contains the last name` };
	for (const f of firsts) {
		if (f.length >= 3 && h.startsWith(f)) return { score: 0.5, reason: `handle "${handle}" starts with the first name` };
	}
	if (p.last && p.last.length >= 4 && h.startsWith(p.last)) return { score: 0.5, reason: `handle "${handle}" starts with the last name` };
	return null;
}

export function daysBetween(a: string | Date | null | undefined, b: string | Date | null | undefined): number | null {
	if (!a || !b) return null;
	const x = new Date(a).getTime();
	const y = new Date(b).getTime();
	if (Number.isNaN(x) || Number.isNaN(y)) return null;
	return Math.abs(x - y) / 86_400_000;
}
