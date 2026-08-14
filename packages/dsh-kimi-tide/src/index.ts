/**
 * dsh-kimi-tide — 月汐
 *
 * Kimi Code (Moonshot) subscription as a native DeepSeek Harness LLM
 * provider. The plugin owns one provider route (default `kimi-tide`) served
 * by a pi-ai-backed adapter and keeps the subscription OAuth token fresh
 * with an in-process timer — no external scripts, no scheduled tasks, no
 * credential-file copying: the kimi CLI login state is shared in place.
 *
 * Models (from the pi-ai kimi-coding catalog):
 *   kimi-for-coding · kimi-for-coding-highspeed · k3 · k3-256k
 *
 * Configuration (cordis.yml / patch):
 *   dsh-kimi-tide:
 *     providerName: kimi-tide
 *     kimiHome: ''            # default ~/.kimi-code (KIMI_CODE_HOME wins)
 *     refreshIntervalMs: 600000
 */
import { Context } from '@deepseek-ai/cordis'
// Type-only import: pulls in the cordis Context augmentation for ctx.setInterval
// (provided at runtime by the host's cordis-plugin-timer bundle).
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { KimiAdapter } from './adapter.js'
import { KimiOAuthManager } from './oauth.js'

export const name = 'dsh-kimi-tide'

export const inject = ['llm', 'timer']

export interface Config {
  /** Provider route name registered into ctx.llm. */
  providerName?: string
  /** Kimi home directory; default follows KIMI_CODE_HOME then ~/.kimi-code. */
  kimiHome?: string
  /** Token refresh period in milliseconds (access tokens live ~15 min). */
  refreshIntervalMs?: number
  /** Refresh immediately on startup (default true). */
  refreshOnStart?: boolean
}

export function apply(ctx: Context, config: Config = {}) {
  const providerName = config.providerName ?? 'kimi-tide'
  const refreshIntervalMs = config.refreshIntervalMs ?? 10 * 60 * 1000
  const oauth = new KimiOAuthManager(ctx.logger, {
    home: config.kimiHome ?? '',
  })
  const adapter = new KimiAdapter(oauth, { providerName })

  ctx.llm.registerAdapter([providerName], adapter)

  const refresh = () => {
    void oauth.refresh().catch(() => {})
  }
  if (config.refreshOnStart !== false) {
    void oauth.refresh().catch(() => {})
  }
  ctx.effect(() => {
    const timer = ctx.setInterval(refresh, refreshIntervalMs)
    return () => timer()
  })
}
