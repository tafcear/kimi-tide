/**
 * help-content — 说明页签的**单一内容源**（说明页签 spec v2 §5/§7）。
 *
 * 三条纪律：
 * 1. 纯数据 + 纯函数（`live` 只读入配置，不碰 ctx/IO），可脱离 DOM 单测；
 * 2. **只描述本版实际 ship 的行为**——未实施的特性不得出现在这里；
 * 3. `FEATURE_KEYS` 与配置面互锁（`test/help-content.test.ts` 的防腐烂闸）：
 *    **顶层**配置字段加了而说明不补条目 → 测试红（嵌套/可选新字段靠人与评审把关，
 *    见 2026-09-15 评审 #2：反向闸只遍历 schema 顶层键）。
 *
 * `FALLBACK_HINTS` 在此定义并由设置卡片与说明页**共用**（单一内容源，
 * 杜绝「两处真理」——原定义在 SettingsCard.tsx，2026-09-15 迁移）。
 */
import type { ImageFallback, RouterConfigV4, RouterConfigV5, RouterConfigV5Plus, RouterConfigV6 } from '../config.js'
import { isV5Plus } from '../config.js'

/** 卡片配置过渡形（与 card-store 的 CardConfig 同形；此处不引入 store 依赖）。 */
export type HelpConfig = RouterConfigV4 | RouterConfigV5 | RouterConfigV6

/** imageFallback 三态的一句话后果提示（原 SettingsCard 常量，说明页与规则行共用）。 */
export const FALLBACK_HINTS: Record<ImageFallback, string> = {
  latch: '带图后锁定视觉模型，后续文本轮继续走视觉',
  blind: '文本轮当无图处理——看不到历史图，可能盲答',
  'transcribe-lazy': '文本轮先把历史图转写为文字再作答（多一次视觉调用）',
}

/** dock 面板上的可视元素 id（说明页必须逐个讲到；`data-kt-el` 与之同源）。 */
export const DOCK_ELEMENTS = [
  'label', 'preset-chip', 'baseline-chip', 'decision-chip', 'decision-toggle',
  'kimi-warning', 'week-quota', 'fivehour-quota', 'balance-slot', 'overview-toggle', 'image-context',
  'dispatch', 'fetched-at', 'refresh', 'notice', 'dock-states',
] as const

/** 设置页的功能区块 id（说明页必须逐个讲到）。`driver` = 主驱动卡（Task 8 补锚点，
 *  前序 carry②：该条目原先只锚 dock 的 dispatch 元素）。 */
export const SETTINGS_SECTIONS = [
  'presets', 'preset-editor', 'preset-ops', 'rules', 'keyword-groups', 'image-fallback', 'hit-confirm', 'flows', 'trial', 'roles', 'driver',
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
  'flows.review.recheck',
  // v6（团队派发）顶层键：说明条目见「路由语义」区的 routing-roles / routing-driver。
  'driver',
  'driverSticky',
  'rulesApplyToChildren',
  'roles',
  // v7（统一路由表）：`routes` 是 v2.1.0 起的**真源**（旧字段降为镜像）。
  // 它不在 routerConfigSchema 的顶层键里（schemastery 未知键透传，实测往返不丢），
  // 所以反向闸扫不到它——这里显式登记，保证「样例配置能走通」这条正向闸覆盖它。
  'routes',
  'routes.0.scope',
  'routes.0.when',
  'routes.0.target',
] as const

/** schema 里有、但不承载「用户可理解特性」的遗留键（反向闸豁免）。 */
export const LEGACY_CONFIG_KEYS = ['mode'] as const

/** 导览条目（与 HelpEntry 同形，但**没有 live**：纯静态说明，不读配置）。 */
export interface HelpWhatsNewEntry {
  id: string
  title: string
  body: string[]
}

/**
 * 「本次新版」导览（v2.1.0「路由信息架构统一」）。静态、只读、无 live 值——
 * 讲清这一版路由页怎么读，细节见仓库 packages/dsh-kimi-tide/docs/router.md
 * 的「2.1.0 统一路由表（v7）」节。
 *
 * 为什么与 HELP_SECTIONS 分开：HELP_SECTIONS 受**覆盖闸**约束（8 分区、锚点双向
 * 覆盖、FEATURE_KEYS 防腐烂），这组导览是**按版本轮替**的时效文案、没有锚点也不
 * 参与覆盖；放进内容源只是为了「单一内容源」——它此前内联在 HelpTab.tsx 里
 * （2026-10-07 迁入）。下一版若无新版导览，整块替换即可。
 */
