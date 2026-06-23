import { describe, expect, it } from 'vitest'
import { reconcileWorktreeIdentities } from './worktrees'
import { makeWorktree } from './store-test-helpers'

// Why: runtime worktree scans return fresh Worktree objects each poll. Preserving
// the existing object identity for unchanged worktrees keeps WorktreeCard's
// React.memo effective, avoiding the re-render churn that retains render scopes
// (stablyai/orca#6109).
describe('reconcileWorktreeIdentities', () => {
  it('reuses the existing object identity for structurally-unchanged worktrees', () => {
    const a = makeWorktree({ id: 'a', repoId: 'r', branch: 'refs/heads/a' })
    const b = makeWorktree({ id: 'b', repoId: 'r', branch: 'refs/heads/b' })
    const current = [a, b]
    // fresh objects with identical content (new identities, as a scan returns)
    const next = [{ ...a }, { ...b }]

    const result = reconcileWorktreeIdentities(current, next)

    expect(result[0]).toBe(a) // identity preserved
    expect(result[1]).toBe(b)
  })

  it('uses the new object only for the worktree whose content changed', () => {
    const a = makeWorktree({ id: 'a', repoId: 'r', lastActivityAt: 1 })
    const b = makeWorktree({ id: 'b', repoId: 'r', lastActivityAt: 1 })
    const current = [a, b]
    const changedB = { ...b, lastActivityAt: 2 } // e.g. agent activity ticked
    const next = [{ ...a }, changedB]

    const result = reconcileWorktreeIdentities(current, next)

    expect(result[0]).toBe(a) // unchanged -> identity preserved
    expect(result[1]).toBe(changedB) // changed -> new identity
  })

  it('returns the next list unchanged when there is no prior list', () => {
    const next = [makeWorktree({ id: 'a', repoId: 'r' })]
    expect(reconcileWorktreeIdentities(undefined, next)).toBe(next)
    expect(reconcileWorktreeIdentities([], next)).toBe(next)
  })

  it('matches by id, preserving identity across reordering', () => {
    const a = makeWorktree({ id: 'a', repoId: 'r' })
    const b = makeWorktree({ id: 'b', repoId: 'r' })
    const next = [{ ...b }, { ...a }] // reordered, same content
    const result = reconcileWorktreeIdentities([a, b], next)
    expect(result[0]).toBe(b)
    expect(result[1]).toBe(a)
  })
})
