import { Queue } from 'bullmq';
import { getRedis } from '@/lib/redis';

let _queue: Queue | null = null;

function ensureQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('metadata', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return _queue;
}

// Export as a façade so callers can do `metadataQueue.add(...)` and tests can spy on `.add`.
export const metadataQueue = {
  add: (name: string, data: unknown, opts?: unknown) =>
    (ensureQueue().add as any)(name, data, opts),
  close: () => (_queue ? _queue.close() : Promise.resolve()),
};
