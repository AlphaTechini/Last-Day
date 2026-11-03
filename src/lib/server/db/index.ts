import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgres://lastday:lastday@localhost:5432/lastday';

// Single shared pool for the whole Node process (SvelteKit server, timers, scripts).
export const sql = postgres(url, {
	max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
	idle_timeout: 30,
	transform: { undefined: null },
	onnotice: () => {}
});

export type Sql = typeof sql;