export const WHATS_NEW: readonly HelpWhatsNewEntry[] = [
  {
    id: 'whatsnew-chain',
    title: '路由页从「四个并列控件」改成一条五档决策链',
    body: [
      '一条消息会被谁决定用哪个模型，按优先级从上到下排：**显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 打底**。',
      '每档三行：什么时候轮到它 / 当前生效值 / 关掉它会怎样。**分工表**内联在第 3 档、**规则编辑器**内联在第 4 档。',
      '每档带一个状态徽标：**已就绪**（此刻真的参与裁决）/ **按需**（写 `@` 或子代理点名时才参与）/ **未启用**（当前配置下没东西，置灰）。',
      '**打底档现在显式可见**（并写明来源：主驱动恒定 / 预设默认 / 跟随宿主默认）；没启用的档位只是置灰，不是消失。',
      '页面顶部一句话摘要当前局面；一条规则都没配时它也说人话——「未命中任何规则 ⇒ 全部走打底（…）；已备 N 组词表无规则引用，暂不生效」。',
    ],
  },
  {
    id: 'whatsnew-scope',
    title: '作用域：规则行「主会话」 vs 角色行「派发时」',
    body: [
      '关键词规则只服务**主会话**，分工表只服务**队友**（子代理默认不参与关键词规则）——两者本来就不冲突，冲突感来自界面上没说清。',
      '所以规则行挂「主会话」徽标、分工角色行挂「派发时」徽标；两个词一贴，「打架」就变成「分工」。',
      '派发台账的依据也是这套口径：`role` = 分工表认领 / `explicit` = 显式点名 / `keep` = 保持原样 / `unclaimed` = 不在分工表。',
    ],
  },
  {
    id: 'whatsnew-routes',
    title: '统一路由表 `routes`（配置 v7）',
    body: [
      '配置里两类行合成一张表：`scope: session` 行 = 主会话规则（带图 / 关键词组，带 `preset` 归属），`scope: dispatch` 行 = 分工角色。',
      '**`routes` 存在即真源**；旧字段（`presets[*].rules` / `roles`）保留为**镜像**——删掉 `routes` 段即回退旧字段口径，功能不崩。',
      '运行期按**字段**判据读，不看版本号：配置里显式写 `version: 5` 或 `6` 同样正常，设置页写入也不改你的 `version`。',
      '手改配置时若两处不一致，写入期校验会**拒绝并指出冲突位置**（不静默择一）。',
    ],
  },
  {
    id: 'whatsnew-write',
    title: '保存规则 / 角色时「双写」',
    body: [
      '保存规则或分工角色时，同一笔写会**同时**下发 `routes` 与镜像后的旧字段，文件里两处永远一致。',
      '通道上是**三笔序列**：先摘掉 `routes` → 写旧字段 → 写回 `routes`（顺序是硬约束：宿主逐笔校验两处一致性，中间态不合法就会拒写）。',
      '写后照旧比对「意图值 vs 实读值」——被拒会明确报「写入被拒绝」，不静默吞掉。',
    ],
  },
  {
    id: 'whatsnew-dispatch-preview',
    title: '测试场「派给谁」：派发层预览',
    body: [
      '输入或选一个角色 / 队友名，看它会改道到哪个模型、依据是什么（`role` / `unclaimed`）。',
      '它与「试一句」是**两套作用域**：「试一句」算主会话的关键词规则，「派给谁」算派发时的分工表改道。',
      '分工表里另有「**从词表生成角色**」：把还没有任何规则引用的词表组批量生成角色行（目标先取当前预设默认模型，可在下拉里改）。',
    ],
  },
  {
    id: 'whatsnew-wiring',
    title: '词表接线徽标与重叠解释条',
    body: [
      '每组词表都标出接线状态：`被 N 条规则引用` / `被协作流认领` / `⚠ 悬空`——空表不是坏了，是没接线。',
      '同一个词既是规则对象、又是某角色的身份词（id / 显示名 / 别名）且两边目标不同时，词表行与角色行各挂一条**解释条（不是报错）**：',
      '「主会话说『代码』走 A；派给『后端』做走 B」——两套作用域各走各的，本就不冲突；旁边还有一键把规则目标改成该角色目标的动作。',
    ],
  },
]

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

