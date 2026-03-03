import type { SupportedLocale } from './locale.js';

type MessageDictionary = Record<string, string>;

const EN_MESSAGES = {
  'tray.monitor.stop': 'Stop Monitoring',
  'tray.monitor.start': 'Start Monitoring',
  'tray.runManualScan': 'Run Manual Scan',
  'tray.openApp': 'Open App',
  'tray.openSettingsFile': 'Open Settings File',
  'tray.quit': 'Quit',
  'dialog.selectFoldersTitle': 'Select folders',
  'notification.title.exceeded': 'dep-clean threshold exceeded',
  'notification.title.resolved': 'dep-clean threshold resolved',
  'notification.scope.global': 'Global',
  'notification.scope.target': 'Target',
  'notification.body': '{scope}: {value}',
  'error.startupFailedTitle': 'dep-clean-gui startup failed',
  'error.scanSetNotFound': 'Scan set not found: {setId}',
  'error.cleanupApprovalMissing': 'Approval request expired or missing.',
  'error.unknownCleanup': 'Unknown error',
} as const satisfies MessageDictionary;

const KO_MESSAGES = {
  'tray.monitor.stop': '모니터링 중지',
  'tray.monitor.start': '모니터링 시작',
  'tray.runManualScan': '수동 스캔 실행',
  'tray.openApp': '앱 열기',
  'tray.openSettingsFile': '설정 파일 열기',
  'tray.quit': '종료',
  'dialog.selectFoldersTitle': '폴더 선택',
  'notification.title.exceeded': 'dep-clean 임계치 초과',
  'notification.title.resolved': 'dep-clean 임계치 정상 복귀',
  'notification.scope.global': '전체',
  'notification.scope.target': '대상',
  'notification.body': '{scope}: {value}',
  'error.startupFailedTitle': 'dep-clean-gui 시작 실패',
  'error.scanSetNotFound': '스캔 세트를 찾을 수 없습니다: {setId}',
  'error.cleanupApprovalMissing': '삭제 승인 요청이 만료되었거나 존재하지 않습니다.',
  'error.unknownCleanup': '알 수 없는 오류',
} as const satisfies MessageDictionary;

export type MainMessageKey = keyof typeof EN_MESSAGES;

const MESSAGE_BY_LOCALE: Record<SupportedLocale, Record<MainMessageKey, string>> = {
  en: EN_MESSAGES,
  ko: KO_MESSAGES,
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}

export function translateMainMessage(
  locale: SupportedLocale,
  key: MainMessageKey,
  params?: Record<string, string | number>
): string {
  const template = MESSAGE_BY_LOCALE[locale][key] ?? MESSAGE_BY_LOCALE.en[key];
  return interpolate(template, params);
}
