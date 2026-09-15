/**
 * help-content — 说明页签的**单一内容源**（说明页签 spec v2 §5/§7）。
 *
 * 三条纪律：
 * 1. 纯数据 + 纯函数（`live` 只读入配置，不碰 ctx/IO），可脱离 DOM 单测；
 * 2. **只描述本版实际 ship 的行为**——未实施的特性不得出现在这里；
 * 3. `FEATURE_KEYS` 与配置面互锁（`test/help-content.test.ts` 的防腐烂闸）：
 *    配置加了字段而说明不补条目 → 测试红。
 *
 * `FALLBACK_HINTS` 在此定义并由设置卡片与说明页**共用**（单一内容源，
 * 杜绝「两处真理」——原定义在 SettingsCard.tsx，2026-09-15 迁移）。
 */
import type { ImageFallback, RouterConfigV4, RouterConfigV5 } from '../config.js'

/** 卡片配置过渡形（与 card-store 的 CardConfig 同形；此处不引入 store 依赖）。 */
export type HelpConfig = RouterConfigV4 | RouterConfigV5

/** imageFallback 三态的一句话后果提示（原 SettingsCard 常量，说明页与规则行共用）。 */
export const FALLBACK_HINTS: Record<ImageFallback, string> = {
  latch: '带图后锁定视觉模型，后续文本轮继续走视觉',
  blind: '文本轮当无图处理——看不到历史图，可能盲答',
  'transcribe-lazy': '文本轮先把历史图转写为文字再作答（多一次视觉调用）',
}

/** dock 面板上的可视元素 id（说明页必须逐个讲到；`data-kt-el` 与之同源）。 */
export const DOCK_ELEMENTS = [
  'label', 'preset-chip', 'baseline-chip', 'decision-chip', 'decision-toggle',
  'kimi-warning', 'week-quota', 'fivehour-quota', 'balance-slot', 'image-context',
  'fetched-at', 'refresh', 'notice', 'dock-states',
] as const

/** 设置页的功能区块 id（说明页必须逐个讲到）。 */
export const SETTINGS_SECTIONS = [
  'presets', 'preset-editor', 'preset-ops', 'rules', 'keyword-groups', 'image-fallback', 'flows', 'trial',
] as const

/**
 * 说明页引用的配置字段路径（防腐烂闸用）：每条都要能在「含全部可选字段的
 * 样例配置」上走通；反向闸要求 schema 顶层键集 ⊆ 本表首段 ∪ LEGACY_CONFIG_KEYS。
 */
export const FEATURE_KEYS = [
  'version',
  'activePreset',
  'presets',
  'presets.saving.name',
  'presets.saving.default',
  'presets.saving.rules',
  'presets.saving.rules.0.when.group',
  'presets.saving.rules.0.when.minHits',
  'presets.saving.rules.0.target',
  'presets.saving.imageFallback',
  'presets.saving.imageFallbackFlow',
  'keywordGroups',
  'auxTargets',
  'flows',
  'flows.transcribe.visionModel',
  'flows.transcribe.failurePolicy',
  'flows.review.trigger',
  'flows.review.keywordGroup',
  'flows.review.rounds',
  'flows.review.autoRevise',
] as const

/** schema 里有、但不承载「用户可理解特性」的遗留键（反向闸豁免）。 */
export const LEGACY_CONFIG_KEYS = ['mode'] as const

export interface HelpEntry {
  id: string
  title: string
  /** 逐行正文（每行一句话；条目 ≤3 行为宜，超出者拆进术语表）。 */
  body: string[]
  /** 关联的 dock 元素 / 设置区块 id（覆盖闸双向校验）。 */
  anchors?: string[]
  /** 状态感知：渲染「当前：…」行；返回 undefined = 该行不渲染（不造噪音）。 */
  live?: (config: HelpConfig) => string | undefined
}

export interface HelpSection {
  id: string
  title: string
  entries: HelpEntry[]
  /** 默认展开（① 面板速览与 ⑦ 常见疑问默认展开：症状优先）。 */
  defaultOpen?: boolean
  /** v5 独有（v4 存量配置下整节隐藏）。 */
  v5Only?: boolean
}

