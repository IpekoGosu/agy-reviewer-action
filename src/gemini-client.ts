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
1. Review Thoroughness:
   - Check against ALL Project-Specific Coding Standards and Domain Rules provided above.
   - Categorize issues by severity:
     - P1 (Critical): Security vulnerabilities, fatal crashes, data loss, breaking invariant/domain logic, strict typing violation (any/unknown).
     - P2 (Major): Architecture violations, formatting/convention violations, performance anti-patterns, resource leaks, broken links.
     - P3 (Minor): Documentation mismatch, naming improvements, minor refactoring suggestions.
2. Inline Comments Precision:
   - Only place inline comments on lines modified in the diff (+ lines).
   - Provide exact file 'path' and right-side 'line' number.
   - For suggestions, provide a clear markdown code block with the fix.
3. Confidence Score:
   - Calculate an honest confidence score from 1 to 5.
   - 5/5: Flawless, adheres strictly to all conventions, zero unresolved P1/P2/P3 issues.
   - 4/5: High quality, minor P2/P3 suggestions only.
   - 1-3/5: Contains blocking P1 bugs or critical convention violations.

Return your response strictly in the following JSON format:
{
  "summary": "High-level summary of changes and architecture impact (markdown)",
  "confidenceScore": 4,
  "checklist": [
    { "title": "Type Safety", "passed": true, "note": "Zero any/unknown detected" },
    { "title": "Conventions & Formatting", "passed": false, "note": "Found semicolons or formatting issues" }
  ],
  "inlineComments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "startLine": 40,
      "severity": "P1",
      "title": "Strict typing violation",
      "problem": "Detailed explanation of the issue",
      "suggestion": "Exact replacement code suggestion"
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

Return your response strictly in the following JSON format:
{
  "resolvedThreadIds": ["PRRT_example1", "PRRT_example2"],
  "summary": "Updated markdown summary highlighting what was fixed and current PR status",
  "confidenceScore": 5,
  "checklist": [
    { "title": "Type Safety", "passed": true, "note": "All strict type violations resolved" }
  ],
  "newInlineComments": [
    {
      "path": "path/to/file.ts",
      "line": 50,
      "severity": "P2",
      "title": "New issue description",
      "problem": "Explanation of newly introduced issue",
      "suggestion": "Replacement code suggestion"
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

Answer in GitHub-flavored markdown. If referencing code, provide exact snippets. Keep it polite, direct, and constructive.`

        const text = await this.generateWithFallback(prompt, false)
        return text || 'I was unable to generate a response at this time.'
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

Answer directly to the question in GitHub-flavored markdown. If suggesting code, provide a markdown code block.`

        const text = await this.generateWithFallback(prompt, false)
        return text || 'I was unable to generate an inline response at this time.'
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
        const summary = raw.summary ?? 'No summary provided.'
        const confidenceScore = typeof raw.confidenceScore === 'number'
            ? Math.max(1, Math.min(5, Math.round(raw.confidenceScore)))
            : 3

        const checklist = (raw.checklist ?? []).map((item) => ({
            title: item.title ?? 'Check',
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
                    title: item.title ?? 'Review finding',
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
