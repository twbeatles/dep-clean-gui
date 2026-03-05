# dep-clean-gui

[English](./README.md) | Korean

원본 `dep-clean` CLI 프로젝트를 기반으로 GUI 상주 앱 기능을 확장한 포크 저장소입니다.
현재 저장소(`twbeatles/dep-clean-gui`)는 CLI 호환성을 유지하면서 데스크톱 상주 운영 흐름을 제공합니다.

## 포크 리포지토리 안내

- 이 저장소는 **포크 기반 리포지토리**입니다.
- 핵심 스캔/정리 로직은 기존 CLI 모델을 계승합니다.
- GUI 상주 UX와 배포 정책은 이 포크에서 확장 관리합니다.

## 이 포크에서 추가된 기능

- Electron + React 기반 데스크톱 GUI
- 하이브리드 감시(주기 스캔 + 실시간 감시)
- 선택 폴더 세트(일괄 스캔)
- 임계치 알림(전체 + 개별 타겟)
- 승인 기반 삭제 플로우
- 트레이 상주 라이프사이클(창 닫기 = 트레이 최소화)

## 사용자 실행 방식

일반 사용자는 `npm start`가 필요하지 않습니다.

1. 설치 패키지(`.exe` 등) 설치
2. 운영체제 앱 메뉴에서 실행
3. 첫 GUI 실행 시 시작 옵션 선택
4. 완전 종료는 트레이 메뉴 `Quit` 사용

## 시작/상주 정책

- 첫 GUI 실행 시 startup 선택 모달이 표시됩니다.
- `자동 시작 사용`: 로그인 시 트레이 모드로 실행
- `나중에`: 자동 시작 비활성 유지 (설정에서 변경 가능)
- 창 닫기는 항상 트레이 최소화로 동작합니다.

## 릴리스 정책

- Windows: GitHub Actions 자동 릴리스 (`v*` 태그 또는 수동 실행)
- macOS / Linux: 로컬 수동 패키징 스크립트 사용

설치 파일은 GitHub Releases에서 배포합니다.

## 패키징 용량 정책

- `electron-builder` 출력 디렉터리는 `release/`를 사용합니다 (`dist/` 미사용).
- `dist/`는 앱 컴파일 결과물만 보관합니다.
- 패키징 포함 대상은 런타임 필수 산출물로 제한합니다:
  - `dist/electron/**/*`
  - `dist/src/**/*`
  - `dist/gui/**/*`
  - `package.json`
- 소스맵/선언 파일(`*.map`, `*.d.ts`)은 패키지에서 제외합니다.
- Electron 로케일은 `en`, `ko`만 포함합니다.
- 압축 정책은 `maximum`을 사용합니다.

## CLI 호환성

기존 CLI 명령은 계속 사용 가능합니다.

```bash
dep-clean --help
dep-clean --dry-run
dep-clean --only node_modules,venv
dep-clean --exclude vendor,Pods
```

## 문서화 및 성능 스냅샷 (2026-03)

- **UI/UX 전면 리팩토링 완료**:
  - CSS 디자인 시스템 재설계 (좌측 사이드바 + 메인 콘텐츠 레이아웃)
  - 대시보드 메트릭 시각 계층 강화 및 목적별 버튼 섹션 분리
  - 커스텀 SVG 아이콘 및 상태 토글 스위치 도입
  - 사용자 친화적인 i18n 한국어/영문 텍스트 개선
  - 패널 진입, 호버, 상태 변화 시 부드러운 애니메이션 효과 적용
- 스캐너 코어는 반복형 순회 + 파일 stat 제한 동시성으로 동작합니다.
- 다중 타겟 스캔은 제한 병렬로 처리되어 watch/set 실행 속도를 개선했습니다.
- watcher 재구성은 watcher 관련 설정이 바뀐 경우에만 수행합니다.
- 실시간 이벤트 폭주 시 스캔 요청을 병합(coalescing)해 큐 적체를 방지합니다.
- GUI 설정 입력은 debounce + blur 커밋으로 IPC/디스크 쓰기 빈도를 줄였습니다.
- 알림 이력/정리 미리보기는 페이지네이션으로 대량 데이터 렌더링 부하를 낮췄습니다.
- CLI 플래그 및 승인 기반 삭제 정책은 그대로 유지됩니다.

