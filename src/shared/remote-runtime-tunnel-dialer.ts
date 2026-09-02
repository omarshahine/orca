import { Agent, type ClientRequestArgs } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { PairingTunnel } from './mobile-relay-pairing-offer'

/** Opens a raw TCP stream to the runtime's WebSocket port through the tunnel named in a pairing offer. */
export type RemoteRuntimeTunnelDialer = (tunnel: PairingTunnel) => Promise<Socket>

// Why process-global: the shared client runs in Electron main and the CLI, and neither can import the
// process that owns the tunnel helper. Each host registers its dialer once at startup; a host that
// never does (the browser bundle, a CLI without tailcat) keeps dialing the plain endpoint.
let registeredDialer: RemoteRuntimeTunnelDialer | null = null

export function setRemoteRuntimeTunnelDialer(dialer: RemoteRuntimeTunnelDialer | null): void {
  registeredDialer = dialer
}

export function getRemoteRuntimeTunnelDialer(): RemoteRuntimeTunnelDialer | null {
  return registeredDialer
}

type CreateConnectionCallback = (error: Error | null, stream: Duplex) => void

/**
 * `http.Agent` whose sockets come from the tunnel instead of `net.connect`.
 *
 * Why an agent and not ws's `createConnection` option: the tunnel handshake is
 * asynchronous, and the agent's `createConnection(options, callback)` form is the
 * documented way to hand `http.request` a socket that is not ready yet.
 */
export class RemoteRuntimeTunnelAgent extends Agent {
  constructor(
    private readonly tunnel: PairingTunnel,
    private readonly dial: RemoteRuntimeTunnelDialer
  ) {
    super({ keepAlive: false })
  }

  createConnection(
    _options: ClientRequestArgs,
    callback?: CreateConnectionCallback
  ): Duplex | null | undefined {
    if (!callback) {
      throw new Error(
        'RemoteRuntimeTunnelAgent only supports the callback form of createConnection'
      )
    }
    this.dial(this.tunnel).then(
      (socket) => callback(null, socket),
      // Why: Node reads only the error argument on failure; the typing still demands a stream slot.
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Error(String(error)),
          null as unknown as Duplex
        )
    )
    return undefined
  }
}
