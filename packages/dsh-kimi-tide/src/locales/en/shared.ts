/**
 * shared 表（英文镜像）：键集必须与 zh/shared.ts 完全相等（Record 类型钉住）。
 */
import { zh } from '../zh/shared.js'

export const en: Record<keyof typeof zh, string> = {
  'shared.nav': 'Kimi Tide',
  'shared.panel.fetchFailed': 'Network request failed: {0}',
  'shared.panel.httpError': 'HTTP {0}',
  'shared.panel.invalidJson': 'Response body is not valid JSON',
  'shared.panel.okNotTrue': 'Route returned ok!=true',
  'shared.panel.noPanel': 'Route returned no panel data',
  'shared.diag.describeUnavailable': 'settings.describe channel unavailable (connection api face absent and loopback not mounted)',
  'shared.diag.mutateUnavailable': 'settings.mutate channel unavailable (connection api face absent and loopback not mounted)',
  'shared.diag.modelsUnavailable': 'Model catalog channel unavailable (session/llm loopback and connection api both absent)',
}
