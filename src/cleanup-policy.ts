import * as path from 'node:path';
import type { AppSettings, FoundDirectory } from './types.js';

export type CleanupPolicyErrorCode = 'pathOutOfScope' | 'rootPathNotAllowed';

export class CleanupPolicyError extends Error {
  constructor(
    public readonly code: CleanupPolicyErrorCode,
    public readonly targetPath: string
  ) {
    super(`${code}:${targetPath}`);
  }
}

function trimTrailingSeparatorsExceptRoot(inputPath: string): string {
  const normalized = path.normalize(path.resolve(inputPath));
  const root = path.parse(normalized).root;

  if (normalized === root) {
    return normalized;
  }

  return normalized.replace(/[\\/]+$/, '');
}

function toComparablePath(inputPath: string): string {
  const normalized = trimTrailingSeparatorsExceptRoot(inputPath).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function toCanonicalPathKey(inputPath: string): string {
  return toComparablePath(inputPath);
}

export function dedupeFoundDirectories(directories: FoundDirectory[]): FoundDirectory[] {
  const seen = new Set<string>();
  const output: FoundDirectory[] = [];

  for (const directory of directories) {
    const key = toCanonicalPathKey(directory.path);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(directory);
  }

  return output;
}

export function isRootPath(targetPath: string): boolean {
  const normalized = trimTrailingSeparatorsExceptRoot(targetPath);
  const root = trimTrailingSeparatorsExceptRoot(path.parse(path.resolve(targetPath)).root);
  return toComparablePath(normalized) === toComparablePath(root);
}

export function assertPathWithinAllowedRoots(targetPath: string, allowedRoots: string[]): void {
  const normalizedTarget = toComparablePath(targetPath);

  if (isRootPath(targetPath)) {
    throw new CleanupPolicyError('rootPathNotAllowed', targetPath);
  }

  for (const rootPath of allowedRoots) {
    const normalizedRoot = toComparablePath(rootPath);
    if (
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(`${normalizedRoot}/`)
    ) {
      return;
    }
  }

  throw new CleanupPolicyError('pathOutOfScope', targetPath);
}

export function collectRegisteredRoots(settings: AppSettings): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  const add = (inputPath: string): void => {
    const trimmed = inputPath.trim();
    if (!trimmed) return;
    const key = toCanonicalPathKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(path.resolve(trimmed));
  };

  for (const target of settings.watchTargets) {
    add(target.path);
  }

  for (const scanSet of settings.scanSets) {
    for (const setPath of scanSet.paths) {
      add(setPath);
    }
  }

  return output;
}

