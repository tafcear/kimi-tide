import { configKey, DIMS, type Dim, type RouteTarget, type RouterConfigV2 } from './config.js'

// 评分基线 v2：只保留 code/reasoning 两维（有权威基准或强相对证据），
// writing/tooluse/longctx 回退中性 2.5、vision 回退 0（由 modality 决定）。
// 证据分级（顶级规则）：
//   一级   = 基准原文 + 独立交叉（记出处锚点）
//   推断   = 相对排序有据、精确值待核实（验证方法：A 方案逐维取证 / M4.6 离线回放评估）
//   待核实 = 无据，回退中性 2.5，禁止凭感觉填数
// 归一化：score = 基准百分比 / 100 * 5，四舍五入到 1 位小数。
export const SCORES_VERSION = 2

// code（SWE-bench，agentic coding 事实标准）：
//   kimi-tide/k3                93.4% → 4.7  一级  [https://modelfit.io/blog/can-you-run-kimi-k3-locally/]
//                                             官方 vs 独立口径差异见 [https://apidog.com/blog/kimi-k3-benchmarks/]
//   kimi-tide/kimi-for-coding   → 4.5         推断 编码专用模型（Kimi Code K2.x，SWE-bench 逼近 Opus）
//                                             [https://forum.moonshot.ai/t/meet-kimi-k2-6-advancing-open-source-coding/369]，精确值待核实
//   deepseek-official/deepseek-v4-pro  80.6% → 4.0  一级  [https://pypi.org/project/blockrun-llm/]
//                                             hokai.io 同报 V4 系 80.6 [https://hokai.io/hub/models/deepseek-v4]
//   deepseek-official/deepseek-v4-flash → 3.0  推断 轻量档，低于旗舰；无独立 SWE-bench 精确值
// reasoning（GPQA-Diamond）：
//   deepseek-official/deepseek-v4-pro  90.1% → 4.5  一级  [https://pypi.org/project/blockrun-llm/]
//   kimi-tide/k3                → 4.5         推断 frontier 同级（对标 Claude Opus 4.8 / GPT 5.5）
//                                             [https://www.digit.in/features/general/what-is-kimi-k3-...]，GPQA 精确值待核实
//                                             [https://matharena.ai/models/moonshot_k3]
//   kimi-tide/kimi-for-coding   → 3.5         推断 编码专用、通用推理偏弱；待核实
//   deepseek-official/deepseek-v4-flash → 3.0  推断 轻量档；待核实
//
// TODO（A 方案，0.4.0）：逐维全量取证（官方+独立交叉）替换全部「推断」格，provenance 表写进 docs/router-v3.md；
//   M4.6 离线回放评估用真实任务回填。
const BASELINE: Record<string, Partial<Record<Dim, number>>> = {
  'kimi-tide/k3': { code: 4.7, reasoning: 4.5 },
  'kimi-tide/kimi-for-coding': { code: 4.5, reasoning: 3.5 },
  'deepseek-official/deepseek-v4-flash': { code: 3.0, reasoning: 3.0 },
  'deepseek-official/deepseek-v4-pro': { code: 4.0, reasoning: 4.5 },
}

export function scoreFor(cfg: RouterConfigV2, target: RouteTarget): Record<Dim, number> {
  const key = configKey(target)
  const base = BASELINE[key]
  const user = cfg.scores[key]
  const out = {} as Record<Dim, number>
  for (const dim of DIMS) {
    out[dim] = user?.[dim] ?? base?.[dim] ?? (dim === 'vision' ? 0 : 2.5)
  }
  return out
}
