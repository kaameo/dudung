import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/server/db/schema';

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string, max = 10): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
