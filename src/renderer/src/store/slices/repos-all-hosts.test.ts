import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type { Repo } from '../../../../shared/types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'

const localRepo: Repo = {
  id: 'local-repo',
  path: '/local',
  displayName: 'Local',
  badgeColor: '#000',
  addedAt: 1
}

const remoteRepo: Repo = {
  id: 'remote-repo',
  path: '/srv/repo',
  displayName: 'Remote',
  badgeColor: '#000',
  addedAt: 1
}

const reposList = vi.fn()
const projectsList = vi.fn()
const listHostSetups = vi.fn()
const runtimeEnvironmentsList = vi.fn()
const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const dispatchEventMock = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  reposList.mockReset()
  projectsList.mockReset()
  listHostSetups.mockReset()
  runtimeEnvironmentsList.mockReset()
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  dispatchEventMock.mockReset()

  reposList.mockResolvedValue([localRepo])
  projectsList.mockResolvedValue([])
  listHostSetups.mockResolvedValue([])
  runtimeEnvironmentsList.mockResolvedValue([{ id: 'env-1', name: 'lobster' }])
  runtimeEnvironmentCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    if (args.method === 'repo.list') {
      return {
        id: 'rpc-repo-list',
        ok: true,
        result: { repos: [remoteRepo] },
        _meta: { runtimeId: 'runtime-remote' }
      }
    }
    return {
      id: 'rpc-other',
      ok: true,
      result: { projects: [], setups: [] },
      _meta: { runtimeId: 'runtime-remote' }
    }
  })
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })

  vi.stubGlobal('window', {
    api: {
      repos: { list: reposList },
      projects: { list: projectsList, listHostSetups: listHostSetups },
      runtimeEnvironments: {
        call: runtimeEnvironmentTransportCall,
        list: runtimeEnvironmentsList
      }
    },
    dispatchEvent: dispatchEventMock
  })
})

describe('fetchReposForAllHosts', () => {
  it('loads local + all configured runtime environments even when a remote env is active', async () => {
    // Why: a cold start that restored a remote workspace leaves the remote
    // environment active. The active-host-only fetchRepos would drop local
    // repos entirely; fetchReposForAllHosts must surface both.
    const store = createTestStore()
    store.setState({ settings: { activeRuntimeEnvironmentId: 'env-1' } as never })

    await store.getState().fetchReposForAllHosts()

    const ids = store
      .getState()
      .repos.map((repo) => repo.id)
      .sort()
    expect(ids).toEqual(['local-repo', 'remote-repo'])
  })

  it('fails soft when a runtime environment is unreachable, keeping local repos', async () => {
    runtimeEnvironmentCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
      if (args.method === 'repo.list') {
        throw new Error('runtime_unreachable')
      }
      return {
        id: 'rpc-other',
        ok: true,
        result: { projects: [], setups: [] },
        _meta: { runtimeId: 'runtime-remote' }
      }
    })
    const store = createTestStore()
    store.setState({ settings: { activeRuntimeEnvironmentId: 'env-1' } as never })

    await store.getState().fetchReposForAllHosts()

    expect(store.getState().repos.map((repo) => repo.id)).toEqual(['local-repo'])
  })
})
