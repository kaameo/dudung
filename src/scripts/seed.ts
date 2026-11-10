/**
 * 고정 테스트 계정과 demo 방송·녹화를 넣는다. 여러 번 실행해도 결과가 같다.
 * demo 녹화 영상이 저장소에 없으면 ffmpeg 로 20초짜리 테스트 영상을 만들어 올린다.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from '@/server/common/config';
import { createDb } from '@/server/common/db';
import { ObjectStore } from '@/server/recording/object-store';
import { DEMO_RECORDING_KEY, seed } from '@/server/seed';

const execFileAsync = promisify(execFile);
const config = loadConfig();
const { db, close } = createDb(config.databaseUrl, 1);
const store = new ObjectStore(config.s3);

let demo = { sizeBytes: 5 * 1024 * 1024, durationSec: 20 };
try {
  if (process.env.S3_CREATE_BUCKET === 'true') await store.ensureBucket();
  if (!(await store.exists(DEMO_RECORDING_KEY))) {
    const work = await mkdtemp(path.join(tmpdir(), 'dudung-seed-'));
    const out = path.join(work, 'demo.mp4');
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', out,
    ]);
    demo = { sizeBytes: (await stat(out)).size, durationSec: 20 };
    await store.uploadFile(out, DEMO_RECORDING_KEY, 'video/mp4');
    await rm(work, { recursive: true, force: true });
    console.log('demo recording uploaded');
  }
} catch (err) {
  console.warn('demo recording upload skipped:', (err as Error).message);
}

await seed(db, { demoRecording: demo });
await close();
console.log('seed done');
