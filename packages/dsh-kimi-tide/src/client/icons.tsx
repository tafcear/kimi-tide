/**
 * icons — 内联 SVG 线性图标集（⑥-B 打磨 2026-08-29）。
 *
 * 用户裁定：emoji 语义不清（📊⏳🖼️ 无法自解释），全量退役改内联 SVG。
 * 零外部依赖：24 viewBox / stroke currentColor / strokeLinecap round，
 * 渲染 12px 与 12px 文字同行对齐（flex none 防挤压变形）。
 */
import type { ReactNode } from 'react'

export type IconName =
  | 'moon'
  | 'route'
  | 'base'
  | 'target'
  | 'compass'
  | 'calendar'
  | 'gauge'
  | 'image'
  | 'clock'
  | 'refresh'
  | 'warn'

const SHAPES: Record<IconName, ReactNode> = {
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />,
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M12 19h4a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h4" />
    </>
  ),
  base: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </>
  ),
  gauge: (
    <>
      <path d="M5.5 18.5a9 9 0 1 1 13 0" />
      <path d="M12 13l4-4" />
      <circle cx="12" cy="13" r="1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-4.5-4.5L6 21" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />,
  warn: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
}

export function Icon(props: { name: IconName; size?: number; className?: string }) {
  const size = props.size ?? 12
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className}
      style={{ flex: 'none' }}
    >
      {SHAPES[props.name]}
    </svg>
  )
}
