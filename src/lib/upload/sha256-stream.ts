// src/lib/upload/sha256-stream.ts
import { Transform, type TransformCallback } from 'node:stream';
import { createHash, type Hash } from 'node:crypto';

export interface Sha256Result {
  sha256: string;
  bytesWritten: number;
}

export interface Sha256Hasher extends Transform {
  result(): Sha256Result;
}

export function createSha256Hasher(): Sha256Hasher {
  const hash: Hash = createHash('sha256');
  let bytesWritten = 0;
  let finalized = false;
  let digest = '';

  const stream = new Transform({
    transform(chunk: Buffer, _enc: string, cb: TransformCallback) {
      hash.update(chunk);
      bytesWritten += chunk.length;
      cb(null, chunk);
    },
    flush(cb: TransformCallback) {
      digest = hash.digest('hex');
      finalized = true;
      cb();
    },
  }) as Sha256Hasher;

  stream.result = () => {
    if (!finalized) throw new Error('sha256-stream: not finalized — call after stream end');
    return { sha256: digest, bytesWritten };
  };

  return stream;
}
