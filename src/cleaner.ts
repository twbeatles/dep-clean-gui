import * as fs from 'node:fs';
import type { FoundDirectory } from './types.js';

export interface DeleteResult {
  success: boolean;
  path: string;
  error?: string;
}

interface CleanerHooks {
  lstat?: typeof fs.promises.lstat;
  rm?: typeof fs.promises.rm;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_DELETE_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const DELETE_MAX_RETRIES = 3;
const DELETE_RETRY_DELAY_MS = 120;

function asErrnoException(error: unknown): NodeJS.ErrnoException | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return error as NodeJS.ErrnoException;
}

function formatDeleteError(error: unknown): string {
  const errno = asErrnoException(error);
  if (errno && 'code' in errno) {
    const code = String(errno.code ?? '');
    const message = String(errno.message ?? '');
    return code ? `${code}: ${message}` : message;
  }
  return error instanceof Error ? error.message : String(error);
}

function isPathMissingError(error: unknown): boolean {
  const errno = asErrnoException(error);
  return Boolean(errno && errno.code === 'ENOENT');
}

function isRetryableDeleteError(error: unknown): boolean {
  const errno = asErrnoException(error);
  return Boolean(errno && RETRYABLE_DELETE_ERROR_CODES.has(String(errno.code)));
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function deleteDirectory(
  dir: FoundDirectory,
  hooks: CleanerHooks = {}
): Promise<DeleteResult> {
  const lstat = hooks.lstat ?? fs.promises.lstat;
  const remove = hooks.rm ?? fs.promises.rm;
  const sleep = hooks.sleep ?? defaultSleep;

  try {
    await lstat(dir.path);
  } catch (error) {
    if (isPathMissingError(error)) {
      return {
        success: false,
        path: dir.path,
        error: 'ENOENT: Path not found.',
      };
    }
    return {
      success: false,
      path: dir.path,
      error: formatDeleteError(error),
    };
  }

  for (let attempt = 1; attempt <= DELETE_MAX_RETRIES; attempt++) {
    try {
      await remove(dir.path, { recursive: true, force: false });
      return { success: true, path: dir.path };
    } catch (error) {
      const shouldRetry = attempt < DELETE_MAX_RETRIES && isRetryableDeleteError(error);
      if (shouldRetry) {
        await sleep(DELETE_RETRY_DELAY_MS * attempt);
        continue;
      }

      return {
        success: false,
        path: dir.path,
        error: formatDeleteError(error),
      };
    }
  }

  return {
    success: false,
    path: dir.path,
    error: 'Delete failed after retries.',
  };
}

export async function deleteDirectories(
  directories: FoundDirectory[],
  onProgress?: (current: number, total: number, dir: FoundDirectory) => void,
  hooks?: CleanerHooks
): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];

  for (let i = 0; i < directories.length; i++) {
    const dir = directories[i];

    if (onProgress) {
      onProgress(i + 1, directories.length, dir);
    }

    const result = await deleteDirectory(dir, hooks);
    results.push(result);
  }

  return results;
}
