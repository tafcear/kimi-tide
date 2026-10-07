/**
 * HelpTab — 说明页签渲染器（说明页签 spec v2 §3/§5）。
 *
 * 只读：内容来自 help-content.ts（单一内容源）+ 本文件的**本次新版导览**
 * （`WHATSNEW_V210`，2026-10-07 路由信息架构统一：五档决策链 / 作用域 /
 * 统一路由表 / 写通道双写 / 测试场「派给谁」）；本组件不引入任何写路径、
 * 按钮或表单控件；分区用 `<details>` 折叠（默认展开 ① 面板速览、
 * ⑦ 常见疑问与本次新版导览 = 症状优先），每条的「当前：…」行由内容源
 * 自己的 live() 计算——值缺失时整行不渲染（不造噪音）。
 *
 * 为什么导览写在本文件而不是 help-content.ts：help-content 的**结构**由
 * `test/help-content.test.ts` 钉住（8 分区、DOCK_ELEMENTS × SETTINGS_SECTIONS
 * 双向覆盖、FEATURE_KEYS 防腐烂），本次改动只动渲染层文案与结构，故导览
 * 自带在渲染器里（纯静态数据，无 live 值，不参与覆盖闸）。
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { isV5Plus } from '../config.js'
import { HELP_SECTIONS, type HelpConfig, type HelpEntry } from './help-content.js'

export interface HelpTabProps {
  /** 生效配置（card-store 快照的 config）；null = 未就绪 → 只渲染静态内容。 */
  config: HelpConfig | null
}

/** 导览条目（与 HelpEntry 同形，但**没有 live**：纯静态说明，不读配置）。 */
interface WhatsNewEntry {
  id: string
  title: string
  body: string[]
}

/**
 * 本次新版导览（v2.1.0「路由信息架构统一」）。静态、只读、无 live 值——
 * 讲清这一版路由页怎么读，细节见仓库 packages/dsh-kimi-tide/docs/router.md
 * 的「2.1.0 统一路由表（v7）」节。
 */
const WHATSNEW_V210: readonly WhatsNewEntry[] = [
  {
    id: 'whatsnew-chain',
    title: '路由页从「四个并列控件」改成一条五档决策链',
    body: [
      '一条消息会被谁决定用哪个模型，按优先级从上到下排：**显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 打底**。',
      '每档三行：什么时候轮到它 / 当前生效值 / 关掉它会怎样。**分工表**内联在第 3 档、**规则编辑器**内联在第 4 档。',
      '**打底档现在显式可见**（并写明来源：主驱动恒定 / 预设默认 / 跟随宿主默认）；没生效的档位只是置灰，不是消失。',
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

function liveLineOf(entry: HelpEntry, config: HelpConfig | null): string | undefined {
  if (config === null || entry.live === undefined) return undefined
  try {
    const line = entry.live(config)
    return line === undefined || line.trim() === '' ? undefined : line
  } catch {
    // live 是纯读；任何异常都不该让整页崩掉（降级为不渲染该行）
    return undefined
  }
}

export function HelpTab(props: HelpTabProps): ReactNode {
  const config = props.config
  const isV5 = config !== null && isV5Plus(config)
  const sections = HELP_SECTIONS.filter((section) => section.v5Only !== true || isV5)
  return createElement(
    'div',
    { className: 'kt-help' },
    createElement(
      'p',
      { className: 'kt-hint' },
      '这里讲清面板每个元素是什么、设置里每个字段什么意思。最上面一节讲这一版路由页的新读法（五档决策链 / 作用域 / 统一路由表）；想看更深的设计细节，见仓库 packages/dsh-kimi-tide/docs/router.md。',
    ),
    // 本次新版导览（v2.1.0）：纯静态、默认展开——症状优先的既有纪律
    // （先说「这一版哪里不一样」，再进逐元素说明）。
    createElement(
      'details',
      { key: 'whatsnew', className: 'kt-help-sec kt-card kt-help-whatsnew', open: true },
      createElement('summary', null, '本次新版：路由页怎么读'),
      ...WHATSNEW_V210.map((entry) =>
        createElement(
          'div',
          { key: entry.id, className: 'kt-help-entry' },
          createElement('div', { className: 'kt-help-title' }, entry.title),
          createElement(
            'ul',
            { className: 'kt-help-body' },
            ...entry.body.map((line, index) => createElement('li', { key: index }, line)),
          ),
        ),
      ),
    ),
    ...sections.map((section) =>
      createElement(
        'details',
        {
          key: section.id,
          className: `kt-help-sec kt-card kt-help-${section.id}`,
          open: section.defaultOpen === true,
        },
        createElement('summary', null, section.title),
        ...section.entries.map((entry) => {
          const live = liveLineOf(entry, config)
          return createElement(
            'div',
            { key: entry.id, className: 'kt-help-entry' },
            createElement('div', { className: 'kt-help-title' }, entry.title),
            createElement(
              'ul',
              { className: 'kt-help-body' },
              ...entry.body.map((line, index) => createElement('li', { key: index }, line)),
            ),
            live === undefined
              ? null
              : createElement('div', { className: 'kt-help-live' }, live),
          )
        }),
      ),
    ),
  )
}

export default HelpTab
