import * as fs from 'node:fs'
import * as path from 'node:path'

export class ContextLoader {
    private readonly workspaceRoot: string
    private readonly candidateFiles: readonly string[] = [
        'AGENTS.md',
        'docs/coding-conventions.md',
        'docs/mahjong-domain.md',
        'docs/architecture.md',
        'CONVENTIONS.md',
        'RULES.md',
        'CLAUDE.md',
    ]

    public constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot
    }

    public loadProjectContext(): string {
        const loadedSections: string[] = []

        for (const relativePath of this.candidateFiles) {
            const absolutePath = path.resolve(this.workspaceRoot, relativePath)
            if (fs.existsSync(absolutePath)) {
                try {
                    const content = fs.readFileSync(absolutePath, 'utf8')
                    const truncated = content.length > 15000 ? `${content.slice(0, 15000)}\n... (truncated)` : content
                    loadedSections.push(`### [Project Rule File: ${relativePath}]\n\n${truncated}`)
                } catch {
                    // Ignore unreadable files
                }
            }
        }

        if (loadedSections.length === 0) {
            return `### Standard Engineering & Code Quality Guidelines
1. Strict Type Safety: No loose types, proper null/undefined handling.
2. Robust Error Handling: Proper try/catch, async/await error propagation.
3. Clean Architecture: Separation of concerns, modular functions, single responsibility.
4. Concurrency & Performance: Avoid race conditions, memory leaks, unnecessary re-renders or allocations.
5. Security: Sanitize inputs, avoid arbitrary code execution, follow least privilege.`
        }

        return `### Project-Specific Coding Standards & Domain Rules (MUST BE STRICTLY ENFORCED)
The following documents define the authoritative engineering and domain rules for this repository:

${loadedSections.join('\n\n---\n\n')}`
    }
}
