import { getOctokit } from '@actions/github'
import { createAppAuth } from '@octokit/auth-app'
import { ExistingReview, ReviewThreadItem } from './types.js'

interface GraphQLThreadCommentNode {
    readonly body?: string
}

interface GraphQLThreadNode {
    readonly id: string
    readonly isResolved: boolean
    readonly path: string
    readonly line?: number | null
    readonly comments?: {
        readonly nodes?: readonly GraphQLThreadCommentNode[]
    }
}

interface GraphQLReviewThreadsResponse {
    readonly repository?: {
        readonly pullRequest?: {
            readonly reviewThreads?: {
                readonly nodes?: readonly GraphQLThreadNode[]
            }
        }
    }
}

interface GraphQLResolveResponse {
    readonly resolveReviewThread?: {
        readonly thread?: {
            readonly id: string
            readonly isResolved: boolean
        }
    }
}

type OctokitInstance = ReturnType<typeof getOctokit>

export class GithubClient {
    private readonly octokit: OctokitInstance
    private readonly owner: string
    private readonly repo: string

    private constructor(octokit: OctokitInstance, owner: string, repo: string) {
        this.octokit = octokit
        this.owner = owner
        this.repo = repo
    }

    public static async create(
        owner: string,
        repo: string,
        options: {
            readonly token?: string
            readonly appId?: string
            readonly privateKey?: string
        }
    ): Promise<GithubClient> {
        if (options.appId && options.privateKey) {
            const auth = createAppAuth({
                appId: options.appId,
                privateKey: options.privateKey.replace(/\\n/g, '\n'),
            })

            // Authenticate as GitHub App to find installation for repository
            const appAuthResult = await auth({ type: 'app' })
            const tempOctokit = getOctokit(appAuthResult.token)
            const installationResponse = await tempOctokit.rest.apps.getRepoInstallation({
                owner,
                repo,
            })

            const installationAuth = await auth({
                type: 'installation',
                installationId: installationResponse.data.id,
            })

            const installationOctokit = getOctokit(installationAuth.token)
            return new GithubClient(installationOctokit, owner, repo)
        }

        if (options.token) {
            const client = getOctokit(options.token)
            return new GithubClient(client, owner, repo)
        }

        throw new Error('Either token or (appId + privateKey) must be provided for GithubClient.')
    }

