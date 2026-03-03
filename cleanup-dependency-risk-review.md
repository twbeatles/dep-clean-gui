# 의존성 삭제 기능 구현 점검 리포트 (2026-03-03)

## 구현 반영 현황 (2026-03-03 업데이트)
- 본 문서의 우선순위 개선안은 코드에 일괄 반영됨.
- 핵심 반영:
  - 경로 canonical dedupe + 범위 검증 + 루트 경로 차단
  - approval TTL(15분) + 60초 sweep + `cleanup.cancel` IPC
  - 부분 실패 시 same approval 기반 `retryPreview` 재시도
  - 삭제 엔진 `force: true` 제거, `lstat` 선검증, 재시도 로직 추가
  - 정리 중 모니터 동시성 제어(`stop -> delete -> rescan -> start`)
  - 관련 자동 테스트 신규 추가
- 참고:
  - 아래 3~5장은 최초 점검 기준의 리스크/권고안을 보존한 이력 섹션임.

## 1) 검토 범위
- 참조 문서:
  - `README.md`
  - `README_KO.md`
  - `cladue.md` (요청하신 `claude.md`의 실제 파일명)
  - `docs/gui-transition-prd-tech-plan.md`
- 검토 코드:
  - `src/cleaner.ts`
  - `src/scanner.ts`
  - `src/scan-runner.ts`
  - `electron/main.ts`
  - `gui/src/App.tsx`
  - `src/settings-store.ts`
  - `test/*.test.ts`

## 2) 현재 삭제 플로우 요약
1. 렌더러에서 정리 미리보기 요청 (`cleanup.preview`)
2. 메인 프로세스에서 스캔 후 `approvalId` 발급 및 메모리 맵(`cleanupApprovals`)에 저장
3. 렌더러에서 선택 경로 전송 (`cleanup.confirmDelete`)
4. 메인 프로세스에서 승인 객체의 경로만 필터링해 `deleteDirectories` 실행
5. 성공/실패 집계 후 결과 반환

정책 부합 여부:
- `approval-first cleanup` 정책은 전반적으로 지켜지고 있음
- CLI 호환성은 유지되고 있음

## 3) 잠재적 문제점 (우선순위 순)

### [High] 중복 경로가 미리보기/삭제에 중복 포함되어 삭제 수/확보 용량 과대 집계 가능
- 근거 코드:
  - `src/scan-runner.ts:55` (타깃 정규화 키가 `id:path`)
  - `electron/main.ts:414` (승인 목록 필터 시 path 중복 제거 없음)
  - `src/cleaner.ts:12` (`force: true`로 동일 경로 2회 호출도 성공 처리 가능)
- 영향:
  - 동일 폴더가 여러 타깃(부모/자식, 중복 경로 설정)으로 들어오면 1개 폴더가 2건 이상 삭제 성공으로 카운트됨
  - `deletedCount`, `freedSize`가 실제보다 크게 나올 수 있음
- 재현 확인:
  - `runScan`에 부모/자식 경로를 함께 넣으면 동일 `node_modules` 경로가 2회 수집됨
  - 동일 경로 2개를 `deleteDirectories`에 넣으면 2건 모두 `success: true` 반환됨

### [High] 승인 토큰(approval) 수명/정리 정책 부재
- 근거 코드:
  - `electron/main.ts:92` (`cleanupApprovals` 맵)
  - `electron/main.ts:395` (preview 때 맵에 추가)
  - `electron/main.ts:427` (confirm 시에만 삭제)
  - `gui/src/App.tsx:1230` (취소 시 `setPreview(null)`만 수행, revoke IPC 없음)
- 영향:
  - 미리보기만 반복하고 취소하면 승인 객체가 계속 누적될 수 있음(메모리 누수 성격)
  - 오래된 승인 토큰이 살아 있어 의도치 않은 시점에 삭제 실행될 수 있음

### [Medium] 삭제 대상 경로 안전 가드 부족
- 근거 코드:
  - `electron/main.ts:370` (`cleanup.preview`에 전달된 paths를 직접 스캔 대상으로 사용)
  - `src/cleaner.ts:12` (실경로 검증/루트 보호 없이 바로 `rm`)
- 영향:
  - 잘못된 설정/수동 설정 파일 편집/비정상 입력 시 시스템 중요 경로까지 탐색/삭제 후보화될 위험
  - 특히 `bin`, `obj`, `vendor` 등 일반명 폴더가 프로젝트 외 경로에서도 매칭될 수 있음

