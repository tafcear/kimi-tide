/**
 * shared 表：跨界面共用的 chrome 文案（导航标签、面板取数失败原因）。
 * 中文是唯一真源；键命名 `<surface>.<area>.<name>`，全小写 camelCase 段。
 */
export const zh = {
  'shared.nav': '月汐',
  'shared.panel.fetchFailed': '网络请求失败：{0}',
  'shared.panel.httpError': 'HTTP {0}',
  'shared.panel.invalidJson': '响应体不是合法 JSON',
  'shared.panel.okNotTrue': '路由返回 ok!=true',
  'shared.panel.noPanel': '路由未返回面板数据',
  /* ---- 连接通道诊断（client/index.ts buildConnectionFace；开发者诊断文案，中文逐字保留，P2 补漏） ---- */
  'shared.diag.describeUnavailable': 'settings.describe 通道不可用（connection api 面缺席且 loopback 未挂载）',
  'shared.diag.mutateUnavailable': 'settings.mutate 通道不可用（connection api 面缺席且 loopback 未挂载）',
  'shared.diag.modelsUnavailable': '模型目录通道不可用（session/llm loopback 与 connection api 均缺席）',
} as const
