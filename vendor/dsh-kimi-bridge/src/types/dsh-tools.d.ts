/**
 * Ambient type shim for @deepseek-ai/dsh-tools.
 *
 * The @deepseek-ai/* packages are NOT published on the public npm registry;
 * the harness resolves them at load time. This file exists so `npm run
 * typecheck` works standalone. It covers only the subset this plugin uses and
 * is deliberately loose — when the harness ships real types, delete this file
 * and add the package as a dev dependency.
 */

declare module '@deepseek-ai/dsh-tools' {
  import type { Agent } from '@deepseek-ai/dsh-agent'

  export interface ToolParameterSpec {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | (string & {})
    required?: boolean
    description?: string
    enum?: readonly string[]
    default?: unknown
    [key: string]: unknown
  }

  type ParamType<S extends ToolParameterSpec> = S['type'] extends 'string'
    ? string
    : S['type'] extends 'number'
      ? number
      : S['type'] extends 'boolean'
        ? boolean
        : S['type'] extends 'null'
          ? null
          : unknown

  /** Infer the execute() args record from a parameters schema. */
  export type InferArgs<Params extends Record<string, ToolParameterSpec>> = {
    [K in keyof Params as Params[K] extends { required: true } ? K : never]: ParamType<Params[K]>
  } & {
    [K in keyof Params as Params[K] extends { required: true } ? never : K]?: ParamType<Params[K]>
  }

  /** Runtime execution context handed to a tool body by the registry. */
  export interface ToolExecution {
    readonly agent?: Agent
    readonly signal: AbortSignal
    /** Mark the current agent turn terminal after this tool's result. */
    concludeTurn(): void
    readonly token: symbol
  }

  export interface ToolOutputDefinition<TArgs, TValue> {
    schema?: unknown
    render?: (args: TArgs, value: TValue) => Array<{ type: string; text: string }>
  }

  export interface ToolCallView {
    card: string
    title: string
    kind: string
    rawInput?: string
  }

  export interface ToolDefinition<TArgs = Record<string, unknown>, TValue = unknown> {
    name: string
    description: string
    parameters: Record<string, ToolParameterSpec>
    output?: ToolOutputDefinition<TArgs, TValue>
    execute: (args: TArgs, exec: ToolExecution) => Promise<TValue> | TValue
    /** Opt-in: only `true` allows overlap with sibling tool calls (exclusive otherwise). */
    isConcurrencySafe?(args: TArgs): boolean
    presentCall?(args: TArgs): ToolCallView | undefined
  }

  export function defineTool<
    Params extends Record<string, ToolParameterSpec>,
    TArgs = InferArgs<Params>,
    TValue = unknown,
  >(
    definition: ToolDefinition<TArgs, TValue> & { parameters: Params },
  ): ToolDefinition<TArgs, TValue>
}
