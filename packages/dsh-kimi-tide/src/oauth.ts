/**
 * kimi-tide: Kimi Code subscription OAuth credential manager.
 *
 * Reads the credential file written by `kimi login` (default
 * ~/.kimi-code/credentials/kimi-code.json; KIMI_CODE_HOME wins), refreshes
 * the access token with the stored refresh_token, and writes the rotated pair
 * back so the kimi CLI and this plugin keep sharing one login. Access tokens
 * live ~15 minutes; the host plugin schedules `refresh()` on an interval.
 *
 * The credential file is guarded by a shared lock (`.lock` sibling) also
 * honoured by kimi-token-refresh.ps1: refresh tokens rotate on every grant,
 * so two writers refreshing concurrently would invalidate each other's
 * refresh_token. Writes are atomic (temp file + rename).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import os from 'node:os'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const TOKEN_URL = 'https://auth.kimi.com/api/oauth/token'
/** A lock older than this is considered abandoned (crashed writer) and stolen. */
const LOCK_STALE_MS = 5 * 60 * 1000

export interface KimiCredential {
  access_token: string
  refresh_token: string
  expires_at: number
  scope?: string
  token_type?: string
  expires_in?: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number | string
  scope?: string
  token_type?: string
}

export interface OAuthLogger {
  warn: (message: string) => void
  error: (message: string) => void
}

export interface KimiOAuthOptions {
  /** Kimi home directory (default: KIMI_CODE_HOME, else ~/.kimi-code). */
  home: string
  /** Explicit HTTPS proxy for the token endpoint (falls back to direct). */
  proxyUrl?: string
  timeoutMs?: number
}

export class KimiOAuthManager {
  private accessToken = ''
  private expiresAt = 0
  private readonly home: string
  private readonly proxyUrl: string | undefined
  private readonly timeoutMs: number

  constructor(
    private readonly logger: OAuthLogger,
    options: KimiOAuthOptions,
  ) {
    this.home = options.home || process.env.KIMI_CODE_HOME || join(os.homedir(), '.kimi-code')
    this.proxyUrl = options.proxyUrl
    this.timeoutMs = options.timeoutMs ?? 30000
  }

  credentialFile(): string {
    return join(this.home, 'credentials', 'kimi-code.json')
  }

  /** Current access token; empty until the first successful refresh. */
  getAccessToken(): string {
    return this.accessToken
  }

  /** Remaining lifetime of the current access token in ms (0 = expired/absent). */
  remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now())
  }

  /** Lock file shared with kimi-token-refresh.ps1; serializes refresh-token rotation. */
  private lockFile(): string {
    return this.credentialFile() + '.lock'
  }

  private lockIsStale(lock: string): boolean {
    try {
      const info = JSON.parse(readFileSync(lock, 'utf8')) as { pid?: unknown; time?: unknown }
      const t = typeof info.time === 'string' ? Date.parse(info.time) : Number.NaN
      if (Number.isFinite(t)) return Date.now() - t > LOCK_STALE_MS
    } catch { /* unreadable lock: fall through to mtime */ }
    try {
      return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
    } catch {
      return false
    }
  }

  private tryAcquireLock(): boolean {
    const lock = this.lockFile()
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        mkdirSync(dirname(lock), { recursive: true })
        const fd = openSync(lock, 'wx')
        try {
          writeFileSync(fd, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }), 'utf8')
        } finally {
          closeSync(fd)
        }
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          this.logger.warn(`dsh-kimi-tide: cannot create credential lock: ${(error as Error).message}`)
          return false
        }
        // Lock exists: steal it only when stale (a crash left it behind).
        if (!this.lockIsStale(lock)) {
          this.logger.warn('dsh-kimi-tide: another refresh holds the credential lock, skipping this round')
          return false
        }
        try { unlinkSync(lock) } catch { return false }
      }
    }
    return false
  }

  private releaseLock(): void {
    try { unlinkSync(this.lockFile()) } catch { /* already gone */ }
  }

  private readCredential(): KimiCredential | null {
    try {
      const file = this.credentialFile()
      if (!existsSync(file)) return null
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as KimiCredential
      if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token.length === 0) return null
      return parsed
    } catch (error) {
      this.logger.warn(`dsh-kimi-tide: cannot read kimi credential: ${(error as Error).message}`)
      return null
    }
  }

  /** Whether a kimi login state exists (credential file with a refresh_token). Quiet probe. */
  hasCredential(): boolean {
    try {
      const file = this.credentialFile()
      if (!existsSync(file)) return false
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as KimiCredential
      return typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
    } catch {
      return false
    }
  }

  /**
   * Exchange the stored refresh_token for a fresh access/refresh pair.
   * Validates the response before mutating any state or file; never writes
   * blank values. Serialized with the external refresh script via the shared
   * lock. Returns true on success.
   */
  async refresh(): Promise<boolean> {
    if (!this.tryAcquireLock()) return false
    try {
      return await this.refreshLocked()
    } finally {
      this.releaseLock()
    }
  }

  private async refreshLocked(): Promise<boolean> {
    const credential = this.readCredential()
    if (!credential) {
      this.logger.error('dsh-kimi-tide: no kimi credential file — run "kimi login" first')
      return false
    }
    const body = `client_id=${CLIENT_ID}&grant_type=refresh_token&refresh_token=${encodeURIComponent(credential.refresh_token)}`
    let response: TokenResponse | null = null
    try {
      response = await this.postToken(body)
    } catch (error) {
      this.logger.warn(`dsh-kimi-tide: token refresh failed: ${(error as Error).message}`)
      return false
    }
    const access = typeof response.access_token === 'string' ? response.access_token : ''
    const refresh = typeof response.refresh_token === 'string' ? response.refresh_token : ''
    const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : (response.expires_in !== undefined ? Number(response.expires_in) : 0)
    if (access.length < 100 || refresh.length < 100 || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      this.logger.error(`dsh-kimi-tide: token refresh response invalid (access=${access.length} refresh=${refresh.length} expires_in=${expiresIn}) — refusing to update credentials`)
      return false
    }
    this.accessToken = access
    this.expiresAt = Date.now() + expiresIn * 1000
    try {
      const next: KimiCredential = {
        access_token: access,
        refresh_token: refresh,
        expires_at: Math.floor(this.expiresAt / 1000),
        scope: response.scope ?? 'kimi-code',
        token_type: response.token_type ?? 'Bearer',
        expires_in: expiresIn,
      }
      this.writeCredentialAtomic(JSON.stringify(next, null, 2))
    } catch (error) {
      this.logger.warn(`dsh-kimi-tide: could not write rotated credential back: ${(error as Error).message}`)
    }
    return true
  }

  /** Atomic write: temp file in the same directory, then rename over the target. */
  private writeCredentialAtomic(content: string): void {
    const target = this.credentialFile()
    const tmp = join(dirname(target), `.kimi-code.json.tmp-${process.pid}-${Date.now()}`)
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, target)
  }

  private async postToken(body: string): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...attributionHeaders(),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      if (/invalid_grant/.test(text)) {
        throw new Error('invalid_grant: kimi refresh token rejected — re-run "kimi login" to re-authenticate')
      }
      throw new Error(`kimi token endpoint ${response.status}: ${text.slice(0, 200)}`)
    }
    try {
      return JSON.parse(text) as TokenResponse
    } catch (error) {
      throw new Error(`kimi token endpoint returned invalid JSON: ${(error as Error).message}`)
    }
  }
}
