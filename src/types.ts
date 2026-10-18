export type ThinkingLevelType = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ActionConfig {
    readonly geminiApiKey: string
    readonly model: string
    readonly thinkingLevel: ThinkingLevelType
    readonly githubToken?: string
    readonly appId?: string
    readonly privateKey?: string
    readonly botName: string
    readonly botMentions: readonly string[]
}

export type IssueSeverity = 'P1' | 'P2' | 'P3'

export interface InlineCommentFinding {
    readonly path: string
    readonly line: number
    readonly startLine?: number
    readonly severity: IssueSeverity
    readonly title: string
    readonly problem: string
    readonly suggestion?: string
}

export interface ChecklistItem {
    readonly title: string
    readonly passed: boolean
    readonly note: string
}

export interface ReviewAnalysis {
    readonly summary: string
    readonly confidenceScore: number
    readonly checklist: readonly ChecklistItem[]
    readonly inlineComments: readonly InlineCommentFinding[]
}

export interface ExistingReview {
    readonly id: number
    readonly nodeId: string
    readonly body: string
    readonly commitId: string
}

export interface ReviewThreadItem {
    readonly id: string
    readonly isResolved: boolean
    readonly path: string
    readonly line: number | null
    readonly commentBodies: readonly string[]
}
