import { randomUUID } from 'node:crypto';
import { scanDirectories } from './scanner.js';
import type {
  AppScanResult,
  ScanProgressEvent,
  ScanSource,
  TargetScanSummary,
  WatchTarget,
} from './types.js';

const TARGET_SCAN_CONCURRENCY = 2;

export interface ScanTargetInput {
  id: string;
  path: string;
  only?: string[];
  exclude?: string[];
}

export interface RunScanOptions {
  source: ScanSource;
  setId?: string;
  targets: ScanTargetInput[];
  onProgress?: (event: ScanProgressEvent) => void;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const out = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: safeLimit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return out;
}

function normalizeTargets(targets: ScanTargetInput[]): ScanTargetInput[] {
  const seen = new Set<string>();
  const output: ScanTargetInput[] = [];

  for (const target of targets) {
    if (!target.path.trim()) continue;
    const key = `${target.id}:${target.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(target);
  }

  return output;
}

export function createTargetsFromWatchTargets(watchTargets: WatchTarget[]): ScanTargetInput[] {
  return watchTargets
    .filter((target) => target.enabled)
    .map((target) => ({
      id: target.id,
      path: target.path,
      only: target.only,
      exclude: target.exclude,
    }));
}

export async function runScan(options: RunScanOptions): Promise<AppScanResult> {
  const targets = normalizeTargets(options.targets);
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  let progressCount = 0;

  const summaries: TargetScanSummary[] = await mapLimit(
    targets,
    TARGET_SCAN_CONCURRENCY,
    async (target): Promise<TargetScanSummary> => {
      progressCount += 1;
      options.onProgress?.({
        runId,
        source: options.source,
        current: progressCount,
        total: targets.length,
        targetId: target.id,
        targetPath: target.path,
      });

      const targetStarted = Date.now();
      const scanResult = await scanDirectories({
        targetDir: target.path,
        only: target.only,
        exclude: target.exclude,
      });

      return {
        targetId: target.id,
        targetPath: target.path,
        totalSize: scanResult.totalSize,
        directories: scanResult.directories,
        startedAt: new Date(targetStarted).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - targetStarted,
      };
    }
  );

  const finishedAt = new Date().toISOString();

  return {
    runId,
    source: options.source,
    setId: options.setId,
    startedAt,
    finishedAt,
    targets: summaries,
    totalSize: summaries.reduce((sum, target) => sum + target.totalSize, 0),
    directoryCount: summaries.reduce((sum, target) => sum + target.directories.length, 0),
  };
}
