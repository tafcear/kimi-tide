#!/usr/bin/env node
/**
 * 验收脚本共用的「配置定位参数」解析（`--config` / `--profile` / `--entry`）。
 *
 * 为什么单独抽出来：`--profile web` 曾被 `check-routes-dualwrite.mjs` **静默忽略**
 * ——它照旧读 desktop 默认值，然后报 PASS。**参数写错却报绿**是验收里最坏的一种失败
 * （2026-10-08 实测：`--profile web` 报 PASS，而同一份文件用 `--config` 读出来是
 * 「还没有 routes」）。这里统一三条纪律：
 *   ① 只认白名单参数，**未知参数立即报错退出（exit 2）**，绝不静默回落；
 *   ② `--config` 与 `--profile` 互斥（前者给文件，后者给 profile 名）；
 *   ③ 默认值用 `$DSH_HOME`（回落 `~/.dsh`）解析，**不再硬编码某台机器的绝对路径**；
 *      文件不存在就报错退出，而不是继续算出一份假结果。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** profile 名 → 该 profile 的 cordis.patch.yml 路径。 */
export const profilePatchPath = (profile) => join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml')

function die(message, usage) {
  console.error(`[参数错误] ${message}`)
  if (usage !== undefined) console.error(`\n${usage}`)
  process.exit(2)
}

/**
 * @param {string[]} argv              process.argv.slice(2)
 * @param {object}   options
 * @param {string}   options.usage     出错时打印的用法（含本脚本自己的参数说明）
 * @param {string[]} [options.flags]   额外允许的布尔开关（不带值，如 'json'）
 * @param {string}   [options.defaultProfile] 默认 profile（默认 'desktop'）
 * @returns {{configPath: string, entryId: string, profile: string|null, flags: Record<string, boolean>}}
 */
export function resolveConfigArgs(argv, { usage, flags = [], defaultProfile = 'desktop' } = {}) {
  const valueFlags = new Set(['config', 'profile', 'entry'])
  const boolFlags = new Set(flags)
  const values = {}
  const seen = new Set()

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) die(`不认识的参数：${token}（本脚本不接受位置参数）`, usage)
    const key = token.slice(2)
    if (boolFlags.has(key)) { seen.add(key); continue }
    if (!valueFlags.has(key)) die(`不认识的参数：${token}`, usage)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) die(`${token} 需要跟一个值`, usage)
    if (values[key] !== undefined) die(`${token} 给了不止一次`, usage)
    values[key] = next
    i += 1
  }

  if (values.config !== undefined && values.profile !== undefined) {
    die('--config 与 --profile 只能给一个：--config 指文件路径，--profile 指 $DSH_HOME/profiles/<名字>/cordis.patch.yml', usage)
  }

  const usingDefault = values.config === undefined && values.profile === undefined
  const profile = usingDefault ? defaultProfile : (values.profile ?? null)
  const configPath = values.config !== undefined
    ? (isAbsolute(values.config) ? values.config : resolve(process.cwd(), values.config))
    : profilePatchPath(profile)

  if (!existsSync(configPath)) {
    die(
      `配置文件不存在：${configPath}` +
        (usingDefault ? `（默认读 ${defaultProfile} profile；用 --profile <名字> 或 --config <文件> 指定别的）` : ''),
      usage,
    )
  }

  const out = { configPath, entryId: values.entry ?? 'dsh-kimi-tide', profile, flags: {} }
  for (const name of seen) out.flags[name] = true
  return out
}
