# dep-clean-gui 기능 구현 점검 메모

작성일: 2026-04-16

상태 메모:
- 아래 항목들은 검토 시점의 구현 리스크 정리였습니다.
- 현재 작업 트리에서는 이번 요청으로 대응 코드, 테스트, 관련 문서 반영까지 완료했습니다.
- 이 문서는 변경 이력과 검토 근거를 남기기 위해 유지합니다.

참조 문서:
- `README.md`
- `README_KO.md`
- `cladue.md`
- `docs/gui-transition-prd-tech-plan.md`

검증:
- `npm test` 통과
- `npm run build` 통과

## 우선순위 높음

### 1. 부분 스캔이 기존 활성 알림을 잘못 `resolved` 처리할 수 있음

관련 코드:
- `src/alert-manager.ts`
- `src/watch-engine.ts`

초기 문제:
- 부분 스캔에서 이번 실행에 포함되지 않은 활성 알림 키까지 자동 `resolved` 처리될 수 있었습니다.

영향:
- 실제 상태와 다른 알림 이력/OS 알림이 발생할 수 있었습니다.

대응:
- 전체 스캔과 부분 스캔의 threshold 평가 범위를 분리했습니다.
- 부분 스캔은 관련 없는 기존 활성 알림을 자동 `resolved` 처리하지 않도록 수정했습니다.
- global threshold도 부분 스캔에서는 생략하도록 정리했습니다.

### 2. scan set 실행 시 개별 타겟 임계치 알림이 빠질 수 있음

관련 코드:
- `src/watch-engine.ts`
- `src/alert-manager.ts`

초기 문제:
- 개별 타겟 threshold가 `watchTarget.id` 기준인데 scan set 런타임 id는 별도로 생성되어 매칭이 끊길 수 있었습니다.

영향:
- scan set에서 per-target threshold alert가 누락될 수 있었습니다.

대응:
- canonical path 기준 매칭을 추가해서 scan set / 부분 스캔도 기존 watch target threshold를 안정적으로 재사용하게 했습니다.

## 중간 우선순위

### 3. watcher 오류 후 모니터가 켜진 것처럼 보이지만 일부 감시는 빠질 수 있음

관련 코드:
- `src/watch-engine.ts`
- `gui/src/App.tsx`

초기 문제:
- watcher error 이후 런타임은 살아 있지만 일부 대상 감시는 빠진 상태가 UI에 충분히 드러나지 않았습니다.

영향:
- 사용자가 모니터가 정상 동작 중이라고 오해할 수 있었습니다.

대응:
- `WatchStatus`에 `failedWatcherCount`, `degraded`, `failedWatchTargets`를 추가했습니다.
- 실패 타겟 자동 재시도 로직을 넣었습니다.
- renderer에 복구 중 상태와 대상 경로를 노출했습니다.

### 4. `alerts.json` 저장/복구 안전성이 `settings.json`보다 약함

관련 코드:
- `src/alert-manager.ts`
- 비교: `src/settings-store.ts`

초기 문제:
- 알림 이력은 손상 시 조용히 초기화될 수 있고, 저장도 원자적이지 않았습니다.

영향:
- 비정상 종료 시 알림 이력 유실 가능성이 있었습니다.

대응:
- temp file replacement 방식으로 저장을 변경했습니다.
- 손상된 알림 이력은 `alerts.corrupt.<timestamp>.json`으로 백업 후 복구하도록 수정했습니다.

## 낮지만 보완 가치가 있는 부분

### 5. 일부 렌더러 비동기 핸들러의 예외 처리 일관성이 약함

관련 코드:
- `gui/src/App.tsx`

초기 문제:
- 폴더 선택, 알림 읽음/초기화 등 일부 액션은 실패 시 사용자 메시지가 일관되지 않았습니다.

대응:
- 관련 비동기 핸들러를 `try/catch`로 정리하고 `setErrorMessage()`로 연결했습니다.

### 6. cleanup preview가 비어 있을 때 빈 모달 UX가 나올 수 있음

관련 코드:
- `electron/main.ts`
- `gui/src/App.tsx`

초기 문제:
- 삭제 후보가 0개여도 빈 확인 모달이 열릴 수 있었습니다.

대응:
- 0건 preview는 모달 대신 명시적 안내 메시지를 보여주도록 수정했습니다.

## 추가된 테스트

- 부분 스캔에서 false `resolved`가 발생하지 않는지
- 부분 스캔에서 global threshold가 잘못 해제되지 않는지
- scan set / 부분 스캔이 canonical path 기준으로 target threshold를 매칭하는지
- 손상된 `alerts.json` 백업 복구가 동작하는지
- watcher degraded 상태가 자동 재시도로 회복되는지

## 총평

현재는 기능 구현상 핵심 리스크였던 알림 정확도, watcher 복구 가시성, 알림 이력 저장 안정성, cleanup preview 빈 상태 UX가 모두 보강된 상태입니다.
테스트와 빌드도 통과했으며, 관련 README/기술 문서/handoff 문서까지 함께 업데이트했습니다.
