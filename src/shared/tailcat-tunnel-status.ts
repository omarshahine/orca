export type TailcatTunnelServerState = 'stopped' | 'starting' | 'running' | 'failed'

/** What the renderer needs to explain the Tailcat option: is the CLI here, and is the tunnel up. */
export type TailcatTunnelStatus = {
  installed: boolean
  binaryPath: string | null
  installHint: string
  server: { state: TailcatTunnelServerState; port: number | null }
}