const v5 = (config: HelpConfig): RouterConfigV5Plus | null => (isV5Plus(config) ? config : null)
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
          '工具行右端的紧凑态把这三枚合成一枚按钮：`省钱 → deepseek-flash`——右侧有目标时是**决策目标**，没有时是**打底**。',
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
        body: ['展开决策可观测悬浮层，看本步为什么这么选。', '**打底与「保持原样」不上屏**——看不到原因条不等于出错。', '紧凑态：点那枚「预设 → 目标」按钮就是开关。'],
      },
      {
        id: 'dock-quota',
        title: '周配额 / 5h 配额槽（用量源）· 余额槽（API 计费源）',
        anchors: ['week-quota', 'fivehour-quota', 'balance-slot'],
        body: [
          '跟随**当前命中目标**的 provider 自动切换数据源与形态：code plan 显示两个用量窗，API 计费源显示余额。',
          '紧凑态只显示一枚摘要（`¥3.94` 或 `周剩NN%`），点它展开**用量总览**看全部源与明细。',
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
        id: 'dock-dispatch',
        title: '派发槽（团队派发摘要）',
        anchors: ['dispatch'],
        body: [
          '最近一次把专项活派给哪个角色的模型，以及依据（role=分工表角色 / explicit=显式点名 / keep=保持原样 / unclaimed=未在分工表）。',
          '展开决策可观测悬浮层可看最近 20 条派发明细（新在前）。',
          '本会话还没有派发记录时不渲染这一槽。',
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
        id: 'faq-revise',
        title: '评审说不通过，但模型没有重做',
        body: [
          '先看设置页「**自动修订**」有没有勾（默认关）：没勾时评审只给意见，不会自动退回。',
          '没勾也能手动退：评审卡上点「**让它重做**」，或打 `/kimi-tide revise`。',
          '勾了还没退：看结论是不是「通过」；再看是不是**已达上限**（每会话＝「轮次」次，到顶后事件卡标「已停（达上限）」）。',
        ],
      },
      {
        id: 'faq-at-ignored',
        title: '我写了 @xxx，但路由没按它走',
        body: [
          '**只有真的 provider 才算指令**：`@` 后面若是工作区路径引用（`@README.md`）或 scoped 包名（`node_modules/@deepseek-ai/…`），不会被当成显式指令——该轮照常走关键词规则。',
          '决策原因条会写明「`@x` 非本路由器已知 provider（已忽略）」；想点名就用 `@kimi` 或 `@provider/model`。',
          '另一种情况：provider 认识、但当前没有可用模型（如 key 未配置）——这时**不会**改道，原因是「provider 已知但当前无可路由模型」。',
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
        live: (c) => `当前激活：${presetOf(c)?.name ?? (c.activePreset ?? '关闭')}`,
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
        id: 'routing-hit-confirm',
        title: '语义命中确认（默认关闭）',
        anchors: ['hit-confirm'],
        body: [
          '开启后关键词命中不会立刻改道——先让**本预设的默认模型**判断「这是本轮的真意图吗」。',
          '判否 ⇒ 跳过该条规则、继续匹配后续规则；**问不到**（超时/模型不可用/输出读不出）⇒ 按原关键词结果走。',
          '显式 @ 轮与「带图规则已排首位」的轮不会调用判官（结果不可能生效，白花一次调用）。',
        ],
        live: (c) => {
          const preset = presetOf(c)
          if (preset === undefined) return undefined
          const gate = preset.hitConfirm
          return gate?.enabled === true
            ? `当前：已开启（判官 ${targetKey(preset.default)}，超时 ${gate.timeoutMs ?? 1200}ms）`
            : '当前：关闭——关键词命中直接按规则改道'
        },
      },
      {
        id: 'routing-ops',
        title: '预设操作（新建 / 复制 / 删除）',
        anchors: ['preset-ops'],
        body: [
          '删除预设前需二次确认（按钮会先变成「确认删除？」）。',
          '规则指向的是**模型**、不指向预设，所以删掉一个预设不会牵连别的配置。',
        ],
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
      {
        id: 'routing-roles',
        title: '分工表（角色 = 领域 → 模型）',
        anchors: ['roles'],
        body: [
          '每个角色一行：显示名 + id（lower-kebab-case，即默认认领的队友名）+ 目标模型 + 额外认领的队友名 + 别名。',
          '认领名（id 与队友名合起来的集合）不得跨角色重复——重复时保存会被拒绝（守卫式拒写，配置不会落盘）。',
          '「填入三条示例」一键加入 前端/后端/写作 三个角色（目标先取当前预设的默认模型，可在下拉里改）。',
        ],
        live: (c) => {
          const roles = (c as { roles?: Record<string, unknown> }).roles
          const n = roles === undefined ? 0 : Object.keys(roles).length
          return n === 0 ? '当前：分工表为空（专项活不会被派发改道）' : `当前：${n} 个角色`
        },
      },
      {
        id: 'routing-driver',
        title: '团队派发的几个开关（driver / driverSticky / rulesApplyToChildren）',
        anchors: ['driver', 'dispatch'],
        body: [
          'driver = 主驱动目标（null/缺省 = 跟随宿主默认模型）；driverSticky 开启时主会话打底恒用 driver。',
          'rulesApplyToChildren 关闭（默认）时，子代理的请求不参与关键词规则——只有分工表认领的队友会被改道。',
          '派发依据见 dock 的派发槽：role=分工表角色 / explicit=显式点名 / unclaimed=未在分工表 / keep=保持原样。',
        ],
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
        title: '评审流的字段',
        anchors: ['flows'],
        body: [
          '评审模型 = **谁来评**；触发方式 = **什么时候评**（两个字段，别混）。',
          '档位 = 评审模型的**推理强度**（与转述流同款：下拉里只列宿主目录声明支持的档位；显示「跟随默认（该模型未声明档位）」= 这个模型没声明，交给适配器默认）。',
          '轮次 = 评几轮，**也是每会话「退回重做」的次数上限**。',
          '自动修订 = 评审判「不通过/有条件通过」时**自动让主模型按意见改**；复检 = 改完再评一轮。',
          '两个开关都会多花调用：退回多一轮主模型，复检再多一轮评审。',
        ],
      },
      {
        id: 'flows-revise',
        title: '退回重做：自动与手动',
        anchors: ['flows'],
        body: [
          '评审卡上有「**让它重做**」按钮：不勾自动修订也能点，按最近一次评审意见退回。',
          '退回 = 注入一条带评审意见的消息，让主模型**只改被指出的问题**；原产出仍在会话日志里（可回看）。',
          '每会话最多退回「轮次」次（1–3）；到顶后事件卡会显示「已停（达上限）」，不再自动重做。',
        ],
        live: (c) => {
          const flow = v5(c)?.flows.review
          if (flow === undefined || flow.type !== 'review') return undefined
          return `当前：自动修订${flow.autoRevise ? '开' : '关'} · 复检${flow.recheck === false ? '关' : '开'} · 上限 ${flow.rounds} 次`
        },
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
      {
        id: 'flows-delete-guard',
        title: '删除协作流受引用检查保护',
        anchors: ['flows'],
        body: [
          '预置流不可删；自建流仍被规则目标或「懒转述流」引用时**拒删并给出原因**（先清引用再删）。',
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
        id: 'usage-overview',
        title: '用量总览（第二行的总览按钮）',
        anchors: ['overview-toggle'],
        body: [
          '一屏列出**全部已注册的源**：用量窗、余额，以及某个源为什么没有数据。',
          '「没数据」分三种且逐行写明：该套餐无公开 API / key 未配置 / 取数失败——不用你猜。',
        ],
      },
      {
        id: 'usage-monthly',
        title: '为什么面板显示还有额度，却报「已达上限」',
        anchors: ['week-quota', 'fivehour-quota'],
        body: [
          '面板显示的是服务端返回的**周 / 5h 窗**；账号若另有**月度上限**，它不在这个窗里。',
          'Kimi 的 403 文案就是 `monthly usage limit for this billing cycle`——周窗没满也可能被月上限挡住。',
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
          '`revise` 手动退回：按最近一次评审意见让主模型重做（与评审卡按钮同一条路）。',
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
