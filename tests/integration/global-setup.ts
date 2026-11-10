import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgUrl: string;
    redisUrl: string;
  }
}

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export default async function setup(project: TestProject) {
  [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7.4-alpine').start(),
  ]);
  const pgUrl = pg.getConnectionUri();
  const client = postgres(pgUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  await client.end();

  project.provide('pgUrl', pgUrl);
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([pg?.stop(), redis?.stop()]);
  };
}
