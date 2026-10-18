import { ContextLoader } from './context-loader.js'
import { GeminiClient } from './gemini-client.js'
import { GithubClient } from './github-client.js'
import { ExistingReview, InlineCommentFinding, ReviewAnalysis } from './types.js'

export class ReviewerEngine {
    private readonly githubClient: GithubClient
    private readonly geminiClient: GeminiClient
    private readonly contextLoader: ContextLoader
    private readonly botName: string

    public constructor(
        githubClient: GithubClient,
        geminiClient: GeminiClient,
        contextLoader: ContextLoader,
        botName: string
    ) {
        this.githubClient = githubClient
        this.geminiClient = geminiClient
        this.contextLoader = contextLoader
        this.botName = botName
    }

    public async runReview(prNumber: number, forceReReview: boolean): Promise<void> {
        const pr = await this.githubClient.getPullRequest(prNumber)
        const diff = await this.githubClient.getPullRequestDiff(prNumber)
        const projectRules = this.contextLoader.loadProjectContext()

        const existingReviews = await this.githubClient.listReviews(prNumber)
        const botReview = this.findBotReview(existingReviews)

        if (botReview && (forceReReview || botReview.commitId !== pr.headRefOid)) {
            await this.performReReview(prNumber, pr, diff, botReview, projectRules)
            return
        }

        if (!botReview) {
            await this.performFirstReview(prNumber, pr, diff, projectRules)
        }
    }

    private async performFirstReview(
        prNumber: number,
        pr: { readonly title: string; readonly body: string; readonly headRefOid: string },
        diff: string,
        projectRules: string
    ): Promise<void> {
        const analysis = await this.geminiClient.analyzeReview(
            { title: pr.title, body: pr.body, diff },
            projectRules
        )

        const reviewBody = this.formatReviewBody(analysis)
        const comments = analysis.inlineComments.map((finding) => ({
            path: finding.path,
            line: finding.line,
            start_line: finding.startLine,
            side: 'RIGHT' as const,
            start_side: finding.startLine ? ('RIGHT' as const) : undefined,
            body: this.formatInlineComment(finding),
        }))

        await this.githubClient.createReview(prNumber, pr.headRefOid, reviewBody, comments)
    }

    private async performReReview(
        prNumber: number,
        pr: { readonly title: string; readonly body: string },
        diff: string,
        botReview: ExistingReview,
        projectRules: string
    ): Promise<void> {
        const allThreads = await this.githubClient.getReviewThreads(prNumber)
        const unresolvedThreads = allThreads.filter((t) => !t.isResolved)

        const threadContexts = unresolvedThreads.map((t) => ({
            id: t.id,
            path: t.path,
            body: t.commentBodies.join('\n---\n'),
        }))

        const reReviewResult = await this.geminiClient.evaluateReReview(
            { title: pr.title, body: pr.body, diff },
            threadContexts,
            projectRules
        )

        for (const threadId of reReviewResult.resolvedThreadIds) {
            await this.githubClient.resolveReviewThread(threadId)
        }

        const updatedBody = this.formatReviewBody(reReviewResult.updatedAnalysis)
        await this.githubClient.updateReview(prNumber, botReview.id, updatedBody)
    }

    private findBotReview(reviews: readonly ExistingReview[]): ExistingReview | undefined {
        for (let i = reviews.length - 1; i >= 0; i--) {
            const review = reviews[i]
            if (review.body.includes('## 🤖 AGY Code Review') || review.body.includes(this.botName)) {
                return review
            }
        }
        return undefined
    }

    private formatReviewBody(analysis: ReviewAnalysis): string {
        const checklistRows = analysis.checklist.length > 0
            ? analysis.checklist.map((item) => {
                const icon = item.passed ? '✅ 준수' : '⚠️ 확인 필요'
                return `| **${item.title}** | ${icon} | ${item.note} |`
            }).join('\n')
            : '| **코드 품질 및 컨벤션** | ✅ 확인 완료 | 특이사항 없음 |'

        return `## 🤖 AGY Code Review

### 📋 PR 요약 (Summary)
${analysis.summary}

---

### 🎯 신뢰도 점수 (Confidence Score): \`${analysis.confidenceScore}/5\`
> **산정 기준**:
> - 5/5: 컨벤션 및 도메인 규칙을 엄격히 준수하며 잠재적 결함이 전혀 없음.
> - 4/5: 전반적으로 우수하며 마이너한 P2/P3 개선 제안이 존재함.
> - 1~3/5: 블로킹 이슈(P1) 또는 주요 컨벤션 위반이 있어 수정이 필요함.

---

### 📏 코드 품질 및 컨벤션 검증 체크리스트
| 검사 항목 | 상태 | 비고 |
| :--- | :---: | :--- |
${checklistRows}

${analysis.inlineComments.length > 0 ? '> 💡 **상세 지적사항은 코드 라인의 인라인 댓글을 확인해 주세요.**' : '> ✨ **지적된 이슈 없이 모든 검증 항목을 통과했습니다.**'}
`
    }

    private formatInlineComment(finding: InlineCommentFinding): string {
        const severityIcon = finding.severity === 'P1'
            ? '🔴 P1 (Critical - 블로킹 결함)'
            : finding.severity === 'P2'
                ? '🟡 P2 (Major - 주요 개선)'
                : '🟢 P3 (Minor - 권장 사항)'

        let result = `### ${severityIcon}: ${finding.title}

**문제 현상 및 원인**:
${finding.problem}`

        if (finding.suggestion) {
            result += `

**수정 제안**:
\`\`\`suggestion
${finding.suggestion}
\`\`\``
        }

        return result
    }
}
