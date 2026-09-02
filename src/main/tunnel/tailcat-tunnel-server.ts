import { existsSync } from 'node:fs'
import { runProcess, spawnProcess } from '../../shared/child-process/run-process'
import { tailcatKeyPathArgument } from './tailcat-binary'
import { onProcessOutputLines } from './tailcat-process-output'
import type { TailcatProcessRunner, TailcatProcessSpawner } from './tailcat-socks-proxy'
import type { TailcatTunnelServerState } from '../../shared/tailcat-tunnel-status'

export type { TailcatTunnelServerState }

export type TailcatTunnelServerOptions = {
  binary: string
  /** Persistent server identity: the address blob derives from it, so the pairing link survives restarts. */
  keyPath: string
  spawn?: TailcatProcessSpawner
  run?: TailcatProcessRunner
  logf?: (message: string) => void
  startTimeoutMs?: number
  restartDelaysMs?: readonly number[]
  onStateChange?: (state: TailcatTunnelServerState) => void
}

const DEFAULT_START_TIMEOUT_MS = 30_000
// Why: `--fixed-region` runs a latency probe against every relay region before it can write the key.
const KEYGEN_TIMEOUT_MS = 60_000
const DEFAULT_RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

/**
 * Supervises `tailcat serve <port>`, which reverse-proxies tunnel connections to the runtime's
 * loopback WebSocket port. The WebSocket listener itself never needs to leave loopback.
 */
export class TailcatTunnelServer {
  private child: ReturnType<typeof spawnProcess> | null = null
  private token: string | null = null
  private port: number | null = null
  private state: TailcatTunnelServerState = 'stopped'
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempt = 0
  private starting: Promise<string> | null = null

  constructor(private readonly options: TailcatTunnelServerOptions) {}

  getState(): TailcatTunnelServerState {
    return this.state
  }

  getToken(): string | null {
    return this.token
  }

  getPort(): number | null {
    return this.port
  }

  /** Resolves with the address blob once tailcat is listening. Re-entrant while starting. */
  start(port: number): Promise<string> {
    if (this.state === 'running' && this.token && this.port === port) {
      return Promise.resolve(this.token)
    }
    if (this.starting && this.port === port) {
      return this.starting
    }
    this.port = port
    this.starting = this.launch().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  async stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    this.port = null
    this.setState('stopped')
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        child.kill()
      })
    }
  }

  private async launch(): Promise<string> {
    this.setState('starting')
    try {
      await this.ensureServerKey()
      const token = await this.spawnServe()
      this.restartAttempt = 0
      this.token = token
      this.setState('running')
      return token
    } catch (error) {
      this.setState('failed')
      throw error
    }
  }

  private spawnServe(): Promise<string> {
    const port = this.port
    if (port === null) {
      return Promise.reject(new Error('Tailcat tunnel server has no port'))
    }
    const spawn = this.options.spawn ?? spawnProcess
    const child = spawn({
      program: this.options.binary,
      args: [
        `--key=${tailcatKeyPathArgument(this.options.keyPath)}`,
        '--json',
        'serve',
        '--full-address',
        String(port)
      ],
      timeoutMs: null
    })
    this.child = child
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        finish(new Error('Timed out waiting for tailcat serve to start'))
      }, this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)
      const detachStdout = onProcessOutputLines(child.stdout, (line) => {
        const token = parseListenAddress(line)
        if (token) {
          finish(null, token)
        }
      })
      const detachStderr = onProcessOutputLines(child.stderr, (line) => {
        this.options.logf?.(`[tailcat serve] ${line}`)
      })
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        detachStderr()
        if (this.child !== child) {
          return
        }
        this.child = null
        const error = new Error(`tailcat serve exited (${signal ?? code ?? 'unknown'})`)
        if (this.state === 'running') {
          this.scheduleRestart(error)
        }
        finish(error)
      }
      const onError = (error: Error): void => finish(error)
      const finish = (error: Error | null, token?: string): void => {
        clearTimeout(timeout)
        detachStdout()
        child.off('error', onError)
        if (error) {
          if (this.child === child) {
            this.child = null
            child.kill()
          }
          reject(error)
          return
        }
        resolve(token!)
      }
      child.on('exit', onExit)
      child.on('error', onError)
    })
  }

  private scheduleRestart(error: Error): void {
    const delays = this.options.restartDelaysMs ?? DEFAULT_RESTART_DELAYS_MS
    const delay = delays[Math.min(this.restartAttempt, delays.length - 1)] ?? 0
    this.restartAttempt += 1
    this.options.logf?.(`[tailcat serve] ${error.message}; restarting in ${delay}ms`)
    this.setState('starting')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.port === null) {
        return
      }
      this.starting = this.launch()
        .catch(() => {
          // Why: a failed relaunch is already logged; the next exit handler or stop() owns the state.
        })
        .then(() => this.token ?? '')
        .finally(() => {
          this.starting = null
        })
    }, delay)
  }

  private async ensureServerKey(): Promise<void> {
    if (existsSync(this.options.keyPath)) {
      return
    }
    const run = this.options.run ?? runProcess
    const result = await run({
      program: this.options.binary,
      args: ['genkey', `--key=${tailcatKeyPathArgument(this.options.keyPath)}`, '--fixed-region'],
      timeoutMs: KEYGEN_TIMEOUT_MS
    })
    if (result.code !== 0) {
      throw new Error(`tailcat genkey failed: ${result.stderr.trim() || result.code}`)
    }
  }

  private setState(state: TailcatTunnelServerState): void {
    if (this.state === state) {
      return
    }
    this.state = state
    this.options.onStateChange?.(state)
  }
}

export function parseListenAddress(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as { listenAddr?: unknown }
    return typeof parsed.listenAddr === 'string' && parsed.listenAddr.startsWith('tc')
      ? parsed.listenAddr
      : null
  } catch {
    return null
  }
}
