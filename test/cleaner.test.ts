import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteDirectories, deleteDirectory } from '../src/cleaner.js';
import type { FoundDirectory } from '../src/types.js';

const tempRoots: string[] = [];

function foundDirectory(dirPath: string): FoundDirectory {
  return {
    path: dirPath,
    name: path.basename(dirPath),
    size: 1,
    relativePath: `./${path.basename(dirPath)}`,
  };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('cleaner', () => {
  it('deletes existing directory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-cleaner-ok-'));
    tempRoots.push(root);
    const target = path.join(root, 'node_modules');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'a.txt'), 'a');

    const result = await deleteDirectory(foundDirectory(target));

    assert.equal(result.success, true);
    assert.equal(existsSync(target), false);
  });

  it('reports missing path as failure', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-cleaner-missing-'));
    tempRoots.push(root);
    const missingPath = path.join(root, 'missing-node-modules');

    const result = await deleteDirectory(foundDirectory(missingPath));

    assert.equal(result.success, false);
    assert.equal(result.error?.includes('ENOENT'), true);
  });

  it('retries retryable delete errors and succeeds', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-cleaner-retry-'));
    tempRoots.push(root);
    const target = path.join(root, 'node_modules');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'a.txt'), 'a');

    let rmCallCount = 0;
    const result = await deleteDirectory(foundDirectory(target), {
      lstat: fs.promises.lstat,
      rm: async () => {
        rmCallCount += 1;
        if (rmCallCount < 3) {
          const error = new Error('busy') as NodeJS.ErrnoException;
          error.code = 'EBUSY';
          throw error;
        }
        await fs.promises.rm(target, { recursive: true, force: false });
      },
      sleep: async () => Promise.resolve(),
    });

    assert.equal(result.success, true);
    assert.equal(rmCallCount, 3);
  });

  it('keeps progress callback contract', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-cleaner-progress-'));
    tempRoots.push(root);

    const first = path.join(root, 'node_modules');
    const second = path.join(root, 'venv');
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });

    const progress: string[] = [];
    const results = await deleteDirectories(
      [foundDirectory(first), foundDirectory(second)],
      (current, total, directory) => {
        progress.push(`${current}/${total}:${directory.name}`);
      }
    );

    assert.equal(results.length, 2);
    assert.equal(progress.length, 2);
    assert.equal(progress[0].startsWith('1/2'), true);
  });
});
