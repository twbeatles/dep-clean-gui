import type {
  AppScanResult,
  AppSettings,
  CleanupConfirmResult,
  CleanupPreview,
  ScanExecutionOutcome,
  ScanProgressEvent,
  ThresholdAlert,
  WatchStatus,
} from './types.js';

export interface DepCleanApi {
  settings: {
    get: () => Promise<AppSettings>;
    update: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  };
  scan: {
    runManual: (paths?: string[]) => Promise<ScanExecutionOutcome>;
    runSet: (setId: string) => Promise<ScanExecutionOutcome>;
    getLastResult: () => Promise<AppScanResult | null>;
    onProgress: (listener: (event: ScanProgressEvent) => void) => () => void;
    onCompleted: (listener: (event: ScanExecutionOutcome) => void) => () => void;
  };
  watch: {
    start: () => Promise<WatchStatus>;
    stop: () => Promise<WatchStatus>;
    status: () => Promise<WatchStatus>;
    onStatusChanged: (listener: (status: WatchStatus) => void) => () => void;
  };
  alerts: {
    list: () => Promise<ThresholdAlert[]>;
    markRead: (ids: string[]) => Promise<ThresholdAlert[]>;
    clear: () => Promise<ThresholdAlert[]>;
    onCreated: (listener: (alerts: ThresholdAlert[]) => void) => () => void;
  };
  cleanup: {
    preview: (paths?: string[]) => Promise<CleanupPreview>;
    confirmDelete: (approvalId: string, selectedPaths: string[]) => Promise<CleanupConfirmResult>;
  };
  folders: {
    pickMany: () => Promise<string[]>;
  };
}

declare global {
  interface Window {
    depClean: DepCleanApi;
  }
}
