import { randomUUID } from 'node:crypto';
import type { DeleteResult } from './cleaner.js';
import {
  assertPathWithinAllowedRoots,
  CleanupPolicyError,
  dedupeFoundDirectories,
  toCanonicalPathKey,
} from './cleanup-policy.js';
import type { CleanupPreview, FoundDirectory } from './types.js';

const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export interface CleanupApprovalRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  allowedRoots: string[];
  pendingDirectories: FoundDirectory[];
}

export interface CleanupApprovalSelection {
  approvalId: string;
  allowedRoots: string[];
  selectedDirectories: FoundDirectory[];
}

export type CleanupApprovalStoreErrorCode =
  | 'missing'
  | 'expired'
  | 'emptySelection'
  | 'pathOutOfScope'
  | 'rootPathNotAllowed';

export class CleanupApprovalStoreError extends Error {
  constructor(
    public readonly code: CleanupApprovalStoreErrorCode,
    public readonly targetPath?: string
  ) {
    super(code);
  }
}

interface CleanupApprovalStoreOptions {
  ttlMs?: number;
  nowMs?: () => number;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const inputPath of paths) {
    const trimmed = inputPath.trim();
    if (!trimmed) continue;

    const key = toCanonicalPathKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }

  return output;
}

function cloneDirectory(directory: FoundDirectory): FoundDirectory {
  return { ...directory };
}

function cloneRecord(record: CleanupApprovalRecord): CleanupApprovalRecord {
  return {
    id: record.id,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    allowedRoots: [...record.allowedRoots],
    pendingDirectories: record.pendingDirectories.map(cloneDirectory),
  };
}

function toPreview(record: CleanupApprovalRecord): CleanupPreview {
  const directories = record.pendingDirectories.map(cloneDirectory);
  return {
    approvalId: record.id,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    directories,
    totalSize: directories.reduce((sum, directory) => sum + directory.size, 0),
  };
}

export class CleanupApprovalStore {
  private readonly approvals = new Map<string, CleanupApprovalRecord>();
  private readonly ttlMs: number;
  private readonly nowMs: () => number;

  constructor(options: CleanupApprovalStoreOptions = {}) {
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS);
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  createPreview(input: { directories: FoundDirectory[]; allowedRoots: string[] }): CleanupPreview {
    this.pruneExpired();

    const nowMs = this.nowMs();
    const dedupedDirectories = dedupeFoundDirectories(input.directories);
    const allowedRoots = dedupePaths(input.allowedRoots);

    if (allowedRoots.length > 0) {
      for (const directory of dedupedDirectories) {
        this.assertWithinAllowedRoots(directory.path, allowedRoots);
      }
    }

    const record: CleanupApprovalRecord = {
      id: randomUUID(),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + this.ttlMs).toISOString(),
      allowedRoots,
      pendingDirectories: dedupedDirectories.map(cloneDirectory),
    };

    this.approvals.set(record.id, record);
    return toPreview(record);
  }

  confirmSelection(approvalId: string, selectedPaths: string[]): CleanupApprovalSelection {
    const approval = this.getActiveApprovalOrThrow(approvalId);

    const selectedPathKeys = new Set<string>();
    for (const selectedPath of selectedPaths) {
      const trimmed = selectedPath.trim();
      if (!trimmed) continue;
      this.assertWithinAllowedRoots(trimmed, approval.allowedRoots);
      selectedPathKeys.add(toCanonicalPathKey(trimmed));
    }

    const selectedDirectories = approval.pendingDirectories
      .filter((directory) => selectedPathKeys.has(toCanonicalPathKey(directory.path)))
      .map(cloneDirectory);

    if (selectedDirectories.length === 0) {
      throw new CleanupApprovalStoreError('emptySelection');
    }

    return {
      approvalId: approval.id,
      allowedRoots: [...approval.allowedRoots],
      selectedDirectories,
    };
  }

  applyDeleteResults(approvalId: string, results: DeleteResult[]): CleanupPreview | null {
    const approval = this.getActiveApprovalOrThrow(approvalId);

    const successPathKeys = new Set<string>();
    for (const result of results) {
      if (!result.success) continue;
      successPathKeys.add(toCanonicalPathKey(result.path));
    }

    if (successPathKeys.size > 0) {
      approval.pendingDirectories = approval.pendingDirectories.filter((directory) => {
        return !successPathKeys.has(toCanonicalPathKey(directory.path));
      });
    }

    if (approval.pendingDirectories.length === 0) {
      this.approvals.delete(approval.id);
      return null;
    }

    this.approvals.set(approval.id, approval);
    return toPreview(approval);
  }

  cancel(approvalId: string): void {
    this.approvals.delete(approvalId);
  }

  pruneExpired(): number {
    const nowMs = this.nowMs();
    let removed = 0;

    for (const [approvalId, approval] of this.approvals.entries()) {
      const expiresAtMs = Date.parse(approval.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        this.approvals.delete(approvalId);
        removed += 1;
      }
    }

    return removed;
  }

  private getActiveApprovalOrThrow(approvalId: string): CleanupApprovalRecord {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new CleanupApprovalStoreError('missing');
    }

    const expiresAtMs = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.nowMs()) {
      this.approvals.delete(approval.id);
      throw new CleanupApprovalStoreError('expired');
    }

    return cloneRecord(approval);
  }

  private assertWithinAllowedRoots(targetPath: string, allowedRoots: string[]): void {
    try {
      assertPathWithinAllowedRoots(targetPath, allowedRoots);
    } catch (error) {
      if (error instanceof CleanupPolicyError) {
        if (error.code === 'rootPathNotAllowed') {
          throw new CleanupApprovalStoreError('rootPathNotAllowed', error.targetPath);
        }
        throw new CleanupApprovalStoreError('pathOutOfScope', error.targetPath);
      }
      throw error;
    }
  }
}
