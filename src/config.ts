import type { AppSettings } from './types.js';

export const DEFAULT_TARGETS: string[] = [
  // JavaScript/Node.js
  'node_modules',
  '.next',
  'dist',
  'build',
  '.parcel-cache',
  '.turbo',

  // Python
  'venv',
  '.venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.egg-info',

  // Java/Kotlin
  'target',
  '.gradle',

  // Rust (target already included above)

  // Go
  'vendor',

  // Ruby
  'vendor/bundle',

  // PHP (vendor already included above)

  // .NET
  'bin',
  'obj',
  'packages',

  // iOS/macOS
  'Pods',
  'DerivedData',
];

export const SKIP_DIRECTORIES: string[] = [
  '.git',
  '.svn',
  '.hg',
];

export const DEFAULT_PERIODIC_MINUTES = 60;
export const MIN_PERIODIC_MINUTES = 5;
export const MAX_PERIODIC_MINUTES = 1440;
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 30;

export const DEFAULT_GLOBAL_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export function createDefaultSettings(): AppSettings {
  return {
    autoStart: false,
    startupChoiceCompleted: false,
    runInTray: true,
    periodicEnabled: true,
    periodicMinutes: DEFAULT_PERIODIC_MINUTES,
    realtimeEnabled: true,
    globalThresholdBytes: DEFAULT_GLOBAL_THRESHOLD_BYTES,
    alertCooldownMinutes: DEFAULT_ALERT_COOLDOWN_MINUTES,
    watchTargets: [],
    scanSets: [],
  };
}
