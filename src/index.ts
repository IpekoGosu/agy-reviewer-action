import * as core from '@actions/core'
import * as github from '@actions/github'
import { ChatHandler } from './chat-handler.js'
import { ContextLoader } from './context-loader.js'
import { GeminiClient } from './gemini-client.js'
import { GithubClient } from './github-client.js'
import { ReviewerEngine } from './reviewer.js'
import { ActionConfig, ThinkingLevelType } from './types.js'

interface GitHubIssuePayload {
    readonly number: number
    readonly pull_request?: {
        readonly url: string
    }
}

interface GitHubCommentPayload {
    readonly id: number
    readonly body: string
}

interface GitHubSenderPayload {
    readonly type?: string
}

interface GitHubPullRequestCommentPayload {
    readonly id: number
    readonly body: string
    readonly path: string
    readonly line?: number | null
    readonly original_line?: number | null
    readonly diff_hunk?: string
}

interface GitHubPullRequestPayload {
    readonly number: number
}

async function run(): Promise<void> {
    try {
        const geminiApiKey = core.getInput('gemini-api-key', { required: true })
        const model = core.getInput('model') || 'gemini-3.8-flash'
        const rawThinking = core.getInput('thinking-level') || 'HIGH'
        const thinkingLevel: ThinkingLevelType = rawThinking === 'LOW' || rawThinking === 'MEDIUM' ? rawThinking : 'HIGH'

        const appId = core.getInput('app-id') || undefined
        const privateKey = core.getInput('private-key') || undefined
        const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || undefined

        const botName = core.getInput('bot-name') || 'agy-reviewer-ksw'
        const rawMention = core.getInput('bot-mention') || '@agy-reviewer-ksw'
        const parsedMentions = rawMention
            .split(',')
            .map((m) => m.trim())
            .filter((m) => m.length > 0)
        const botMentions = Array.from(new Set([...parsedMentions, '@AGY', `@${botName}`]))

        const config: ActionConfig = {
            geminiApiKey,
            model,
            thinkingLevel,
            appId,
            privateKey,
            githubToken,
            botName,
            botMentions,
        }

        const { eventName, payload, repo } = github.context
        const githubClient = await GithubClient.create(repo.owner, repo.repo, {
            token: config.githubToken,
            appId: config.appId,
            privateKey: config.privateKey,
        })

        const geminiClient = new GeminiClient(config)
        const contextLoader = new ContextLoader(process.cwd())
        const reviewerEngine = new ReviewerEngine(githubClient, geminiClient, contextLoader, config.botName)
        const chatHandler = new ChatHandler(
            githubClient,
            geminiClient,
            contextLoader,
            reviewerEngine,
            config.botMentions
        )

        core.info(`Running AGY Reviewer for event: ${eventName}`)

        if (eventName === 'pull_request') {
            const prPayload = payload.pull_request as GitHubPullRequestPayload | undefined
            if (!prPayload) {
                core.warning('No pull_request payload found.')
                return
            }
            const isSynchronize = payload.action === 'synchronize'
            await reviewerEngine.runReview(prPayload.number, isSynchronize)
            return
        }

        if (eventName === 'issue_comment') {
            const issue = payload.issue as GitHubIssuePayload | undefined
            const comment = payload.comment as GitHubCommentPayload | undefined
            const sender = payload.sender as GitHubSenderPayload | undefined

            if (!issue?.pull_request || !comment) {
                core.info('Issue comment is not on a pull request. Skipping.')
                return
            }

            const isBot = sender?.type === 'Bot'
            await chatHandler.handleIssueComment(issue.number, comment.id, comment.body, isBot)
            return
        }

        if (eventName === 'pull_request_review_comment') {
            const pr = payload.pull_request as GitHubPullRequestPayload | undefined
            const comment = payload.comment as GitHubPullRequestCommentPayload | undefined
            const sender = payload.sender as GitHubSenderPayload | undefined

            if (!pr || !comment) {
                core.warning('Incomplete pull_request_review_comment payload.')
                return
            }

            const isBot = sender?.type === 'Bot'
            const commentLine = comment.line ?? comment.original_line ?? 1

            await chatHandler.handleReviewComment(
                pr.number,
                comment.id,
                comment.body,
                comment.path,
                commentLine,
                comment.diff_hunk,
                isBot
            )
            return
        }

        core.info(`Unhandled event: ${eventName}. Skipping.`)
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message)
        } else {
            core.setFailed(String(error))
        }
    }
}

void run()
