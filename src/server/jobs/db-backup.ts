import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Logger } from '@/server/common/logger';
import type { ObjectStore } from '@/server/recording/object-store';

const KEEP_DAYS = 7;

/** pg_dump 결과를 gzip 으로 R2 backups/ 에 올리고 7일 지난 백업은 지운다. */
export async function backupDatabase(databaseUrl: string, store: ObjectStore, log: Logger, now = new Date()) {
  const work = await mkdtemp(path.join(tmpdir(), 'dudung-backup-'));
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = path.join(work, `dudung-${stamp}.sql.gz`);
  try {
    const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', databaseUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    dump.stderr.on('data', (d) => (stderr += d));
    const exited = new Promise<void>((resolve, reject) => {
      dump.on('error', reject);
      dump.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}: ${stderr}`))));
    });
    await Promise.all([pipeline(dump.stdout, createGzip(), createWriteStream(file)), exited]);
    const key = `backups/${path.basename(file)}`;
    await store.uploadFile(file, key, 'application/gzip');
    log.info({ key }, 'database backup uploaded');

    const cutoff = now.getTime() - KEEP_DAYS * 24 * 3600 * 1000;
    for (const o of await store.list('backups/')) {
      if (o.lastModified.getTime() < cutoff) {
        await store.delete(o.key);
        log.info({ key: o.key }, 'old backup deleted');
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
