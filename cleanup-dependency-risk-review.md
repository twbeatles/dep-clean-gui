# 의존성 정리 리스크 리뷰 기록 (Archive)

## 반영 현황

### 2026-03-03 1차 반영 (Cleanup Hardening)
- canonical path dedupe + 루트 경로 차단 + 승인 범위 검증
- approval TTL(15분) + 60초 만료 sweep + `cleanup.cancel`
- 부분 실패 시 `retryPreview` 기반 재시도
- 삭제 엔진 `force: true` 제거 + `lstat` 선검증 + 재시도(`EPERM`, `EBUSY`, `ENOTEMPTY`)
- 정리 시 모니터 직렬화(`watch.stop -> delete -> rescan -> watch.start`)

### 2026-03-05 2차 반영 (Reliability Hardening)
- 수동/세트 스캔 OS 알림 중복 제거(스캔 완료 콜백 단일 발송)
- watcher `error` fail-soft 처리(오류 watcher만 분리, 런타임 유지)
- 설정 boolean 엄격 정규화 + watch target canonical dedupe
- 손상된 설정 파일 백업 후 기본값 복구(`settings.corrupt.<timestamp>.json`)
- cleanup 빈 선택 요청 명시적 거부(`emptySelection`)
- 렌더러 하드코딩 문자열 i18n 키로 정리

## 참고 문서
- `implementation-risk-review.md`
- `docs/gui-transition-prd-tech-plan.md`
- `README.md`
- `README_KO.md`

## 검증
- `npm test` 통과
- `npm run build` 통과
