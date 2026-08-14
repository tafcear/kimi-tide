/**
 * Type augmentation for @deepseek-ai/dsh-session: the runtime module exports
 * the live KNOWN_SESSION_EVENT_TYPES set, but its published .d.ts predates
 * that export. The harness reader consults this SAME set (resolved through
 * the profile module fallback), so registering our event type here makes
 * stored `kimi/session` events readable again after a web restart.
 */
declare module '@deepseek-ai/dsh-session' {
  export const KNOWN_SESSION_EVENT_TYPES: Set<string>
}