### [Medium] `force: true`로 삭제 결과의 정확도가 떨어짐
- 근거 코드:
  - `src/cleaner.ts:12`
- 영향:
  - 이미 사라진 경로나 중복 실행도 성공으로 처리되어 운영 지표 왜곡 가능
  - 사용자 입장에서 "실제로 무엇이 삭제되었는지" 추적성이 약함

### [Medium] 부분 실패 후 재시도 단위가 불편함
- 근거 코드:
  - `electron/main.ts:427` (confirm 이후 approval 즉시 제거)
- 영향:
  - 일부 경로만 실패해도 기존 승인 컨텍스트를 재사용한 재시도가 불가
  - 대규모 정리 시 실패 경로만 재시도하기 위해 다시 전체 preview 필요

### [Medium] 삭제 작업과 실시간/주기 스캔 간 경합 가능성
- 근거 코드:
  - `electron/main.ts`의 cleanup 경로와 `WatchEngine` 동작이 분리되어 있음
  - `gui/src/App.tsx:728` (삭제 후 즉시 수동 스캔 수행)
- 영향:
  - 삭제 중 watcher 이벤트가 들어오면 추가 스캔이 겹쳐 I/O 부하, 결과 흔들림 가능

### [Low] 삭제 경로 관련 자동 테스트 부재
- 근거 코드:
  - `test/` 내 `deleteDirectories`, `cleanup.preview`, `cleanup.confirmDelete` 직접 검증 테스트 없음
- 영향:
  - 중복 경로/부분 실패/승인 만료/취소 정리 같은 회귀가 발생해도 사전 탐지가 어려움

## 4) 추가해야 할 항목 (권장 구현)

### A. 경로 중복 제거 + 표준화 (우선)
- 위치:
  - `cleanup.preview` 직후 또는 `cleanup.confirmDelete` 직전
- 제안:
  - 경로를 정규화한 키로 dedupe (`realpath`, Windows는 case-insensitive 처리 포함)
  - 동일 경로는 1건으로만 보관/삭제/집계
- 기대효과:
  - 삭제 건수/확보 용량 정확도 개선
  - 불필요한 중복 `rm` 호출 제거

### B. 승인 토큰 생명주기 관리
- 위치:
  - `electron/main.ts`
- 제안:
  - 승인 TTL(예: 10~30분) 도입
  - `cleanup.cancel` IPC 추가로 렌더러 취소 시 즉시 revoke
  - 주기적 sweep으로 만료 approval 정리
- 기대효과:
  - 메모리 누적 방지
  - 오래된 승인 재사용 위험 완화

### C. 삭제 안전 가드레일
- 위치:
  - `cleanup.preview`, `cleanup.confirmDelete`, `deleteDirectory`
- 제안:
  - 삭제 전 경로 검증:
    - 비어있는 경로/루트 경로 차단
    - 허용된 scan target 하위 경로인지 검증
    - 필요 시 사용자 데이터 폴더 밖 대량 삭제에 대한 2차 확인
- 기대효과:
  - 오삭제(특히 시스템 폴더) 위험 감소

### D. 삭제 실패 내구성 강화
- 위치:
  - `src/cleaner.ts`
- 제안:
  - Windows 락 파일 대응을 위한 짧은 재시도(예: EPERM/EBUSY 대상)
  - 실패 코드 분류(권한/사용중/경로없음) 후 UI 메시지 개선
- 기대효과:
  - 실제 성공률 향상
  - 문제 원인 파악 용이

### E. 모니터링과 삭제 작업의 동시성 제어
- 위치:
  - `electron/main.ts`, `src/watch-engine.ts`
- 제안:
  - 삭제 세션 동안 realtime enqueue 일시 정지 또는 저우선순위화
  - 삭제 완료 후 1회 리스캔만 실행하도록 조정
- 기대효과:
  - I/O 경쟁 완화
  - 결과 안정성 개선

### F. 테스트 보강 (회귀 방지)
- 신규 테스트 권장:
  - 중복 경로 preview/confirm 시 1회만 삭제되는지
  - approval 만료/취소 후 confirm 거부되는지
  - 부분 실패 후 실패 경로 재시도 플로우
  - 위험 경로(루트/비정상 경로) 차단 동작

## 5) 빠른 우선순위 제안
1. 중복 경로 dedupe + 집계 수정
2. approval TTL + cancel IPC
3. 삭제 경로 안전 검증
4. 삭제 실패 재시도/에러 분류
5. 테스트 보강
