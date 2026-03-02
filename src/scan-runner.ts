import { randomUUID } from 'node:crypto';
import { scanDirectories } from './scanner.js';
import type {
  AppScanResult,
  ScanProgressEvent,
  ScanSource,
  TargetScanSummary,
  WatchTarget,
} from './types.js';

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
  const summaries: TargetScanSummary[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    options.onProgress?.({
      runId,
      source: options.source,
      current: i + 1,
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

    summaries.push({
      targetId: target.id,
      targetPath: target.path,
      totalSize: scanResult.totalSize,
      directories: scanResult.directories,
      startedAt: new Date(targetStarted).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - targetStarted,
    });
  }

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
