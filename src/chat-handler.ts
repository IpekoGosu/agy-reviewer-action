import { ContextLoader } from './context-loader.js'
import { GeminiClient } from './gemini-client.js'
import { GithubClient } from './github-client.js'
import { ReviewerEngine } from './reviewer.js'

export class ChatHandler {
    private readonly githubClient: GithubClient
    private readonly geminiClient: GeminiClient
    private readonly contextLoader: ContextLoader
    private readonly reviewerEngine: ReviewerEngine
    private readonly botMentions: readonly string[]

    public constructor(
        githubClient: GithubClient,
        geminiClient: GeminiClient,
        contextLoader: ContextLoader,
        reviewerEngine: ReviewerEngine,
        botMentions: readonly string[]
    ) {
        this.githubClient = githubClient
        this.geminiClient = geminiClient
        this.contextLoader = contextLoader
        this.reviewerEngine = reviewerEngine
        this.botMentions = botMentions
    }

    public async handleIssueComment(
        prNumber: number,
        commentId: number,
        commentBody: string,
        isBotSender: boolean
    ): Promise<void> {
        if (isBotSender) {
            return
        }

        const trimmed = commentBody.trim()
        const isMentioned = this.isBotMentioned(trimmed)
        const isReviewCommand = this.isReviewCommand(trimmed)

        if (!isMentioned && !isReviewCommand) {
            return
        }

        await this.githubClient.addReaction(commentId, false, 'eyes')

        if (isReviewCommand) {
            await this.reviewerEngine.runReview(prNumber, true)
            await this.githubClient.addReaction(commentId, false, 'rocket')
            return
        }

        // General PR conversation
        const cleanQuestion = this.stripMentions(trimmed)
        const pr = await this.githubClient.getPullRequest(prNumber)
        const diff = await this.githubClient.getPullRequestDiff(prNumber)
        const projectRules = this.contextLoader.loadProjectContext()

        const answer = await this.geminiClient.answerPrQuestion(
            { title: pr.title, body: pr.body, diff },
            cleanQuestion,
            projectRules
        )

        await this.githubClient.createComment(prNumber, answer)
        await this.githubClient.addReaction(commentId, false, '+1')
    }

    public async handleReviewComment(
        prNumber: number,
        commentId: number,
        commentBody: string,
        commentPath: string,
        commentLine: number,
        diffHunk: string | undefined,
        isBotSender: boolean
    ): Promise<void> {
        if (isBotSender) {
            return
        }

        const trimmed = commentBody.trim()
        if (!this.isBotMentioned(trimmed)) {
            return
        }

        await this.githubClient.addReaction(commentId, true, 'eyes')

        const cleanQuestion = this.stripMentions(trimmed)
        const allThreads = await this.githubClient.getReviewThreads(prNumber)
        const matchingThread = allThreads.find(
            (t) => t.path === commentPath && t.line === commentLine
        )

        const threadComments = matchingThread ? matchingThread.commentBodies : [commentBody]
        const projectRules = this.contextLoader.loadProjectContext()

        const answer = await this.geminiClient.answerInlineQuestion(
            {
                path: commentPath,
                line: commentLine,
                comments: threadComments,
                diffHunk,
            },
            cleanQuestion,
            projectRules
        )

        await this.githubClient.replyToReviewComment(prNumber, commentId, answer)
        await this.githubClient.addReaction(commentId, true, '+1')
    }

    private isBotMentioned(text: string): boolean {
        const lower = text.toLowerCase()
        return this.botMentions.some((mention) => lower.includes(mention.toLowerCase()))
    }

    private isReviewCommand(text: string): boolean {
        const lower = text.toLowerCase()
        return (
            lower.startsWith('/review') ||
            lower.startsWith('/re-review') ||
            lower.startsWith('/rereview') ||
            lower.includes('re-review') ||
            (this.isBotMentioned(text) && (lower.includes('review') || lower.includes('재리뷰')))
        )
    }

    private stripMentions(text: string): string {
        let result = text
        for (const mention of this.botMentions) {
            const regex = new RegExp(mention, 'gi')
            result = result.replace(regex, '')
        }
        return result.replace(/^\/(?:review|re-review|ask)?\s*/i, '').trim()
    }
}
