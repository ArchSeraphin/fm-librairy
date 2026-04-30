// worker/lib/clamav.ts
import NodeClam from 'clamscan';
import type { Logger } from 'pino';

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'ERROR';

export interface ScanResult {
  verdict: ScanVerdict;
  virusName?: string;
  errorMessage?: string;
}

export interface ScanOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

export async function scanFile(
  filePath: string,
  opts: ScanOptions,
  logger?: Logger,
): Promise<ScanResult> {
  try {
    const clam = await new NodeClam().init({
      removeInfected: false,
      clamdscan: {
        host: opts.host,
        port: opts.port,
        timeout: opts.timeoutMs ?? 60_000,
        localFallback: false,
      },
    });
    const result = await clam.scanFile(filePath);
    if (result.isInfected) {
      return {
        verdict: 'INFECTED',
        virusName: (result.viruses ?? ['UNKNOWN']).join(','),
      };
    }
    return { verdict: 'CLEAN' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error({ err, filePath }, 'clamav scan error');
    return { verdict: 'ERROR', errorMessage: message };
  }
}
