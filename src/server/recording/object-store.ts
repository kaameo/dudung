import { createReadStream } from 'node:fs';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@/server/common/config';

/** S3 호환 객체 저장소(운영은 Cloudflare R2, 로컬은 SeaweedFS). */
export class ObjectStore {
  private readonly client: S3Client;
  /** presigned URL 은 브라우저가 여는 주소로 서명해야 해서 따로 둔다(로컬은 컨테이너 안 주소와 다르다). */
  private readonly signer: S3Client;
  readonly bucket: string;

  constructor(cfg: AppConfig['s3']) {
    const base = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
    };
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.signer = new S3Client({ ...base, endpoint: cfg.publicEndpoint ?? cfg.endpoint });
    this.bucket = cfg.bucket;
  }

  /** 로컬 S3(SeaweedFS)용. 버킷이 없으면 만든다. 저장소가 뜨기 전이면 잠시 기다렸다 다시 시도한다. */
  async ensureBucket(retries = 30): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        return;
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
        if (i >= retries) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async uploadFile(localPath: string, key: string, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: createReadStream(localPath), ContentType: contentType },
      partSize: 8 * 1024 * 1024,
      queueSize: 2,
    });
    await upload.done();
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string): Promise<Array<{ key: string; lastModified: Date }>> {
    const out: Array<{ key: string; lastModified: Date }> = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0) });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  presign(key: string, expiresInSec: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }
}
