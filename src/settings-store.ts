import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  MAX_PERIODIC_MINUTES,
  MIN_PERIODIC_MINUTES,
  createDefaultSettings,
} from './config.js';
import { toCanonicalPathKey } from './cleanup-policy.js';
import type { AppSettings, ScanSet, WatchTarget } from './types.js';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  const normalized = asStringArray(value);
  return normalized.length > 0 ? normalized : undefined;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function isErrnoCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const errno = error as NodeJS.ErrnoException;
  return errno.code === code;
}

function sanitizeWatchTarget(raw: unknown): WatchTarget | null {
  if (!raw || typeof raw !== 'object') return null;

  const target = raw as Partial<WatchTarget>;
  const id = typeof target.id === 'string' && target.id.trim() ? target.id.trim() : null;
  const targetPath = typeof target.path === 'string' && target.path.trim() ? target.path.trim() : null;

  if (!id || !targetPath) return null;

  const out: WatchTarget = {
    id,
    path: targetPath,
    enabled: target.enabled !== false,
  };

  if (typeof target.targetThresholdBytes === 'number' && Number.isFinite(target.targetThresholdBytes) && target.targetThresholdBytes > 0) {
    out.targetThresholdBytes = Math.floor(target.targetThresholdBytes);
  }

  const only = asOptionalStringArray(target.only);
  const exclude = asOptionalStringArray(target.exclude);

  if (only) out.only = only;
  if (exclude) out.exclude = exclude;

  return out;
}

function sanitizeScanSet(raw: unknown): ScanSet | null {
  if (!raw || typeof raw !== 'object') return null;

  const set = raw as Partial<ScanSet>;
  const id = typeof set.id === 'string' && set.id.trim() ? set.id.trim() : null;
  const name = typeof set.name === 'string' && set.name.trim() ? set.name.trim() : null;

  if (!id || !name) return null;

  const paths = asStringArray(set.paths);
  if (paths.length === 0) return null;

  const now = new Date().toISOString();
  return {
    id,
    name,
    paths,
    createdAt: typeof set.createdAt === 'string' && set.createdAt ? set.createdAt : now,
    updatedAt: typeof set.updatedAt === 'string' && set.updatedAt ? set.updatedAt : now,
  };
}

function sanitizeWatchTargets(raw: unknown[]): WatchTarget[] {
  const seenPathKeys = new Set<string>();
  const output: WatchTarget[] = [];

  for (const item of raw) {
    const target = sanitizeWatchTarget(item);
    if (!target) continue;

    const pathKey = toCanonicalPathKey(target.path);
    if (seenPathKeys.has(pathKey)) continue;
    seenPathKeys.add(pathKey);
    output.push(target);
  }

  return output;
}

export function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const defaults = createDefaultSettings();
  const input = raw ?? {};

  const periodic = Math.max(
    MIN_PERIODIC_MINUTES,
    Math.min(MAX_PERIODIC_MINUTES, Math.floor(toNumber(input.periodicMinutes, defaults.periodicMinutes)))
  );

  const globalThreshold = Math.max(0, Math.floor(toNumber(input.globalThresholdBytes, defaults.globalThresholdBytes)));
  const alertCooldown = Math.max(0, Math.floor(toNumber(input.alertCooldownMinutes, defaults.alertCooldownMinutes)));

  const watchTargets = Array.isArray(input.watchTargets)
    ? sanitizeWatchTargets(input.watchTargets)
    : defaults.watchTargets;

  const scanSets = Array.isArray(input.scanSets)
    ? input.scanSets.map((set) => sanitizeScanSet(set)).filter((set): set is ScanSet => Boolean(set))
    : defaults.scanSets;

  return {
    autoStart: toBoolean(input.autoStart, defaults.autoStart),
    startupChoiceCompleted: toBoolean(input.startupChoiceCompleted, defaults.startupChoiceCompleted),
    // Tray-resident behavior is fixed by product policy.
    runInTray: true,
    periodicEnabled: toBoolean(input.periodicEnabled, defaults.periodicEnabled),
    periodicMinutes: periodic,
    realtimeEnabled: toBoolean(input.realtimeEnabled, defaults.realtimeEnabled),
    globalThresholdBytes: globalThreshold,
    alertCooldownMinutes: alertCooldown,
    watchTargets,
    scanSets,
  };
}

export function getSettingsPath(baseDir?: string): string {
  const root = baseDir ?? path.join(os.homedir(), '.dep-clean-gui');
  return path.join(root, 'settings.json');
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

export class SettingsStore {
  private readonly filePath: string;
  private cachedSettings?: AppSettings;

  constructor(baseDir?: string) {
    this.filePath = getSettingsPath(baseDir);
  }

  get path(): string {
    return this.filePath;
  }

  async load(): Promise<AppSettings> {
    if (this.cachedSettings) {
      return cloneSettings(this.cachedSettings);
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error;
      }

      const defaults = createDefaultSettings();
      await this.persist(defaults);
      this.cachedSettings = defaults;
      return cloneSettings(defaults);
    }

    let parsed: Partial<AppSettings>;
    try {
      parsed = JSON.parse(raw) as Partial<AppSettings>;
    } catch {
      await this.backupCorruptSettings(raw);
      const defaults = createDefaultSettings();
      await this.persist(defaults);
      this.cachedSettings = defaults;
      return cloneSettings(defaults);
    }

    const normalized = normalizeSettings(parsed);
    this.cachedSettings = normalized;

    if (!isDeepStrictEqual(parsed, normalized)) {
      await this.persist(normalized);
    }

    return cloneSettings(normalized);
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const normalized = normalizeSettings(settings);

    if (this.cachedSettings && isDeepStrictEqual(this.cachedSettings, normalized)) {
      return cloneSettings(this.cachedSettings);
    }

    await this.persist(normalized);
    this.cachedSettings = normalized;
    return cloneSettings(normalized);
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.load();
    const merged: AppSettings = {
      ...current,
      ...partial,
      watchTargets: partial.watchTargets ?? current.watchTargets,
      scanSets: partial.scanSets ?? current.scanSets,
    };

    return this.save(merged);
  }

  private async persist(settings: AppSettings): Promise<void> {
    await ensureParentDir(this.filePath);
    await fs.promises.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  private async backupCorruptSettings(raw: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(path.dirname(this.filePath), `settings.corrupt.${timestamp}.json`);
    await ensureParentDir(backupPath);
    await fs.promises.writeFile(backupPath, raw, 'utf-8');
  }
}
