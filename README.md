<div align="center">

<img src="./assets/agy_reviewer_sensei_core_1792309690716.jpg" width="160" height="160" alt="AGY Reviewer Logo" style="border-radius: 24px; box-shadow: 0 8px 24px rgba(0, 242, 254, 0.25);" />

# AGY Code Reviewer Action 🤖

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-v1-blue?logo=github-actions&logoColor=white)](https://github.com/IpekoGosu/agy-reviewer-action)
[![Gemini](https://img.shields.io/badge/Model-Gemini%203.8%20Flash%20High-8E75C4?logo=google&logoColor=white)](https://ai.google.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%205.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**고정밀 자율형 AI 코드 리뷰어 & 인터랙티브 PR 어시스턴트**  
Google Gemini 3.8 Flash (Thinking Level: High) 기반으로 프로젝트 고유의 컨벤션과 아키텍처를 심층 분석하고, 실시간 대화형 협업을 제공합니다.

</div>

---

## 🌟 핵심 특장점 (Key Features)

### 1. 🎯 100% 자연스러운 한국어 심층 리뷰
- **총괄 요약 (PR Summary)**: PR의 변경 동기와 아키텍처적 파급력을 한국어로 종합 분석합니다.
- **신뢰도 점수 (Confidence Score, 1~5점)**: 단순한 승인/반려를 넘어 코드 무결성 수준을 직관적으로 평가합니다.
- **품질 검증 체크리스트**: 타입 안전성, 포맷팅 규칙, 도메인 불변식, 클래스 캡슐화 등을 항목별로 시각화합니다.
- **우선순위별 인라인 코멘트**:
  - 🔴 **P1 (Critical)**: 서비스 장애, 런타임 크래시, 메모리 누수, 심각한 보안 결함
  - 🟡 **P2 (Major)**: 도메인 불변식 위반, 성능 병목, 안티패턴, 예외 처리 누락
  - 🟢 **P3 (Minor)**: 네이밍, 가독성 향상, 경미한 타입 좁히기, 중복 코드 정리

### 2. 📚 프로젝트 고유 규칙 자동 학습 (Project-Aware)
- 리포지토리 루트 및 하위 경로에 위치한 컨벤션 문서를 자동으로 탐색하여 리뷰 기준에 완벽 반영합니다:
  - `AGENTS.md` (헌법 및 지침)
  - `CONVENTIONS.md` / `docs/coding-conventions.md`
  - `.gemini/styleguide.md`
  - 전역 엄격 규칙 (4 spaces 들여쓰기, 세미콜론 미사용, `any`/`unknown` 금지 등)

### 3. 🔄 스마트 재검토 & 리뷰 스레드 자동 해결 (Auto-Resolve)
- 새 커밋이 푸시되거나 `/review` 명령이 입력되면, 중복 댓글을 도배하지 않고 기존 리뷰를 갱신합니다.
- 최신 diff를 분석하여 이전에 지적된 문제가 올바르게 수정되었다고 판단되면, **GitHub Review Thread를 GraphQL API로 자동 'Resolved' 처리**합니다.

### 4. 💬 인터랙티브 멘션 & 실시간 질의응답
- **PR 본문/일반 댓글**: `@agy-reviewer-ksw` 또는 `@AGY`를 호출하여 아키텍처 트레이드오프나 테스트 전략을 질문할 수 있습니다.
- **인라인 코드 스레드**: 특정 코드 라인에서 멘션하여 대안 구현법이나 리팩터링 제안을 즉시 요청할 수 있습니다.
- **간편 명령어**: `/review` 또는 `/re-review` 입력 시 전체 대국 패보 및 PR 재검토를 즉각 트리거합니다.

### 5. 🛡️ 무결성 및 내결함성 설계 (Fault-Tolerant)
- **JSON 구문 복구 (`jsonrepair`)**: LLM이 반환하는 JSON의 제어 문자, 이스케이프 오류, 줄바꿈 파손을 자동으로 치유하여 파싱 에러를 원천 차단합니다.
- **GitHub 422 Line Resolution 자동 우회**: 변경 diff 범위 밖의 라인에 대한 댓글 작성 실패 시, 상단 리뷰 요약문의 `<details>` 섹션으로 안전하게 폴백하여 피드백 누락을 방지합니다.

---

## 🚀 빠른 시작 (Quick Start)

사용할 리포지토리의 `.github/workflows/agy-reviewer.yml`에 아래 워크플로우를 추가합니다.

### 권장: GitHub App 토큰 방식 (봇 프로필 및 자동 스레드 해결 지원)

```yaml
name: AGY Code Review

on:
    pull_request:
        types: [opened, synchronize, reopened]
    issue_comment:
        types: [created]
    pull_request_review_comment:
        types: [created]

jobs:
    review:
        # PR 대상 실행 및 봇 자신의 이벤트 무한 루프 방지
        if: >-
            (github.event_name == 'pull_request' ||
             (github.event_name == 'issue_comment' && github.event.issue.pull_request) ||
             github.event_name == 'pull_request_review_comment') &&
            github.actor != 'agy-reviewer-ksw[bot]' &&
            github.event.sender.login != 'agy-reviewer-ksw[bot]'
        runs-on: ubuntu-latest
        permissions:
            contents: write
            pull-requests: write
            issues: write

        steps:
            - name: Checkout Code
              uses: actions/checkout@v4

            - name: Generate GitHub App Token
              uses: actions/create-github-app-token@v1
              id: app-token
              with:
                  app-id: ${{ secrets.AGY_APP_ID }}
                  private-key: ${{ secrets.AGY_PRIVATE_KEY }}

            - name: Run AGY Code Reviewer
              uses: IpekoGosu/agy-reviewer-action@v1
              with:
                  gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
                  github-token: ${{ steps.app-token.outputs.token }}
                  thinking-level: 'HIGH'
                  bot-name: 'agy-reviewer-ksw'
                  bot-mention: '@agy-reviewer-ksw, @AGY'
```

---

## ⚙️ 설정 파라미터 (Inputs)

| 파라미터 | 설명 | 필수 여부 | 기본값 |
| :--- | :--- | :---: | :--- |
| `gemini-api-key` | Google AI Studio에서 발급받은 Gemini API 키 | **필수** | - |
| `github-token` | GitHub API 토큰 (`create-github-app-token` 출력 또는 `secrets.GITHUB_TOKEN`) | 선택 | `env.GITHUB_TOKEN` |
| `model` | 사용할 Gemini 모델 식별자 | 선택 | `'gemini-3.8-flash'` |
| `thinking-level` | 추론 깊이 (`LOW`, `MEDIUM`, `HIGH`) | 선택 | `'HIGH'` |
| `bot-name` | 봇 계정 명칭 (봇 루프 방지용) | 선택 | `'agy-reviewer-ksw'` |
| `bot-mention` | 봇 트리거 멘션 키워드 (쉼표 구분 다중 지원) | 선택 | `'@agy-reviewer-ksw, @AGY'` |
| `app-id` | GitHub App ID (직접 인증 시) | 선택 | - |
| `private-key` | GitHub App Private Key (.pem 내용) | 선택 | - |

---

## 🔐 GitHub App 권한 가이드

봇 프로필 이름 및 아바타로 피드백을 등록하고 리뷰 스레드를 해결하려면 GitHub App에 다음 권한이 필요합니다:

- **Repository Permissions**:
  - `Pull requests`: **Read & write** (인라인 리뷰 작성, 스레드 해결, diff 조회)
  - `Issues`: **Read & write** (PR 일반 댓글 및 멘션 응답)
  - `Contents`: **Read** (프로젝트 헌법 및 컨벤션 파일 읽기)
- **Subscribe to events**:
  - `Pull request`
  - `Issue comment`
  - `Pull request review comment`

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT License](LICENSE)에 따라 자유롭게 사용 및 수정할 수 있습니다.
