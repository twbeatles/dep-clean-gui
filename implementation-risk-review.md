# 기능 구현 리스크 점검 보고서 (2026-03-05)

## 구현 반영 현황 (2026-03-05 업데이트)

- 본 문서의 1~7번 개선 항목은 코드에 반영 완료됨.
- 핵심 반영:
  - 수동/세트 스캔의 OS 알림 중복 제거(스캔 완료 콜백 단일 경로)
  - watcher `error` fail-soft 처리(오류 watcher만 분리/종료, 모니터 유지)
  - 설정 boolean 엄격 정규화 + canonical path 기반 watch target dedupe
  - 손상된 설정 파일 백업(`settings.corrupt.<timestamp>.json`) 후 기본값 복구
  - cleanup 빈 선택 확정 요청 명시적 거부(`emptySelection`)
  - 렌더러 하드코딩 문자열 i18n 키로 치환
- 검증:
  - `npm test` 통과 (`33/33`)
  - `npm run build` 통과
- 참고:
  - 아래 1~7장은 최초 점검 시점의 리스크 이력 섹션으로 보존됨.

기준 문서:
- `README.md`
- `cladue.md`

검토 범위:
- `src/*`
- `electron/*`
- `gui/src/*`
- `test/*`

실행 확인:
- `npm test` 통과 (28/28)
- `npm run build` 통과

## 주요 발견 사항 (심각도 순)

### 1) [High] 수동/세트 스캔에서 OS 알림이 중복 발송됨
- 근거:
  - `electron/main.ts:447` ~ `electron/main.ts:450`
  - `electron/main.ts:453` ~ `electron/main.ts:461`
  - `electron/main.ts:638` ~ `electron/main.ts:644`
- 원인:
  - `scan.runManual`/`scan.runSet` IPC 핸들러에서 `sendOsNotifications(outcome)`를 호출하고,
  - 같은 스캔 완료를 `WatchEngine`의 `onScanCompleted` 콜백에서도 다시 `sendOsNotifications(outcome)` 호출.
- 영향:
  - 사용자 입장에서 동일 임계치 알림이 2회 표시되어 UX 저하.
  - 알림 수가 많을 때 노이즈 증가.
- 권장 조치:
  - 알림 발송을 한 경로로만 일원화.
  - 권장: `onScanCompleted`에서만 발송하고 IPC 핸들러의 직접 발송 제거.
- 추가 테스트:
  - `scan.runManual`/`scan.runSet` 각각 1회 실행 시 OS 알림 발송 횟수 1회 보장 테스트.

### 2) [High] 파일 감시 watcher의 `error` 이벤트 미처리로 프로세스 크래시 위험
- 근거:
  - `src/watch-engine.ts:196` ~ `src/watch-engine.ts:215`
- 원인:
  - chokidar watcher에 `add/change/unlink`만 연결되어 있고 `error` 이벤트 핸들링이 없음.
- 영향:
  - 권한 문제/네트워크 드라이브 이슈/경로 접근 오류 시 unhandled error로 앱 안정성 저하 가능.
- 권장 조치:
  - `watcher.on('error', ...)` 추가 후 로깅 + 상태 이벤트 전파.
  - 특정 대상 watcher 실패 시 전체 엔진 중단 대신 부분 격리(fail-soft) 전략 적용.
- 추가 테스트:
  - watcher `error` 발생 시 프로세스가 죽지 않고 상태가 유지/갱신되는 테스트.

### 3) [Medium] 설정 정규화에서 boolean 타입 강제 검증이 없어 비정상 설정값이 그대로 반영될 수 있음
- 근거:
  - `src/settings-store.ts:113` ~ `src/settings-store.ts:119`
- 원인:
  - `autoStart`, `startupChoiceCompleted`, `periodicEnabled`, `realtimeEnabled`에 대해 타입 검증 없이 `??`로만 기본값 처리.
- 영향:
  - 예: 설정 파일이 수동 편집/손상되어 문자열 `'false'`가 들어오면 truthy로 동작 가능.
  - 모니터링 동작과 UI 토글 상태가 기대와 달라질 수 있음.
- 권장 조치:
  - `toBoolean(value, fallback)` 유틸 도입해 명시적 타입 강제.
- 추가 테스트:
  - 문자열/숫자/`null` 입력 시 boolean 필드 정규화 결과 검증.