    public async getPullRequest(prNumber: number): Promise<{
        readonly title: string
        readonly body: string
        readonly headRefOid: string
        readonly baseRefOid: string
        readonly headRefName: string
        readonly baseRefName: string
    }> {
        const response = await this.octokit.rest.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
        })

        return {
            title: response.data.title,
            body: response.data.body ?? '',
            headRefOid: response.data.head.sha,
            baseRefOid: response.data.base.sha,
            headRefName: response.data.head.ref,
            baseRefName: response.data.base.ref,
        }
    }

    public async getPullRequestDiff(prNumber: number): Promise<string> {
        const response = await this.octokit.rest.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
            mediaType: {
                format: 'diff',
            },
        })

        if (typeof response.data === 'string') {
            return response.data
        }
        return String(response.data)
    }

    public async listReviews(prNumber: number): Promise<readonly ExistingReview[]> {
        const response = await this.octokit.rest.pulls.listReviews({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
            per_page: 100,
        })

        return response.data.map((review) => ({
            id: review.id,
            nodeId: review.node_id,
            body: review.body ?? '',
            commitId: review.commit_id ?? '',
        }))
    }

    public async createReview(
        prNumber: number,
        commitId: string,
        body: string,
        comments: readonly {
            readonly path: string
            readonly line: number
            readonly start_line?: number
            readonly body: string
            readonly side: 'RIGHT'
            readonly start_side?: 'RIGHT'
        }[]
    ): Promise<number> {
        const formattedComments = comments.map((comment) => {
            if (comment.start_line && comment.start_line < comment.line) {
                return {
                    path: comment.path,
                    line: comment.line,
                    start_line: comment.start_line,
                    side: comment.side,
                    start_side: comment.start_side ?? 'RIGHT',
                    body: comment.body,
                }
            }
            return {
                path: comment.path,
                line: comment.line,
                side: comment.side,
                body: comment.body,
            }
        })

        try {
            const response = await this.octokit.rest.pulls.createReview({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
                commit_id: commitId,
                event: 'COMMENT',
                body,
                comments: formattedComments.length > 0 ? formattedComments : undefined,
            })

            return response.data.id
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.warn('Batch review submission failed, attempting individual comments fallback:', errorMessage)
            // Fallback 1: Create top-level review body first
            const reviewResponse = await this.octokit.rest.pulls.createReview({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
                commit_id: commitId,
                event: 'COMMENT',
                body,
            })
            const reviewId = reviewResponse.data.id

            // Fallback 2: Try creating comments individually against the review
            const failedComments: typeof formattedComments = []
            for (const comment of formattedComments) {
                try {
                    await this.octokit.rest.pulls.createReviewComment({
                        owner: this.owner,
                        repo: this.repo,
                        pull_number: prNumber,
                        commit_id: commitId,
                        body: comment.body,
                        path: comment.path,
                        line: comment.line,
                        start_line: comment.start_line,
                        side: comment.side,
                        start_side: comment.start_side,
                    })
                } catch {
                    failedComments.push(comment)
                }
            }

            // Fallback 3: If any comments failed line resolution, append them to the review body so they are not lost!
            if (failedComments.length > 0) {
                let updatedBody = body + '\n\n---\n### 📝 추가 피드백 (Diff 라인 외 영역)\n'
                for (const fc of failedComments) {
                    updatedBody += `\n<details><summary><b>${fc.path}:${fc.line}</b></summary>\n\n${fc.body}\n</details>\n`
                }
                await this.octokit.rest.pulls.updateReview({
                    owner: this.owner,
                    repo: this.repo,
                    pull_number: prNumber,
                    review_id: reviewId,
                    body: updatedBody,
                })
            }

            return reviewId
        }

    }

    public async updateReview(prNumber: number, reviewId: number, body: string): Promise<void> {
        await this.octokit.rest.pulls.updateReview({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
            review_id: reviewId,
            body,
        })
    }

    public async getReviewThreads(prNumber: number): Promise<readonly ReviewThreadItem[]> {
        const query = `
            query($owner: String!, $repo: String!, $pr: Int!) {
                repository(owner: $owner, name: $repo) {
                    pullRequest(number: $pr) {
                        reviewThreads(first: 100) {
                            nodes {
                                id
                                isResolved
                                path
                                line
                                comments(first: 10) {
                                    nodes { body }
                                }
                            }
                        }
                    }
                }
            }
        `

        const response: GraphQLReviewThreadsResponse = await this.octokit.graphql(query, {
            owner: this.owner,
            repo: this.repo,
            pr: prNumber,
        })

        const nodes = response.repository?.pullRequest?.reviewThreads?.nodes ?? []
        return nodes.map((node) => ({
            id: node.id,
            isResolved: node.isResolved,
            path: node.path,
            line: node.line ?? null,
            commentBodies: (node.comments?.nodes ?? []).map((comment) => comment.body ?? ''),
        }))
    }

    public async resolveReviewThread(threadId: string): Promise<boolean> {
        try {
            const mutation = `
                mutation($threadId: ID!) {
                    resolveReviewThread(input: { threadId: $threadId }) {
                        thread {
                            id
                            isResolved
                        }
                    }
                }
            `

            const response: GraphQLResolveResponse = await this.octokit.graphql(mutation, { threadId })
            return response.resolveReviewThread?.thread?.isResolved ?? false
        } catch (error) {
            // Non-fatal: logged if GitHub App has not yet been granted Contents: write permission
            console.warn(`Could not resolve review thread ${threadId}:`, error)
            return false
        }
    }

    public async createComment(issueNumber: number, body: string): Promise<number> {
        const response = await this.octokit.rest.issues.createComment({
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
            body,
        })
        return response.data.id
    }

    public async replyToReviewComment(prNumber: number, commentId: number, body: string): Promise<number> {
        const response = await this.octokit.rest.pulls.createReplyForReviewComment({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
            comment_id: commentId,
            body,
        })
        return response.data.id
    }

    public async addReaction(
        commentId: number,
        isReviewComment: boolean,
        content: '+1' | 'eyes' | 'rocket'
    ): Promise<void> {
        try {
            if (isReviewComment) {
                await this.octokit.rest.reactions.createForPullRequestReviewComment({
                    owner: this.owner,
                    repo: this.repo,
                    comment_id: commentId,
                    content,
                })
            } else {
                await this.octokit.rest.reactions.createForIssueComment({
                    owner: this.owner,
                    repo: this.repo,
                    comment_id: commentId,
                    content,
                })
            }
        } catch {
            // Reaction failure is non-fatal
        }
    }
}
