import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PAIRING_OFFER_VERSION,
  PairingOfferSchema,
  type PairingOffer,
  type PairingTunnel
} from './mobile-relay-pairing-offer'
import { decodePairingOffer, encodePairingOffer } from './pairing'
import { addEnvironmentFromPairingCode } from './runtime-environment-store'
import { createEnvironmentFromPairingOffer, getPreferredPairingOffer } from './runtime-environments'
import {
  getRemoteRuntimeTunnelDialer,
  setRemoteRuntimeTunnelDialer
} from './remote-runtime-tunnel-dialer'

const tunnel: PairingTunnel = {
  v: 1,
  kind: 'tailcat',
  token:
    'tco2FwWCBNNXephjfh0aPdFjAU60bmk0dsn6pXpyS18lQ6Y7CUHmFrWCAU3RvbevDi9OlgUzXuM3IjdmvnmzoRvViPRDNnZQBnLmFpGQEu',
  port: 6768
}

const baseOffer: PairingOffer = {
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:6768',
  deviceToken: 'device-token',
  publicKeyB64: `${'a'.repeat(43)}=`,
  scope: 'runtime' as const
}

describe('pairing offer tunnel block', () => {
  it('accepts a tailcat tunnel for runtime and mobile scope', () => {
    for (const scope of ['runtime', 'mobile'] as const) {
      const parsed = PairingOfferSchema.parse({ ...baseOffer, scope, tunnel })
      expect(parsed.tunnel).toEqual(tunnel)
    }
  })

  it('round-trips through the pairing URL', () => {
    const url = encodePairingOffer({ ...baseOffer, tunnel })
    expect(decodePairingOffer(url).tunnel).toEqual(tunnel)
  })

  it.each([
    ['not an address blob', { ...tunnel, token: 'abc123' }],
    ['a blob with a space', { ...tunnel, token: 'tc abc' }],
    ['a blob longer than a SOCKS5 domain', { ...tunnel, token: `tc${'a'.repeat(254)}` }],
    ['an unknown kind', { ...tunnel, kind: 'wireguard' }],
    ['port zero', { ...tunnel, port: 0 }],
    ['a port out of range', { ...tunnel, port: 70000 }]
  ])('rejects %s', (_name, invalid) => {
    expect(PairingOfferSchema.safeParse({ ...baseOffer, tunnel: invalid }).success).toBe(false)
  })

  it('is optional so older hosts keep parsing', () => {
    expect(PairingOfferSchema.parse(baseOffer)).not.toHaveProperty('tunnel')
  })
})

describe('runtime environments with a tunnel', () => {
  it('keeps the tunnel on the saved endpoint and restores it into the preferred offer', () => {
    const environment = createEnvironmentFromPairingOffer({
      id: 'env-1',
      name: 'Tunnel host',
      now: 1,
      offer: { ...baseOffer, tunnel }
    })
    expect(environment.endpoints[0]?.tunnel).toEqual(tunnel)
    expect(getPreferredPairingOffer(environment).tunnel).toEqual(tunnel)
  })

  it('records a tailcat connection dependency when adding from a tunnel pairing code', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-tunnel-env-'))
    const environment = addEnvironmentFromPairingCode(userDataPath, {
      name: 'Tunnel host',
      pairingCode: encodePairingOffer({ ...baseOffer, tunnel })
    })
    expect(environment.connectionDependency).toBe('tailcat')
  })

  it('never records tailcat for an offer without a tunnel', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-tunnel-env-'))
    const environment = addEnvironmentFromPairingCode(userDataPath, {
      name: 'Plain host',
      pairingCode: encodePairingOffer({ ...baseOffer, endpoint: 'ws://100.64.1.20:6768' }),
      connectionDependency: 'tailcat'
    })
    expect(environment).not.toHaveProperty('connectionDependency')
  })
})

describe('remote runtime tunnel dialer registry', () => {
  afterEach(() => {
    setRemoteRuntimeTunnelDialer(null)
  })

  it('is empty until a host registers a dialer', () => {
    expect(getRemoteRuntimeTunnelDialer()).toBeNull()
    const dialer = async (): Promise<never> => {
      throw new Error('unused')
    }
    setRemoteRuntimeTunnelDialer(dialer)
    expect(getRemoteRuntimeTunnelDialer()).toBe(dialer)
  })
})
