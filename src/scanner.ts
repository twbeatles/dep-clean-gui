import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_TARGETS, SKIP_DIRECTORIES } from './config.js';
import type { FoundDirectory, ScanOptions, ScanResult } from './types.js';

const SCAN_STAT_CONCURRENCY = 64;

interface CompiledTargetMatcher {
  exactNameTargets: Set<string>;
  pathTargets: string[];
  eggInfoPatternEnabled: boolean;
}

function normalizePathLike(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return normalized;
}

function compileTargetMatcher(targets: string[]): CompiledTargetMatcher {
  const exactNameTargets = new Set<string>();
  const pathTargets: string[] = [];
  let eggInfoPatternEnabled = false;

  for (const rawTarget of targets) {
    const target = normalizePathLike(rawTarget.trim());
    if (!target) continue;

    if (target === '.egg-info') {
      eggInfoPatternEnabled = true;
      continue;
    }

    if (target.includes('/')) {
      pathTargets.push(target);
      continue;
    }

    exactNameTargets.add(target);
  }

  return {
    exactNameTargets,
    pathTargets,
    eggInfoPatternEnabled,
  };
}

async function forEachLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const runners = Array.from({ length: safeLimit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });

  await Promise.all(runners);
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  const dirStack: string[] = [dirPath];

  while (dirStack.length > 0) {
    const currentPath = dirStack.pop();
    if (!currentPath) continue;

    let entries: fs.Dirent[] = [];

    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      // Skip directories we can't access.
      continue;
    }

    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        dirStack.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    await forEachLimit(files, SCAN_STAT_CONCURRENCY, async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        totalSize += stat.size;
      } catch {
        // Skip files we can't access.
      }
    });
  }

  return totalSize;
}

function shouldTarget(
  name: string,
  relativePath: string,
  matcher: CompiledTargetMatcher
): boolean {
  if (matcher.exactNameTargets.has(name)) {
    return true;
  }

  if (matcher.eggInfoPatternEnabled && name.endsWith('.egg-info')) {
    return true;
  }

  if (matcher.pathTargets.length > 0) {
    const normalizedRelativePath = normalizePathLike(relativePath);
    for (const target of matcher.pathTargets) {
      if (
        normalizedRelativePath === target ||
        normalizedRelativePath.endsWith(`/${target}`)
      ) {
        return true;
      }
    }
  }

  return false;
}

export async function scanDirectories(options: ScanOptions): Promise<ScanResult> {
  const { targetDir, only, exclude } = options;

  let targets = only && only.length > 0 ? only : DEFAULT_TARGETS;

  if (exclude && exclude.length > 0) {
    targets = targets.filter((t) => !exclude.includes(t));
  }

  const matcher = compileTargetMatcher(targets);
  const skipDirectoryNames = new Set(SKIP_DIRECTORIES);
  const foundDirectories: FoundDirectory[] = [];
  const stack: string[] = [targetDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      // Skip directories we can't access.
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipDirectoryNames.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(targetDir, fullPath);

      if (shouldTarget(entry.name, relativePath, matcher)) {
        const size = await getDirectorySize(fullPath);

        foundDirectories.push({
          path: fullPath,
          name: entry.name,
          size,
          relativePath: './' + relativePath,
        });
        continue;
      }

      stack.push(fullPath);
    }
  }

  // Sort by size descending
  foundDirectories.sort((a, b) => b.size - a.size);

  const totalSize = foundDirectories.reduce((sum, dir) => sum + dir.size, 0);

  return {
    directories: foundDirectories,
    totalSize,
  };
}
