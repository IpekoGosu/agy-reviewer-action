# AGY Code Reviewer Action 🤖

High-precision autonomous AI code reviewer and interactive PR assistant powered by **Gemini 3.8 Flash High**.

---

## ✨ Key Features

1. **Autonomous PR Reviews**:
   - Analyzes PR diffs against repository-specific conventions (`AGENTS.md`, `CONVENTIONS.md`, `docs/coding-conventions.md`) and global clean code standards.
   - Provides high-level **PR Summary**, **Confidence Score (1-5/5)**, and a **Code Quality & Convention Checklist**.
   - Posts line-by-line inline review comments categorized into **P1 (Critical)**, **P2 (Major)**, and **P3 (Minor)** with actionable code suggestions.
2. **In-Place Re-Reviews & Thread Auto-Resolution**:
   - When new commits are pushed or `/review` is requested, the bot updates its existing review in-place instead of spamming duplicate summary comments.
   - Automatically inspects resolved issues and resolves GitHub review threads via GraphQL.
3. **Interactive Mentions & Chat**:
   - **PR Discussion**: Mention `@agy-reviewer-ksw` or `@AGY` in the PR conversation tab to ask questions about architecture, trade-offs, or testing strategies.
   - **Inline Code Discussions**: Reply to any inline comment with `@agy-reviewer-ksw` or `@AGY` to request clarifications, alternative implementations, or refactoring.
4. **Commands**:
   - `/review` or `/re-review`: Manually triggers a re-review of the pull request.

---

## 🚀 Quick Start (Add to any repository)

Create `.github/workflows/agy-review.yml` in your target repository:

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
    # Avoid responding to bot's own comments
    if: github.actor != 'agy-reviewer-ksw[bot]' && github.event.sender.type != 'Bot'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Run AGY Code Reviewer
        uses: IpekoGosu/agy-reviewer-action@main
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          app-id: ${{ secrets.AGY_APP_ID }}
          private-key: ${{ secrets.AGY_PRIVATE_KEY }}
          bot-name: 'agy-reviewer-ksw'
          bot-mention: '@agy-reviewer-ksw'
```

---

## ⚙️ Configuration Inputs

| Input | Description | Required | Default |
| :--- | :--- | :---: | :--- |
| `gemini-api-key` | Google Gemini API Key from Google AI Studio | **Yes** | - |
| `app-id` | GitHub App ID for posting as bot | No | - |
| `private-key` | GitHub App Private Key (.pem file content) | No | - |
| `github-token` | GitHub token (alternative to App ID & Private Key) | No | `process.env.GITHUB_TOKEN` |
| `model` | Gemini model identifier | No | `'gemini-3.8-flash'` |
| `thinking-level` | Reasoning depth (`LOW`, `MEDIUM`, `HIGH`) | No | `'HIGH'` |
| `bot-name` | Bot account identifier | No | `'agy-reviewer-ksw'` |
| `bot-mention` | Primary mention trigger string | No | `'@agy-reviewer-ksw'` |

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
