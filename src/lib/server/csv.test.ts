import { describe, expect, it } from 'vitest';
import { isValidDate, parseCsv, parseEmployeeCsv, splitAliases } from './csv.ts';

describe('parseCsv', () => {
	it('handles quotes, escaped quotes, CRLF and BOM', () => {
		const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,row');
		expect(rows).toEqual([
			['a', 'b'],
			['x, y', 'say "hi"'],
			['last', 'row']
		]);
	});

	it('keeps newlines inside quoted fields', () => {
		expect(parseCsv('a\n"l1\nl2"')).toEqual([['a'], ['l1\nl2']]);
	});
});

describe('parseEmployeeCsv', () => {
	const header = 'name,work_email,role,department,manager_email,start_date,aliases';

	it('parses valid rows and normalizes emails', () => {
		const r = parseEmployeeCsv(`${header}\nDana Okafor,Dana.Okafor@Company.com,Engineer,Eng,boss@company.com,2024-03-04,"dok-dev; dana.o@gmail.com"\n`);
		expect(r.errors).toEqual([]);
		expect(r.rows).toEqual([
			{
				line: 2,
				name: 'Dana Okafor',
				workEmail: 'dana.okafor@company.com',
				role: 'Engineer',
				department: 'Eng',
				managerEmail: 'boss@company.com',
				startDate: '2024-03-04',
				aliases: ['dok-dev', 'dana.o@gmail.com']
			}
		]);
	});

	it('requires name and work_email columns', () => {
		const r = parseEmployeeCsv('name,role\nA,B');
		expect(r.errors[0].message).toContain('work_email');
	});

	it('reports row errors with line numbers', () => {
		const r = parseEmployeeCsv(`${header}\n,a@b.co,,,,,\nX,not-an-email,,,,,\nY,y@b.co,,,,2024-13-45,\nZ,z@b.co,,,z@b.co,,\nY2,y@b.co,,,,,\nY3,y@b.co,,,,,`);
		expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 7]);
		expect(r.rows.map((x) => x.name)).toEqual(['Y2']);
	});

	it('rejects an empty file', () => {
		expect(parseEmployeeCsv('').errors.length).toBe(1);
	});

	it('validates dates and aliases', () => {
		expect(isValidDate('2024-02-30')).toBe(false);
		expect(isValidDate('2024-02-29')).toBe(true);
		expect(splitAliases('a, b;a|c')).toEqual(['a', 'b', 'c']);
	});
});
