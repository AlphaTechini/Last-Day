/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM. Returns rows of raw strings. */
export function parseCsv(text: string): string[][] {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;
	const pushField = () => {
		row.push(field);
		field = '';
	};
	const pushRow = () => {
		pushField();
		// skip fully blank lines
		if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
		row = [];
	};
	while (i < text.length) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += c;
			i++;
			continue;
		}
		if (c === '"' && field === '') {
			inQuotes = true;
			i++;
		} else if (c === ',') {
			pushField();
			i++;
		} else if (c === '\r') {
			pushRow();
			i += text[i + 1] === '\n' ? 2 : 1;
		} else if (c === '\n') {
			pushRow();
			i++;
		} else {
			field += c;
			i++;
		}
	}
	if (field !== '' || row.length > 0) pushRow();
	return rows;
}

export interface EmployeeCsvRow {
	line: number;
	name: string;
	workEmail: string;
	role: string;
	department: string;
	managerEmail: string | null;
	startDate: string | null;
	aliases: string[];
}

export interface EmployeeCsvResult {
	rows: EmployeeCsvRow[];
	errors: { line: number; message: string }[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function splitAliases(s: string): string[] {
	return [...new Set(s.split(/[;|,]/).map((a) => a.trim()).filter(Boolean))];
}

export function isValidDate(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Header: name,work_email,role,department,manager_email,start_date,aliases (name and work_email required). */
export function parseEmployeeCsv(text: string, maxRows = 5000): EmployeeCsvResult {
	const table = parseCsv(text);
	const errors: EmployeeCsvResult['errors'] = [];
	if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }] };
	const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
	const idx = (k: string) => header.indexOf(k);
	for (const req of ['name', 'work_email']) {
		if (idx(req) < 0) errors.push({ line: 1, message: `Missing required column "${req}"` });
	}
	if (errors.length) return { rows: [], errors };
	if (table.length - 1 > maxRows) return { rows: [], errors: [{ line: 1, message: `Too many rows (max ${maxRows})` }] };

	const get = (r: string[], k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
	const rows: EmployeeCsvRow[] = [];
	const seen = new Set<string>();
	table.slice(1).forEach((r, i) => {
		const line = i + 2;
		const name = get(r, 'name');
		const workEmail = get(r, 'work_email').toLowerCase();
		const managerEmail = get(r, 'manager_email').toLowerCase();
		const startDate = get(r, 'start_date');
		if (!name) return void errors.push({ line, message: 'name is required' });
		if (!EMAIL_RE.test(workEmail)) return void errors.push({ line, message: `invalid work_email "${workEmail}"` });
		if (seen.has(workEmail)) return void errors.push({ line, message: `duplicate work_email "${workEmail}" in file` });
		if (managerEmail && !EMAIL_RE.test(managerEmail)) return void errors.push({ line, message: `invalid manager_email "${managerEmail}"` });
		if (managerEmail === workEmail) return void errors.push({ line, message: 'an employee cannot be their own manager' });
		if (startDate && !isValidDate(startDate)) return void errors.push({ line, message: `start_date must be YYYY-MM-DD, got "${startDate}"` });
		seen.add(workEmail);
		rows.push({
			line,
			name,
			workEmail,
			role: get(r, 'role'),
			department: get(r, 'department'),
			managerEmail: managerEmail || null,
			startDate: startDate || null,
			aliases: splitAliases(get(r, 'aliases'))
		});
	});
	return { rows, errors };
}
