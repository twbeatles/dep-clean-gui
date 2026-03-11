export interface FoundDirectory {
  path: string;
  name: string;
  size: number;
  relativePath: string;
}

export interface ScanOptions {
  targetDir: string;
  only?: string[];
  exclude?: string[];
}

export interface CleanOptions {
  dryRun: boolean;
  yes: boolean;
}

export interface CliOptions {
  yes: boolean;
  only?: string;
  exclude?: string;
  dryRun: boolean;
}

export interface ScanResult {
  directories: FoundDirectory[];
  totalSize: number;
}

export interface WatchTarget {
  id: string;
  path: string;
  enabled: boolean;
  targetThresholdBytes?: number;
  only?: string[];
  exclude?: string[];
}

export interface ScanSet {
  id: string;
  name: string;
  paths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  autoStart: boolean;
  startupChoiceCompleted: boolean;
  runInTray: boolean;
  periodicEnabled: boolean;
  periodicMinutes: number;
  realtimeEnabled: boolean;
  globalThresholdBytes: number;
  alertCooldownMinutes: number;
  watchTargets: WatchTarget[];
  scanSets: ScanSet[];
}

export interface TargetScanSummary {
  targetId: string;
  targetPath: string;
  totalSize: number;
  directories: FoundDirectory[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export type ScanSource = 'manual' | 'scan-set' | 'watch-periodic' | 'watch-realtime';

export interface AppScanResult {
  runId: string;
  source: ScanSource;
  setId?: string;
  startedAt: string;
  finishedAt: string;
  targets: TargetScanSummary[];
  totalSize: number;
  directoryCount: number;
}

export type AlertScope = 'global' | 'target';

export type AlertStatus = 'exceeded' | 'resolved';

export interface ThresholdAlert {
  id: string;
  scope: AlertScope;
  targetId?: string;
  targetPath?: string;
  currentBytes: number;
  thresholdBytes: number;
  status: AlertStatus;
  timestamp: string;
  read: boolean;
}

export interface WatchStatus {
  running: boolean;
  periodicEnabled: boolean;
  realtimeEnabled: boolean;
  watcherCount: number;
  nextRunAt?: string;
  lastRunAt?: string;
}

export type ScanProgressPhase = 'started' | 'completed';

export interface ScanProgressEvent {
  runId: string;
  source: ScanSource;
  phase: ScanProgressPhase;
  started: number;
  completed: number;
  total: number;
  targetId: string;
  targetPath: string;
}

export interface CleanupPreview {
  approvalId: string;
  createdAt: string;
  expiresAt: string;
  directories: FoundDirectory[];
  totalSize: number;
}

export interface CleanupFailure {
  path: string;
  error: string;
}

export interface CleanupConfirmResult {
  deletedCount: number;
  freedSize: number;
  failures: CleanupFailure[];
  retryPreview?: CleanupPreview;
}

export interface ScanExecutionOutcome {
  scanResult: AppScanResult;
  alerts: ThresholdAlert[];
}