### 4) [Medium] 설정 파일 로드 실패 시 모든 오류를 기본값으로 덮어써 사용자 설정 유실 가능성
- 근거:
  - `src/settings-store.ts:157` ~ `src/settings-store.ts:172`
- 원인:
  - `load()`에서 read/parse/권한 등 모든 예외를 동일 처리(`persist(defaults)`).
- 영향:
  - 일시적 파일 오류나 JSON 파싱 오류 시 기존 설정이 즉시 초기화될 수 있음.
- 권장 조치:
  - `ENOENT`(최초 실행)와 그 외 오류 분리 처리.
  - 파싱 실패 시 원본 파일 백업(`settings.corrupt.<timestamp>.json`) 후 복구 유도.
- 추가 테스트:
  - 손상 JSON 케이스에서 자동 백업/초기화 절차 검증.

### 5) [Medium] Cleanup 승인 API가 빈 선택(`selectedPaths=[]`)을 유효 처리함
- 근거:
  - `src/cleanup-approval-store.ts:124` ~ `src/cleanup-approval-store.ts:143`
  - `electron/main.ts:541` ~ `electron/main.ts:567`
- 원인:
  - `confirmSelection`에서 선택 0건을 오류로 처리하지 않음.
- 영향:
  - UI는 막고 있지만, IPC 직접 호출/외부 클라이언트에서 no-op 확정을 반복할 수 있음.
  - API 계약이 애매해지고 운영 로그 해석이 어려워짐.
- 권장 조치:
  - `selectedDirectories.length === 0`일 때 명시적 에러 코드(`emptySelection`) 반환.
- 추가 테스트:
  - 빈 선택 요청 시 예측 가능한 오류 반환 검증.

### 6) [Low] Locale 기반 UI 정책과 달리 일부 UI 문자열이 하드코딩됨
- 근거:
  - `gui/src/App.tsx:244`
  - `gui/src/App.tsx:904`
  - `gui/src/App.tsx:990`
  - `gui/src/App.tsx:1131`
- 원인:
  - 번역 키를 쓰지 않고 문자열 리터럴 직접 출력.
- 영향:
  - 영어 로케일 사용자에게 한글 문구가 노출되어 일관성 저하.
  - `README.md`/`cladue.md`에 명시된 locale-based UI 정책과 불일치.
- 권장 조치:
  - 번역 키(`renderer-messages.ts`) 추가 후 App에서 `t(...)`로 교체.
- 추가 테스트:
  - `en`/`ko` 렌더링 스냅샷(또는 키 존재성) 테스트.

### 7) [Low] 동일 경로 watch target 중복 등록 가능(경로 정규화 기반 dedupe 부재)
- 근거:
  - `gui/src/App.tsx:644` ~ `gui/src/App.tsx:647`
  - `src/settings-store.ts:104` ~ `src/settings-store.ts:106`
  - `src/watch-engine.ts:191` ~ `src/watch-engine.ts:216`
- 원인:
  - UI dedupe가 문자열 완전일치 기준이고, 저장 단계에서도 canonical path 기준 dedupe가 없음.
- 영향:
  - 대소문자/슬래시 형태가 다른 동일 경로가 중복 watcher/중복 scan으로 이어질 수 있음(특히 Windows).
- 권장 조치:
  - 저장 직전 canonical path 기준 dedupe 적용.
- 추가 테스트:
  - `C:\Repo`, `c:\repo\` 입력 시 단일 target만 유지되는지 검증.

## 테스트 커버리지 관점의 보강 우선순위

1. 알림 중복 방지 회귀 테스트 (`scan.runManual`, `scan.runSet`).
2. watcher `error` 내구성 테스트 (프로세스 생존 + 상태 이벤트).
3. 설정 정규화 강건성 테스트 (boolean 타입 오염).
4. cleanup 빈 선택 API 계약 테스트.
5. i18n 키 누락 탐지 테스트.

## 결론

핵심 기능 자체(스캔/감시/정리)는 테스트 및 빌드 기준으로 안정적이지만, 실사용 품질에 직접 영향을 주는 항목은 다음 2개가 우선입니다.
- 알림 중복 발송
- watcher 오류 이벤트 미처리

해당 두 항목을 우선 수정하면 UX 안정성과 운영 안정성이 동시에 개선됩니다.
