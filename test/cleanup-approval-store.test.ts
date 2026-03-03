import * as path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CleanupApprovalStore,
  CleanupApprovalStoreError,
} from '../src/cleanup-approval-store.js';
import type { DeleteResult } from '../src/cleaner.js';
import type { FoundDirectory } from '../src/types.js';

function directoryAt(dirPath: string, size = 1): FoundDirectory {
  return {
    path: dirPath,
    name: path.basename(dirPath),
    size,
    relativePath: `./${path.basename(dirPath)}`,
  };
}

describe('CleanupApprovalStore', () => {
  it('dedupes preview directories', () => {
    const root = path.resolve('approval-preview-root');
    const duplicatePath = path.join(root, 'node_modules');
    const store = new CleanupApprovalStore({ ttlMs: 60_000 });

    const preview = store.createPreview({
      allowedRoots: [root],
      directories: [
        directoryAt(duplicatePath, 10),
        directoryAt(`${duplicatePath}${path.sep}..${path.sep}node_modules`, 20),
      ],
    });

    assert.equal(preview.directories.length, 1);
    assert.equal(preview.totalSize, 10);
  });

  it('throws when approval is expired', () => {
    let now = Date.now();
    const store = new CleanupApprovalStore({
      ttlMs: 10,
      nowMs: () => now,
    });
    const root = path.resolve('approval-expire-root');
    const preview = store.createPreview({
      allowedRoots: [root],
      directories: [directoryAt(path.join(root, 'node_modules'), 1)],
    });

    now += 20;

    assert.throws(
      () => store.confirmSelection(preview.approvalId, [path.join(root, 'node_modules')]),
      (error: unknown) =>
        error instanceof CleanupApprovalStoreError &&
        error.code === 'expired'
    );
  });

  it('supports idempotent cancel', () => {
    const root = path.resolve('approval-cancel-root');
    const store = new CleanupApprovalStore();
    const preview = store.createPreview({
      allowedRoots: [root],
      directories: [directoryAt(path.join(root, 'node_modules'), 1)],
    });

    store.cancel(preview.approvalId);
    store.cancel(preview.approvalId);

    assert.throws(
      () => store.confirmSelection(preview.approvalId, [path.join(root, 'node_modules')]),
      (error: unknown) =>
        error instanceof CleanupApprovalStoreError &&
        error.code === 'missing'
    );
  });

  it('keeps failed directories in retry preview', () => {
    const root = path.resolve('approval-retry-root');
    const okPath = path.join(root, 'ok', 'node_modules');
    const failPath = path.join(root, 'fail', 'node_modules');
    const store = new CleanupApprovalStore();
    const preview = store.createPreview({
      allowedRoots: [root],
      directories: [directoryAt(okPath, 5), directoryAt(failPath, 8)],
    });

    const selection = store.confirmSelection(preview.approvalId, [okPath, failPath]);
    assert.equal(selection.selectedDirectories.length, 2);

    const results: DeleteResult[] = [
      { success: true, path: okPath },
      { success: false, path: failPath, error: 'EPERM: busy' },
    ];
    const retryPreview = store.applyDeleteResults(preview.approvalId, results);

    assert.equal(retryPreview?.approvalId, preview.approvalId);
    assert.equal(retryPreview?.directories.length, 1);
    assert.equal(retryPreview?.directories[0]?.path, failPath);
    assert.equal(retryPreview?.totalSize, 8);
  });
});

