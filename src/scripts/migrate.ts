/** one-shot 마이그레이션. compose 의 migrate 서비스가 app 보다 먼저 한 번 실행한다. */
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR ?? 'drizzle') });
await client.end();
console.log('migrations applied');
