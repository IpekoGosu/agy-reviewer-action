import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { ActionConfig, InlineCommentFinding, ReviewAnalysis } from './types.js'

interface RawInlineFinding {
    readonly path?: string
    readonly line?: number
    readonly startLine?: number
    readonly severity?: string
    readonly title?: string
    readonly problem?: string
    readonly suggestion?: string
}

interface RawChecklistItem {
    readonly title?: string
    readonly passed?: boolean
    readonly note?: string
}

interface RawReviewResponse {
    readonly summary?: string
    readonly confidenceScore?: number
    readonly checklist?: readonly RawChecklistItem[]
    readonly inlineComments?: readonly RawInlineFinding[]
}

interface RawReReviewResponse {
    readonly resolvedIssueTitles?: readonly string[]
    readonly summary?: string
    readonly confidenceScore?: number
    readonly checklist?: readonly RawChecklistItem[]
    readonly newInlineComments?: readonly RawInlineFinding[]
}

export class GeminiClient {
    private readonly ai: GoogleGenAI
    private readonly model: string
    private readonly thinkingLevel: ThinkingLevel

    public constructor(config: ActionConfig) {
        this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey })
        this.model = config.model

        if (config.thinkingLevel === 'LOW') {
            this.thinkingLevel = ThinkingLevel.LOW
        } else if (config.thinkingLevel === 'MEDIUM') {
            this.thinkingLevel = ThinkingLevel.MEDIUM
        } else {
            this.thinkingLevel = ThinkingLevel.HIGH
        }
    }

    public async analyzeReview(
        prContext: {
            readonly title: string
            readonly body: string
            readonly diff: string
        },
        projectRules: string
    ): Promise<ReviewAnalysis> {
        const prompt = `You are AGY Code Reviewer, an elite senior software architect and domain-specific code reviewer.
Conduct an exhaustive, high-precision code review for this pull request.

${projectRules}

---

### PR Details:
- Title: ${prContext.title}
- Description: ${prContext.body}

### PR Diff:
\`\`\`diff
${prContext.diff.length > 70000 ? `${prContext.diff.slice(0, 70000)}\n... (diff truncated)` : prContext.diff}
\`\`\`

---

### Review Directives:
1. 언어 원칙 (MANDATORY):
   - 요약(summary), 체크리스트 항목 및 설명(checklist), 인라인 지적사항의 제목(title)과 문제 설명(problem), 수정 제안(suggestion) 등 모든 텍스트는 **반드시 100% 유려하고 전문적인 한국어(Korean)**로 작성하십시오. 영어로 작성하지 마십시오.
2. Review Thoroughness:
   - Check against ALL Project-Specific Coding Standards and Domain Rules provided above.
   - Categorize issues by severity:
     - P1 (Critical): 보안 취약점, 런타임 크래시, 데이터 손실, 불변성/도메인 규칙 파괴, 타입 안정성 위반(any/unknown).
     - P2 (Major): 아키텍처 위반, 포맷팅/컨벤션 위반(들여쓰기, 세미콜론 등), 성능 안티패턴, 리소스 누수, 링크 깨짐.
     - P3 (Minor): 문서/주석 불일치, 네이밍 개선, 마이너 리팩토링 제안.
3. Inline Comments Precision:
   - Only place inline comments on lines modified in the diff (+ lines).
   - Provide exact file 'path' and right-side 'line' number.
   - For suggestions, provide a clear markdown code block with the fix.
4. Confidence Score:
   - Calculate an honest confidence score from 1 to 5.
   - 5/5: 컨벤션과 도메인 규칙을 완벽히 준수하며 미해결 P1/P2/P3 이슈가 없음.
   - 4/5: 전반적으로 우수하며 마이너한 P2/P3 제안만 있음.
   - 1-3/5: 블로킹 P1 버그나 주요 컨벤션 위반이 존재함.

Return your response strictly in the following JSON format:
{
  "summary": "한국어로 작성된 변경사항 및 아키텍처 영향 요약 (마크다운)",
  "confidenceScore": 4,
  "checklist": [
    { "title": "타입 안전성", "passed": true, "note": "any/unknown 타입 사용 없음" },
    { "title": "코딩 컨벤션 및 포맷팅", "passed": false, "note": "들여쓰기 4칸 규칙 위반 확인" }
  ],
  "inlineComments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "startLine": 40,
      "severity": "P1",
      "title": "타입 안전성 위반 (한국어)",
      "problem": "문제 원인 및 현상에 대한 상세한 한국어 설명",
      "suggestion": "정확한 수정 코드"
    }
  ]
}`

        const text = await this.generateWithFallback(prompt, true)
        const parsed = JSON.parse(text) as RawReviewResponse
        return this.normalizeReviewResponse(parsed)
    }

    public async evaluateReReview(
        prContext: {
            readonly title: string
            readonly body: string
            readonly diff: string
        },
        unresolvedThreadContexts: readonly { readonly id: string; readonly path: string; readonly body: string }[],
        projectRules: string
    ): Promise<{
        readonly resolvedThreadIds: readonly string[]
        readonly updatedAnalysis: ReviewAnalysis
    }> {
        const unresolvedList = unresolvedThreadContexts.map(
            (t, index) => `Thread #${index + 1} (ID: ${t.id}, File: ${t.path}):\n${t.body}`
        ).join('\n\n---\n\n')

        const prompt = `You are AGY Code Reviewer evaluating updated changes in a pull request.
Review the latest diff to verify if previously reported issues have been addressed, and identify any new issues introduced.

${projectRules}

---

### PR Details:
- Title: ${prContext.title}
- Description: ${prContext.body}

### Existing Unresolved Threads:
${unresolvedList}

### Latest Full PR Diff:
\`\`\`diff
${prContext.diff.length > 70000 ? `${prContext.diff.slice(0, 70000)}\n... (diff truncated)` : prContext.diff}
\`\`\`

---

### Directives:
1. 언어 원칙 (MANDATORY):
   - 갱신된 요약(summary), 체크리스트 항목 및 설명, 신규 인라인 지적사항의 제목과 문제 설명 등 모든 텍스트는 **반드시 100% 유려하고 전문적인 한국어(Korean)**로 작성하십시오.

Return your response strictly in the following JSON format:
{
  "resolvedThreadIds": ["PRRT_example1", "PRRT_example2"],
  "summary": "이전 피드백 반영 사항 및 현재 PR 상태에 대한 상세한 한국어 요약 (마크다운)",
  "confidenceScore": 5,
  "checklist": [
    { "title": "타입 안전성", "passed": true, "note": "모든 타입 위반 사항 해결 완료" }
  ],
  "newInlineComments": [
    {
      "path": "path/to/file.ts",
      "line": 50,
      "severity": "P2",
      "title": "신규 이슈 제목 (한국어)",
      "problem": "신규 도입된 문제에 대한 한국어 설명",
      "suggestion": "수정 코드 제안"
    }
  ]
}`

        const text = await this.generateWithFallback(prompt, true)
        const parsed = JSON.parse(text) as RawReReviewResponse

        const resolvedThreadIds: string[] = []
        if (parsed.resolvedIssueTitles) {
            for (const item of parsed.resolvedIssueTitles) {
                if (typeof item === 'string') {
                    resolvedThreadIds.push(item)
                }
            }
        }

        const normalizedAnalysis = this.normalizeReviewResponse({
            summary: parsed.summary,
            confidenceScore: parsed.confidenceScore,
            checklist: parsed.checklist,
            inlineComments: parsed.newInlineComments,
        })

        return {
            resolvedThreadIds,
            updatedAnalysis: normalizedAnalysis,
        }
    }

    public async answerPrQuestion(
        prContext: {
            readonly title: string
            readonly body: string
            readonly diff: string
        },
        question: string,
        projectRules: string
    ): Promise<string> {
        const prompt = `You are AGY Code Reviewer, an AI pair programmer and architecture expert.
A contributor asked a question on this pull request. Provide a concise, clear, and highly helpful response.

${projectRules}

---

### PR Title: ${prContext.title}
### PR Description: ${prContext.body}

### PR Diff:
\`\`\`diff
${prContext.diff.length > 50000 ? `${prContext.diff.slice(0, 50000)}\n... (diff truncated)` : prContext.diff}
\`\`\`

---

### User Question:
${question}

### Directives:
- 반드시 자연스럽고 친절하며 전문적인 한국어(Korean)로 답변하십시오.
- 코드를 언급할 때는 마크다운 코드 블록을 제공하십시오.`

        const text = await this.generateWithFallback(prompt, false)
        return text || '현재 답변을 생성할 수 없습니다.'
    }

    public async answerInlineQuestion(
        threadContext: {
            readonly path: string
            readonly line: number
            readonly comments: readonly string[]
            readonly diffHunk?: string
        },
        question: string,
        projectRules: string
    ): Promise<string> {
        const prompt = `You are AGY Code Reviewer participating in an inline code review discussion thread.
A contributor replied to an inline review comment. Provide a clear, technically precise explanation or alternative code.

${projectRules}

---

### Code Location: ${threadContext.path} (Line ${threadContext.line})
${threadContext.diffHunk ? `### Diff Hunk:\n\`\`\`diff\n${threadContext.diffHunk}\n\`\`\`\n` : ''}

### Conversation Thread History:
${threadContext.comments.join('\n\n---\n\n')}

### Latest Contributor Message:
${question}

### Directives:
- 반드시 자연스럽고 명확한 한국어(Korean)로 답변하십시오.
- 수정 코드를 제시할 때는 \`\`\`suggestion 또는 마크다운 코드 블록으로 작성하십시오.`

        const text = await this.generateWithFallback(prompt, false)
        return text || '현재 답변을 생성할 수 없습니다.'
    }

    private async generateWithFallback(prompt: string, isJson: boolean): Promise<string> {
        const candidates = [this.model, 'gemini-3.8-flash', 'gemini-3.1-flash-lite']
        const modelsToTry = candidates.filter((m, i) => candidates.indexOf(m) === i)
        let lastError: Error | undefined

        for (const modelName of modelsToTry) {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const response = await this.ai.models.generateContent({
                        model: modelName,
                        contents: prompt,
                        config: {
                            responseMimeType: isJson ? 'application/json' : undefined,
                            thinkingConfig: {
                                thinkingLevel: this.thinkingLevel,
                            },
                        },
                    })
                    const text = response.text?.trim()
                    if (text) {
                        return text
                    }
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error))
                    const msg = lastError.message.toLowerCase()
                    const isRetryable = (
                        msg.includes('503') ||
                        msg.includes('429') ||
                        msg.includes('high demand') ||
                        msg.includes('unavailable') ||
                        msg.includes('resource_exhausted')
                    )

                    if (!isRetryable) {
                        break
                    }

                    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
                }
            }
        }

        throw lastError ?? new Error('Failed to generate content from Gemini models.')
    }

    private normalizeReviewResponse(raw: RawReviewResponse): ReviewAnalysis {
        const summary = raw.summary ?? '요약이 제공되지 않았습니다.'
        const confidenceScore = typeof raw.confidenceScore === 'number'
            ? Math.max(1, Math.min(5, Math.round(raw.confidenceScore)))
            : 3

        const checklist = (raw.checklist ?? []).map((item) => ({
            title: item.title ?? '검증 항목',
            passed: item.passed ?? false,
            note: item.note ?? '',
        }))

        const inlineComments: InlineCommentFinding[] = []
        for (const item of raw.inlineComments ?? []) {
            if (item.path && typeof item.line === 'number') {
                const severity = item.severity === 'P1' || item.severity === 'P2' || item.severity === 'P3'
                    ? item.severity
                    : 'P2'

                inlineComments.push({
                    path: item.path,
                    line: item.line,
                    startLine: typeof item.startLine === 'number' && item.startLine < item.line
                        ? item.startLine
                        : undefined,
                    severity,
                    title: item.title ?? '코드 리뷰 의견',
                    problem: item.problem ?? '',
                    suggestion: item.suggestion,
                })
            }
        }

        return {
            summary,
            confidenceScore,
            checklist,
            inlineComments,
        }
    }
}
