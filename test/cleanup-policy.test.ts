import * as path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSettings } from '../src/config.js';
import {
  CleanupPolicyError,
  assertPathWithinAllowedRoots,
  collectRegisteredRoots,
  dedupeFoundDirectories,
  isRootPath,
  toCanonicalPathKey,
} from '../src/cleanup-policy.js';
import type { FoundDirectory } from '../src/types.js';

function makeDirectory(dirPath: string, size = 1): FoundDirectory {
  return {
    path: dirPath,
    name: path.basename(dirPath),
    size,
    relativePath: `./${path.basename(dirPath)}`,
  };
}

describe('cleanup-policy', () => {
  it('dedupes directories by canonical path', () => {
    const root = path.resolve('tmp-cleanup-policy');
    const dupA = path.join(root, 'node_modules');
    const dupB = process.platform === 'win32' ? dupA.toUpperCase() : `${dupA}${path.sep}..${path.sep}node_modules`;

    const deduped = dedupeFoundDirectories([
      makeDirectory(dupA, 10),
      makeDirectory(dupB, 20),
    ]);

    assert.equal(deduped.length, 1);
    assert.equal(toCanonicalPathKey(deduped[0].path), toCanonicalPathKey(dupA));
  });

  it('detects root path', () => {
    const root = path.parse(path.resolve(process.cwd())).root;
    assert.equal(isRootPath(root), true);
  });

  it('throws when target path is outside allowed roots', () => {
    const allowedRoot = path.resolve('workspace-a');
    const disallowed = path.resolve('workspace-b', 'node_modules');

    assert.throws(
      () => assertPathWithinAllowedRoots(disallowed, [allowedRoot]),
      (error: unknown) =>
        error instanceof CleanupPolicyError &&
        error.code === 'pathOutOfScope'
    );
  });

  it('collects watch target and scan set roots including disabled targets', () => {
    const settings = createDefaultSettings();
    settings.watchTargets = [
      { id: 't1', path: path.resolve('repo-a'), enabled: false },
      { id: 't2', path: path.resolve('repo-b'), enabled: true },
    ];
    settings.scanSets = [
      {
        id: 'set-1',
        name: 'set',
        paths: [path.resolve('repo-c'), path.resolve('repo-a')],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const roots = collectRegisteredRoots(settings);
    const keys = new Set(roots.map((item) => toCanonicalPathKey(item)));

    assert.equal(keys.has(toCanonicalPathKey(path.resolve('repo-a'))), true);
    assert.equal(keys.has(toCanonicalPathKey(path.resolve('repo-b'))), true);
    assert.equal(keys.has(toCanonicalPathKey(path.resolve('repo-c'))), true);
    assert.equal(roots.length, 3);
  });
});

