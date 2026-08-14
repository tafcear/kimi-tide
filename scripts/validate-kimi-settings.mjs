// validate-kimi-settings.mjs
// 校验 settings.yaml 的 llm-pi-ai 分节是否符合 dsh-llm-pi-ai 的 Config schema。
// 路径经 DSH_HOME / os.homedir() 解析；依赖本地 node_modules。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { Config } from '@deepseek-ai/dsh-llm-pi-ai'

const dshHome = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const settingsPath = join(dshHome, 'settings.yaml')

let raw
try {
  raw = readFileSync(settingsPath, 'utf8')
} catch (error) {
  console.error(`cannot read ${settingsPath}: ${error?.message ?? error}`)
  process.exit(1)
}

let doc
try {
  doc = yaml.load(raw)
} catch (error) {
  console.error(`invalid YAML in ${settingsPath}: ${error?.message ?? error}`)
  process.exit(1)
}

const section = doc?.['llm-pi-ai']
if (section === undefined) { console.log('NO llm-pi-ai section'); process.exit(1) }

try {
  const value = Config(section)
  console.log('schema OK, providers:', Object.keys(value.providers).join(', '))
  for (const [name, p] of Object.entries(value.providers)) {
    console.log(`  ${name}: apiKeyEnv=${p.apiKeyEnv ?? '(none)'} api=${p.api ?? '(catalog)'} baseURL=${p.baseURL ?? '(catalog)'}`)
  }
} catch (e) {
  console.log('schema FAILED:', e.message)
  process.exit(1)
}
