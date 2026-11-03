import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM with a key derived from MASTER_KEY (any string; hashed to 32 bytes).
function key(): Buffer {
	const mk = process.env.MASTER_KEY;
	if (!mk || mk.length < 16) throw new Error('MASTER_KEY must be set (at least 16 characters)');
	return createHash('sha256').update(mk).digest();
}

export function encryptJson(value: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptJson<T = Record<string, string>>(payload: string): T {
	const buf = Buffer.from(payload, 'base64');
	const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
	decipher.setAuthTag(buf.subarray(12, 28));
	const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
	return JSON.parse(pt.toString('utf8')) as T;
}

export function sha256(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}
