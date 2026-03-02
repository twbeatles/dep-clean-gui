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

## CLI 호환성

기존 CLI 명령은 계속 사용 가능합니다.

```bash
dep-clean --help
dep-clean --dry-run
dep-clean --only node_modules,venv
dep-clean --exclude vendor,Pods
```

## 개발 명령

```bash
# 의존성 설치
npm ci

# 테스트
npm test

# 전체 빌드
npm run build

# GUI 개발 실행
npm run dev

# CLI 개발 실행
npm run dev:cli -- --help

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