## IPC 확장 (하위 호환)

- `alerts.list(options?: { limit?: number })`에 선택적 `limit` 인자를 추가했습니다.
- 옵션 없이 `alerts.list()`를 호출하면 기존 동작과 동일합니다.

## 정리(Cleanup) 안정성 강화 업데이트 (2026-03-03)

- 정리 미리보기는 canonical path 기준 중복 제거를 적용하여 삭제 건수/확보 용량 과대 집계를 방지합니다.
- 삭제 승인(approval)에 수명 정책을 추가했습니다.
  - TTL: `15분`
  - 백그라운드 만료 정리 주기: `60초`
- 정리 IPC/API가 확장되었습니다.
  - `cleanup.cancel(approvalId)` 추가
  - `CleanupPreview`에 `expiresAt` 포함
  - `cleanup.confirmDelete(...)`는 부분 실패가 남으면 `retryPreview`를 반환
- 정리 경로 안전 가드를 적용했습니다.
  - preview 입력 경로는 등록 루트(`watchTargets` + `scanSets`)만 허용
  - 실제 삭제 선택 경로는 승인된 루트 하위만 허용
  - 루트 경로는 정리 대상으로 거부
- 삭제 엔진 정확도를 강화했습니다.
  - `rm(..., force: true)` 제거
  - `lstat` 선검증
  - 일시적 파일 시스템 오류(`EPERM`, `EBUSY`, `ENOTEMPTY`) 재시도
- 모니터링과 정리 작업 경합을 줄이기 위해 실행을 직렬화했습니다.
  - 모니터링 중 정리 시 `stop -> delete -> 1회 rescan -> start`

## 신뢰성 안정화 업데이트 (2026-03-05)

- 스캔 알림 발송 경로를 단일화했습니다.
  - 수동/세트 스캔의 OS 알림은 `WatchEngine`의 스캔 완료 콜백에서만 발송됩니다.
  - IPC 핸들러 직접 발송을 제거해 중복 알림을 방지했습니다.
- watcher 오류는 fail-soft로 처리합니다.
  - watcher `error` 이벤트를 명시적으로 처리합니다.
  - 오류 watcher만 분리/종료하고 모니터링 런타임은 유지합니다.
  - 오류 정보는 startup diagnostics 로그로 기록됩니다.
- 설정 정규화/복구 안전성을 강화했습니다.
  - boolean 필드는 엄격한 boolean 검증 후 기본값으로 정규화합니다.
  - watch target은 canonical path 기준으로 중복 제거합니다.
  - `settings.json` 손상 시 기본값 복구 전 `settings.corrupt.<timestamp>.json` 백업을 생성합니다.
- cleanup 확정 API는 빈 선택 요청을 명시적으로 거부합니다.
- 렌더러의 남아 있던 하드코딩 UI 문자열을 i18n 키로 정리했습니다.

## Windows 패키징 브리지 안정성

- 패키징 실행 시 preload는 CommonJS(`dist/electron/preload.cjs`)로 빌드됩니다.
- Electron main은 `preload.cjs`를 명시적으로 로드하도록 고정되었습니다.
- 이 변경으로 패키징 실행 시 배경만 표시되고 UI가 동작하지 않던 preload 파싱 오류를 해결했습니다.

## 로케일 기반 UI (en/ko)

- 데스크톱 UI 언어는 OS/PC 로케일을 기준으로 자동 선택됩니다.
  - `ko*` -> 한국어
  - 그 외 -> 영어
- 적용 범위는 렌더러 UI, 트레이 메뉴, OS 알림, 폴더 선택 다이얼로그 제목입니다.
- CLI 동작/플래그는 변경하지 않습니다.

## 개발 명령

```bash
# 의존성 설치
npm ci

# 테스트
npm test

# 전체 빌드
npm run build

# GUI 렌더러만 빌드
npm run build:renderer

# GUI 개발 실행
npm run dev

# CLI 개발 실행
npm run dev:cli -- --help

# 빌드/패키징 산출물 정리
npm run clean

# 패키징
npm run package:win
npm run package:mac
npm run package:linux
```

## AI 세션 인수인계 문서

- [cladue.md](./cladue.md)
- [gemini.md](./gemini.md)

## 라이선스

MIT
