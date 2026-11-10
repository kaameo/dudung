import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from '@/server/common/logger';
import type { RecordingStorage } from '@/server/ports';
import type { ObjectStore } from './object-store';

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`)),
    );
  });
}

async function videoSize(file: string): Promise<string> {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]);
  return out.trim();
}

async function duration(file: string): Promise<number> {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const n = Number(out.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * MediaMTX 가 디스크에 남긴 fMP4 조각을 MP4 하나로 합쳐 R2 에 올린다.
 * 영상은 재인코딩 없이 그대로, 음성만 Opus → AAC 로 바꿔 모든 브라우저에서 재생되게 한다.
 * 조각마다 해상도가 다르면(화면공유 중 창 크기 변경) 첫 조각 크기에 맞춰 다시 인코딩한다.
 */
export class FfmpegRecordingStorage implements RecordingStorage {
  constructor(
    private readonly recordingsDir: string,
    private readonly store: ObjectStore,
    private readonly log: Logger,
  ) {}

  async mergeAndUpload(input: { broadcastId: string; pathName: string; maxDurationSec: number }) {
    const dir = path.join(this.recordingsDir, input.pathName);
    const segments = (await readdir(dir).catch(() => [] as string[]))
      .filter((f) => f.endsWith('.mp4'))
      .toSorted()
      .map((f) => path.join(dir, f));
    if (segments.length === 0) throw new Error(`no recording segments in ${dir}`);

    const work = await mkdtemp(path.join(tmpdir(), 'dudung-rec-'));
    try {
      const list = path.join(work, 'list.txt');
      await writeFile(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
      const out = path.join(work, 'out.mp4');

      const sizes = new Set(await Promise.all(segments.map(videoSize)));
      const [first] = [...sizes];
      const copyVideo = sizes.size <= 1;
      const videoArgs = copyVideo
        ? ['-c:v', 'copy']
        : [
            '-vf',
            `scale=${first!.replace(',', ':')}:force_original_aspect_ratio=decrease,pad=${first!.replace(',', ':')}:(ow-iw)/2:(oh-ih)/2`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          ];
      if (!copyVideo) this.log.warn({ broadcastId: input.broadcastId, sizes: [...sizes] }, 'segment sizes differ; re-encoding');

      await run('nice', [
        '-n', '10', 'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-map', '0:v:0?', '-map', '0:a:0?',
        ...videoArgs,
        '-c:a', 'aac', '-b:a', '128k',
        '-t', String(input.maxDurationSec),
        '-movflags', '+faststart',
        out,
      ]);

      const key = `recordings/${input.broadcastId}.mp4`;
      const [{ size }, durationSec] = await Promise.all([stat(out), duration(out)]);
      await this.store.uploadFile(out, key, 'video/mp4');
      await rm(dir, { recursive: true, force: true }); // 올린 뒤 서버의 조각은 바로 지운다.
      return { key, sizeBytes: size, durationSec };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  deleteObject(key: string) {
    return this.store.delete(key);
  }

  presignedUrl(key: string, expiresInSec: number) {
    return this.store.presign(key, expiresInSec);
  }
}
