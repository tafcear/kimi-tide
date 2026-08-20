/**
 * card-store — 「月汐」设置卡片的数据面。
 *
 * 把 settingsScope 的命名空间快照（或 connection.api.settings 的 describe
 * 视图）折叠成卡片渲染所需的 CardSnapshot，并把用户写操作路由到
 * scope.set / connection.api.settings.mutate。卡片组件用
 * useSyncExternalStore(subscribe, getSnapshot) 订阅这个 store。
 *
 * Ruling 2（控制器预检裁决）：ConnectionLike / SettingsScopeLike 两个结构面
 * 类型定义在本文件，SettingsCard.tsx 从这里 import（而非本文件反向 import
 * 组件），避免类型环。
 */
import type { RouterConfigV3 } from '../config.js'

export const CARD_NAMESPACE = 'kimi-tide-router'

/** 卡片渲染用的单一快照：resolved 值 + base/user 分层（继承/覆盖显示）+ 错误态。 */
export interface CardSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** 解析后的生效配置（schema 默认 → base → user 三层合并）。 */
  config: RouterConfigV3 | null
  /** 组合 base 层（patch/entry 种子）；字段在此出现 = 继承自部署基座。 */
  base: RouterConfigV3 | null
  /** 原始 user 层；字段在此出现 = 用户覆盖。 */
  user: RouterConfigV3 | null
  writable: boolean
  /** 最近一次写失败的信息；成功读入/写回后清空。 */
  error: string | null
}

/** settings.mutate 的一枚 path op（set / unset）。 */
export type SettingsPathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** settings.describe 返回的单命名空间视图（卡片只关心 value/base/user/revision）。 */
export interface SettingsDescribeView {
  ns: string
  value: unknown
  base?: unknown
  user?: unknown
  /** 命名空间 raw user 层的单调 revision；写回时作为 expectedRevision。 */
  revision: number
}

/** 拆箱后的 RPC result：ok 携带值，否则携带错误。 */
export type SettingsRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

/** connection 服务的结构面（api.settings.describe / mutate）。 */
export interface ConnectionLike {
  api: {
    settings: {
      describe(request: Record<string, never>): Promise<{
        result: SettingsRpcResult<{ writable: boolean; namespaces: SettingsDescribeView[] }>
      }>
      mutate(request: { ns: string; ops: SettingsPathOp[]; expectedRevision?: number }): Promise<unknown>
    }
  }
}

/** settingsScope.bind(...) 返回的 scope 结构面。 */
export interface SettingsScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: unknown
    base: unknown
    user: unknown
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  /** 顶层标量写；revision 冲突检测由 scope 内部处理（latest-write 恢复）。 */
  set(field: string, value: unknown): Promise<void>
  /** 顶层标量清除；revision 冲突检测由 scope 内部处理。 */
  unset(field: string): Promise<void>
}

/** 卡片 store 的对外句柄。 */
export interface CardStore {
  load(): Promise<void>
  /** 顶层标量字段写：scope.set 或 mutate set（单段 path）。 */
  saveTop(field: string, value: unknown): Promise<void>
  /** 嵌套 scores 写：mutate set（多段 path：['scores', key, dim]）。 */
  saveScores(key: string, dim: string, value: number): Promise<void>
  /** 清除一个顶层字段使其重新继承 base/默认。 */
  resetField(field: string): Promise<void>
  getSnapshot(): CardSnapshot
  subscribe(listener: () => void): () => void
}

const asConfig = (value: unknown): RouterConfigV3 | null =>
  typeof value === 'object' && value !== null ? (value as RouterConfigV3) : null

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function createCardStore(
  scope: SettingsScopeLike | null,
  connection: ConnectionLike | null,
): CardStore {
  let snapshot: CardSnapshot = {
    status: scope === null && connection === null ? 'unavailable' : 'loading',
    config: null,
    base: null,
    user: null,
    writable: false,
    error: null,
  }
  // connection/mutate 路径的乐观并发栅栏：最近一次 describe 读到的命名空间
  // revision。scope 路径不需要它（scope.set/unset 自带 latest-write 恢复）。
  let revision: number | undefined
  const listeners = new Set<() => void>()
  const publish = (next: CardSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const fail = (error: unknown): void => {
    publish({ ...snapshot, error: messageOf(error) })
  }

  const readScope = (): void => {
    if (scope === null) return
    const s = scope.getSnapshot()
    publish({
      status: s.status === 'ready' && s.value !== undefined
        ? 'ready'
        : s.status === 'unavailable' ? 'unavailable' : 'loading',
      config: s.status === 'ready' ? asConfig(s.value) : null,
      base: asConfig(s.base),
      user: asConfig(s.user),
      writable: s.writable,
      error: null,
    })
  }

  const load = async (): Promise<void> => {
    if (scope !== null) {
      readScope()
      return
    }
    if (connection !== null) {
      try {
        const r = await connection.api.settings.describe({})
        if (!r.result.ok) {
          publish({ status: 'unavailable', config: null, base: null, user: null, writable: false, error: null })
          return
        }
        const view = r.result.value.namespaces.find((n) => n.ns === CARD_NAMESPACE)
        if (view === undefined) {
          revision = undefined
          publish({ status: 'unavailable', config: null, base: null, user: null, writable: false, error: null })
          return
        }
        revision = view.revision
        publish({
          status: 'ready',
          config: asConfig(view.value),
          base: asConfig(view.base),
          user: asConfig(view.user),
          writable: r.result.value.writable,
          error: null,
        })
      } catch (error) {
        fail(error)
      }
    }
  }

  // scope 路径同步读一次（renderToString 无 effect，仍能渲染出就绪快照），
  // 并订阅一次：外部写入（document-updated 推送）也会重新折叠快照。
  if (scope !== null) {
    readScope()
    scope.subscribe(readScope)
  }

  const saveTop = async (field: string, value: unknown): Promise<void> => {
    try {
      if (scope !== null) await scope.set(field, value)
      else if (connection !== null) {
        await connection.api.settings.mutate({
          ns: CARD_NAMESPACE,
          ops: [{ op: 'set', path: [field], value }],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })
      }
      await load()
    } catch (error) {
      fail(error)
    }
  }

  const saveScores = async (key: string, dim: string, value: number): Promise<void> => {
    try {
      // Nested scores writes only exist on the connection/mutate channel
      // (multi-segment path); scope.set/unset speak top-level scalars only. A
      // scope-only store would otherwise drop the write silently — degrade
      // loudly through the snapshot error channel instead.
      if (connection === null) {
        fail(new Error('嵌套评分写入需要 connection 通道'))
        return
      }
      await connection.api.settings.mutate({
        ns: CARD_NAMESPACE,
        ops: [{ op: 'set', path: ['scores', key, dim], value }],
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      })
      await load()
    } catch (error) {
      fail(error)
    }
  }

  const resetField = async (field: string): Promise<void> => {
    try {
      if (scope !== null) await scope.unset(field)
      else if (connection !== null) {
        await connection.api.settings.mutate({
          ns: CARD_NAMESPACE,
          ops: [{ op: 'unset', path: [field] }],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })
      }
      await load()
    } catch (error) {
      fail(error)
    }
  }

  return {
    load,
    saveTop,
    saveScores,
    resetField,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
