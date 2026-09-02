import { connect, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { PAIRING_OFFER_VERSION, type PairingOffer } from './mobile-relay-pairing-offer'
import { generateKeyPair, publicKeyToBase64 } from './e2ee-crypto'
import {
  openRemoteRuntimeWebSocket,
  TUNNEL_DIALER_UNAVAILABLE_MESSAGE
} from './remote-runtime-request-websocket'
import { setRemoteRuntimeTunnelDialer } from './remote-runtime-tunnel-dialer'

const tunnel = { v: 1 as const, kind: 'tailcat' as const, token: 'tcTOKEN', port: 6768 }

function pairingOffer(endpoint: string): PairingOffer {
  return {
    v: PAIRING_OFFER_VERSION,
    endpoint,
    deviceToken: 'device-token',
    publicKeyB64: publicKeyToBase64(generateKeyPair().publicKey),
    scope: 'runtime',
    tunnel
  }
}

describe('openRemoteRuntimeWebSocket with a tunnel offer', () => {
  const cleanups: (() => Promise<void> | void)[] = []

  afterEach(async () => {
    setRemoteRuntimeTunnelDialer(null)
    // Why LIFO: the server's close waits for its clients, so sockets opened later must go first.
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup()
    }
  })

  it('dials through the registered tunnel dialer instead of the advertised endpoint', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    const serverPort = (server.address() as AddressInfo).port
    const firstFrame = new Promise<string>((resolve) => {
      server.once('connection', (socket) => {
        socket.once('message', (data) => resolve(data.toString()))
      })
    })
    const dialed: (typeof tunnel)[] = []
    setRemoteRuntimeTunnelDialer(async (requested) => {
      dialed.push(requested)
      return connect({ host: '127.0.0.1', port: serverPort })
    })

    // Why port 1: the advertised endpoint must be unreachable so a direct dial would fail loudly.
    const opened = openRemoteRuntimeWebSocket(pairingOffer('ws://127.0.0.1:1'), {
      onClose: () => {},
      onError: () => {},
      onTextFrame: () => {}
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    cleanups.push(() => {
      opened.socket.cleanup()
      opened.socket.ws.terminate()
    })
    const hello = JSON.parse(await firstFrame) as { type?: string }
    expect(hello.type).toBe('e2ee_hello')
    expect(dialed).toEqual([tunnel])
  })

  it('explains the missing tailcat CLI when only a loopback fallback remains', () => {
    const opened = openRemoteRuntimeWebSocket(pairingOffer('ws://127.0.0.1:6768'), {
      onClose: () => {},
      onError: () => {},
      onTextFrame: () => {}
    })
    expect(opened.ok).toBe(false)
    if (!opened.ok) {
      expect(opened.error.message).toBe(TUNNEL_DIALER_UNAVAILABLE_MESSAGE)
    }
  })

  it('dials a routable advertised endpoint directly when no dialer is registered', () => {
    const opened = openRemoteRuntimeWebSocket(pairingOffer('ws://192.0.2.1:1'), {
      onClose: () => {},
      onError: () => {},
      onTextFrame: () => {}
    })
    // Why: an older client, or one without tailcat, must still try the address the host advertised.
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      opened.socket.cleanup()
      opened.socket.ws.terminate()
    }
  })
})