const v5 = (config: HelpConfig): RouterConfigV5 | null => (config.version === 5 ? config : null)
const presetOf = (config: HelpConfig) => (config.activePreset === null ? undefined : config.presets[config.activePreset])
const targetKey = (t: { provider: string; model: string } | undefined): string =>
  t === undefined ? '—' : `${t.provider}/${t.model}`

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'dock',
    title: '面板速览',
    defaultOpen: true,
    entries: [
      {
        id: 'dock-label',
        title: '月汐',
        anchors: ['label'],
        body: ['插件身份标签。鼠标悬停会提示「路由设置见 设置 → 月汐」。'],
      },
      {
        id: 'dock-chain',
        title: '路由链三枚芯片：预设 → 打底 ⟶ 决策目标',
        anchors: ['preset-chip', 'baseline-chip', 'decision-chip'],
        body: [
          '预设：当前激活的规则集；显示「关闭」= 路由被显式关掉，不是故障。',
          '打底：所有规则都没命中时用的默认模型。',
          '决策目标：**本步实际路由到谁**——它和打底不同，就说明这次是规则或显式 @ 生效了。',
        ],
        live: (c) => {
          const preset = presetOf(c)
          if (preset === undefined) return '当前：路由已关闭'
          return `当前：${preset.name} → 打底 ${targetKey(preset.default)}`
        },
      },
      {
        id: 'dock-decision-toggle',
        title: '决策开关（▸ / ▾）',
        anchors: ['decision-toggle'],
        body: ['展开决策可观测悬浮层，看本步为什么这么选。', '**打底与「保持原样」不上屏**——看不到原因条不等于出错。'],
      },
      {
        id: 'dock-quota',
        title: '周配额 / 5h 配额槽（用量源）· 余额槽（API 计费源）',
        anchors: ['week-quota', 'fivehour-quota', 'balance-slot'],
        body: [
          '跟随**当前命中目标**的 provider 自动切换数据源与形态：code plan 显示两个用量窗，API 计费源显示余额。',
          '用量条的条画的是**剩余**比例，与旁边「剩 N%」同向：剩得多条就长、快耗尽时是短红条。',
          '余额槽显示总额（多币种取首个，其余进悬浮提示）；余额不足以调用 API 时会标注「余额不足」。',
        ],
      },
      {
        id: 'dock-image',
        title: '图像上下文槽（原 / 述 / 盲）',
        anchors: ['image-context'],
        body: [
          '本会话图片的三种去向：原生视觉 / 已转述成文字 / 盲答（有图但文本模型看不到）。',
          '盲 > 0 时会追加可见警示——**无图会话不渲染这一行**。',
        ],
      },
      {
        id: 'dock-fetch',
        title: '取数时间与刷新',
        anchors: ['fetched-at', 'refresh'],
        body: ['显示上次成功取配额的时刻；标「(过期)」= 最近一次刷新失败。', '刷新按钮等价于执行 `/kimi-tide refresh`。'],
      },
      {
        id: 'dock-kimi-warning',
        title: '「Kimi 未接入」警示',
        anchors: ['kimi-warning'],
        body: ['缺 kimi-coding 路由或 API key 时的配置指引，不是错误告警。', '去 设置 → 模型 里确认 provider 与 apiKeyEnv 指向。'],
      },
      {
        id: 'dock-states',
        title: '命令失败提示与整体空态',
        anchors: ['notice', 'dock-states'],
        body: [
          '命令失败会在第二行尾部追加一条失败提示。',
          '整体两种空态：「面板数据加载中…」与「暂无面板数据（路由关闭或取数通道不可用）」。',
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: '常见疑问',
    defaultOpen: true,
    entries: [
      {
        id: 'faq-review',
        title: '我配了评审模型，但没评审',
        body: [
          '先看「触发方式」：`手动` 时关键词命中**不会**触发评审（只有 `/kimi-tide review` 会）。',
          '改成「关键词组」并选组后：命中的那一轮照常执行，**轮末**由评审模型异步评一次。',
          '其余可能：本轮没有产出、消息里带了显式 @、或评审模型不可用（界面会标注盲区）。',
        ],
      },
      {
        id: 'faq-no-decision',
        title: '面板没有决策原因条',
        body: ['本步是打底或「保持原样」——这两类按设计不上屏。', '规则命中或显式 @ 才会有原因条。'],
      },
      {
        id: 'faq-quota-dash',
        title: '配额槽显示 —',
        body: [
          '三种原因：当前目标 provider 没有配额源（不适用）；该 provider 的 key 未配置；或取数失败。',
          '看「取数时间」是否标「(过期)」可区分后两种；某个窗口单独显示 — 表示该窗口没有数据（不是满额）。',
        ],
      },
      {
        id: 'faq-route-unexpected',
        title: '路由没按预期切模型',
        body: [
          '规则按**特异度**排序（命中词多者优先、带图恒第一、平手按列表序），排序后首条目标可用者生效。',
          '所以「位置靠后但命中词更多」的规则会赢——展开决策可观测看实际命中理由。',
        ],
      },
      {
        id: 'faq-keyword-miss',
        title: '关键词没命中',
        body: [
          '纯 ASCII 词按**词边界**匹配（`decode` 不会命中 `code`），中文/短语按子串匹配，大小写不敏感。',
          '也可能是该组被评审流认领后规则被抑制，或规则的「最少命中词数」设得偏高。',
        ],
      },
    ],
  },
  {
    id: 'routing',
    title: '路由语义',
    entries: [
      {
        id: 'routing-preset',
        title: '预设与激活',
        anchors: ['presets'],
        body: ['预设 = 一套「默认模型 + 有序规则」；同一时刻只有一个激活。', '「关闭」= 完全不动模型，等于停用路由。'],
        live: (c) => `当前激活：${c.activePreset === null ? '关闭' : c.activePreset}`,
      },
      {
        id: 'routing-rules',
        title: '规则链与特异度',
        anchors: ['rules', 'preset-editor'],
        body: [
          '规则条件两种：带图、或命中所选关键词组（可加「最少命中词数」）。',
          '命中后按特异度排序（命中词多者优先、带图恒第一、平手按列表序），取**首条目标可用者**。',
          '目标在候选目录里不可用 → 跳过该条继续下一条（降级，不是失败）。',
        ],
        live: (c) => {
          const preset = presetOf(c)
          if (preset === undefined || preset.rules.length === 0) return undefined
          const first = preset.rules[0]!
          const when = first.when.kind === 'image' ? '带图' : `${first.when.group} 组 ≥${first.when.minHits ?? 1} 词`
          return `当前：${preset.rules.length} 条规则，首条条件「${when}」`
        },
      },
      {
        id: 'routing-ops',
        title: '预设操作（新建 / 复制 / 删除）',
        anchors: ['preset-ops'],
        body: ['删除预设前需二次确认；被规则引用的预设不会被静默删掉。'],
      },
      {
        id: 'routing-fallback',
        title: '带图兜底三态（imageFallback）',
        anchors: ['image-fallback'],
        body: Object.entries(FALLBACK_HINTS).map(([k, v]) => `${k}：${v}`),
        live: (c) => {
          const preset = presetOf(c)
          if (preset === undefined) return undefined
          const mode = preset.imageFallback ?? 'latch'
          return `当前：${mode} —— ${FALLBACK_HINTS[mode]}`
        },
      },
    ],
  },
  {
    id: 'keywords',
    title: '关键词与匹配',
    entries: [
      {
        id: 'keywords-groups',
        title: '关键词组与词表',
        anchors: ['keyword-groups'],
        body: [
          '内置 7 组（代码 / 审查 / 写作 / 翻译 / 长文 / 数学 / 闲聊），词表可改、可自建新组。',
          '词表用逗号或换行分隔；失焦即保存。',
        ],
        live: (c) => `当前：${Object.keys(c.keywordGroups).length} 组`,
      },
      {
        id: 'keywords-match',
        title: '匹配语义',
        anchors: ['rules'],
        body: [
          '纯 ASCII 词按词边界匹配（`decode` 不误中 `code`）；中文、混合、多词短语按子串匹配。',
          '大小写不敏感；同一词出现多次只计一次。',
        ],
      },
      {
        id: 'keywords-minhits',
        title: '最少命中词数（minHits）',
        anchors: ['keyword-groups', 'rules'],
        body: ['规则级下限：一句话里至少命中该组这么多**不同**词才触发。', '设 2 可避免「做个方案」这类顺带提及误触发。'],
      },
    ],
  },
  {
    id: 'flows',
    title: '协作流',
    v5Only: true,
    entries: [
      {
        id: 'flows-transcribe',
        title: '转述流（transcribe）',
        anchors: ['flows'],
        body: [
          '用视觉模型把图片转成文字，再交给文本模型作答。',
          '失败策略二态：`失败锁存`（保持原生视觉作答）或 `盲答`（当无图处理）。',
        ],
        live: (c) => {
          const flow = v5(c)?.flows.transcribe
          if (flow === undefined || flow.type !== 'transcribe') return undefined
          return `当前：视觉模型 ${targetKey(flow.visionModel)}，失败策略 ${flow.failurePolicy}`
        },
      },
      {
        id: 'flows-review-fields',
        title: '评审流的四个字段',
        anchors: ['flows'],
        body: [
          '评审模型 = **谁来评**；触发方式 = **什么时候评**（两个字段，别混）。',
          '轮次 = 评几轮；自动修订 = 是否让主模型按意见改（本版只呈现意见，不改）。',
        ],
      },
      {
        id: 'flows-trigger',
        title: '触发方式：手动 vs 关键词组',
        anchors: ['flows'],
        body: [
          '`手动`：只有 `/kimi-tide review` 会触发——**关键词命中什么都不做**。',
          '`关键词组`：命中所选组 ≥1 词即武装；本轮照常执行，**轮末**异步评审一次。',
        ],
        live: (c) => {
          const flow = v5(c)?.flows.review
          if (flow === undefined || flow.type !== 'review') return undefined
          return flow.trigger === 'keywords'
            ? `当前：关键词组「${flow.keywordGroup ?? '（未选）'}」——命中即轮末评审`
            : '当前：手动——关键词命中不会触发评审，只有 /kimi-tide review 会'
        },
      },
      {
        id: 'flows-claim',
        title: '认领：被评审流选中的组，规则会失效',
        anchors: ['flows', 'rules'],
        body: [
          '一旦某组被评审流认领，该组绑定**路由规则**被静态抑制（不再整轮切模型）。',
          '这是有意设计：命中评审词时，本轮该干活干活，评审放到轮末。',
        ],
      },
    ],
  },
  {
    id: 'usage',
    title: '用量与余额',
    entries: [
      {
        id: 'usage-sources',
        title: '数据从哪来',
        anchors: ['week-quota', 'fivehour-quota'],
        body: [
          '按 provider 取数：Kimi Code 显示周 / 5h 窗；Z.ai 编码套餐按积分制显示两个窗。',
          '额度槽跟随当前命中目标自动切源；没有套餐的模型不显示数值。',
        ],
      },
      {
        id: 'usage-dash',
        title: '为什么显示 —',
        anchors: ['week-quota', 'fivehour-quota', 'fetched-at'],
        body: [
          '不适用（当前目标没有配额源）／无凭据（key 未配置）／取数失败，三种原因。',
          '取数时间标「(过期)」= 上一次刷新失败，此时显示的是更早的快照。',
        ],
      },
      {
        id: 'usage-refresh',
        title: '刷新节奏',
        anchors: ['refresh'],
        body: ['后台按固定节奏轮询（同一时刻只有一个在途请求）。', '想立刻刷新：点刷新按钮或 `/kimi-tide refresh`。'],
      },
    ],
  },
  {
    id: 'glossary',
    title: '术语表',
    entries: [
      {
        id: 'glossary-terms',
        title: '面板与配置里会看到的词',
        anchors: ['rules'],
        body: [
          '打底：没有规则命中时用的默认模型（未命中 ≠ 不动）。',
          '命中 / 特异度：命中的关键词**种数**，用于排序。',
          '认领：某关键词组被评审流接管，其路由规则失效。',
          '锁存 / 盲答 / 懒转述：带图会话的三种兜底姿态。',
          '过期（stale）：最近一次取数失败，当前显示的是旧快照。',
        ],
      },
    ],
  },
  {
    id: 'commands',
    title: '命令清单',
    entries: [
      {
        id: 'commands-list',
        title: '/kimi-tide 子命令',
        body: [
          '`show` 现状总览 · `panel [--json]` 面板数据 · `refresh` 立刻重取配额。',
          '`export-config` / `import-config <path|inline YAML>` 导出与导入预设。',
          '`review` 手动评审上一轮（有缓存评缓存，无缓存会明说）。',
        ],
      },
      {
        id: 'commands-trial',
        title: '「试一句」测试器',
        anchors: ['trial', 'preset-editor'],
        body: [
          '输入一句话，实时预演命中哪条规则、最终路由到哪个模型。',
          '**仅文本探针**：带图输入只展示规则命中，最终改道还取决于图像护栏与协作流。',
        ],
      },
    ],
  },
]
