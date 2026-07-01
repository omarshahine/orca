import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getGitRepoRoot, isGitRepo, normalizeGitRepoRootForInputPath } from './repo'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

describe('isGitRepo', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'orca-repo-detect-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects directories with an invalid .git file', () => {
    const fakeRepo = path.join(tmpDir, 'fake')
    mkdirSync(fakeRepo)
    writeFileSync(path.join(fakeRepo, '.git'), 'not a gitdir file')

    expect(isGitRepo(fakeRepo)).toBe(false)
  })

  it('accepts bare git repositories', () => {
    const bareRepo = path.join(tmpDir, 'bare.git')
    git(tmpDir, ['init', '--bare', '--quiet', bareRepo])

    expect(isGitRepo(bareRepo)).toBe(true)
  })

  it('accepts a real repository when git itself cannot be run', () => {
    // Why: regression guard for the spurious "Open as Folder" prompt. When the
    // `git rev-parse` probe fails for an environmental reason (here simulated by
    // making `git` unresolvable), a directory carrying valid Git metadata must
    // still be recognized rather than silently downgraded to a plain folder.
    const realRepo = path.join(tmpDir, 'real')
    mkdirSync(realRepo)
    git(realRepo, ['init', '--quiet'])

    withGitUnavailable(() => {
      expect(isGitRepo(realRepo)).toBe(true)
    })
  })

  it('rejects a plain folder when git cannot be run', () => {
    const plain = path.join(tmpDir, 'plain')
    mkdirSync(plain)

    withGitUnavailable(() => {
      expect(isGitRepo(plain)).toBe(false)
    })
  })

  it('rejects a garbage .git file even when git cannot be run', () => {
    const fakeRepo = path.join(tmpDir, 'fake-offline')
    mkdirSync(fakeRepo)
    writeFileSync(path.join(fakeRepo, '.git'), 'not a gitdir file')

    withGitUnavailable(() => {
      expect(isGitRepo(fakeRepo)).toBe(false)
    })
  })

  it('rejects an empty .git directory', () => {
    const emptyGitDir = path.join(tmpDir, 'empty-gitdir')
    mkdirSync(path.join(emptyGitDir, '.git'), { recursive: true })

    withGitUnavailable(() => {
      expect(isGitRepo(emptyGitDir)).toBe(false)
    })
  })

  it('resolves a contained path to the worktree root', () => {
    const repoRoot = path.join(tmpDir, 'repo')
    const nestedDir = path.join(repoRoot, 'packages', 'web')
    mkdirSync(nestedDir, { recursive: true })
    git(tmpDir, ['init', '--quiet', repoRoot])

    // Why: derive the expected root from git's own --show-toplevel so the
    // assertion matches getGitRepoRoot's canonicalization (e.g. macOS resolves
    // the /var tmpdir symlink to /private/var) across all platforms.
    const expectedRoot = git(repoRoot, ['rev-parse', '--show-toplevel']).trim().replace(/\\/g, '/')
    expect(getGitRepoRoot(nestedDir)).toBe(expectedRoot)
  })

  it('keeps WSL UNC identity when git reports a Linux worktree root', () => {
    expect(
      normalizeGitRepoRootForInputPath(
        String.raw`\\wsl.localhost\Ubuntu\home\alice\repo\packages\web`,
        '/home/alice/repo'
      )
    ).toBe(String.raw`\\wsl.localhost\Ubuntu\home\alice\repo`)
  })

  it('preserves bare repository paths when no worktree root exists', () => {
    const bareRepo = path.join(tmpDir, 'bare.git')
    git(tmpDir, ['init', '--bare', '--quiet', bareRepo])

    expect(getGitRepoRoot(bareRepo)).toBe(bareRepo)
  })
})

/**
 * Run `fn` with `git` removed from PATH so the in-process git probe fails the
 * same way a transient spawn failure would, exercising the `.git`-marker
 * fallback path. PATH is restored afterward.
 */
function withGitUnavailable(fn: () => void): void {
  const originalPath = process.env.PATH
  // An empty PATH leaves no directory to resolve the bare `git` binary, so the
  // probe throws ENOENT — the indeterminate failure the fallback exists for.
  process.env.PATH = ''
  try {
    fn()
  } finally {
    // Why: restoring an originally-unset PATH via assignment would write the
    // string "undefined", corrupting PATH for later tests in this process.
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
  }
}
