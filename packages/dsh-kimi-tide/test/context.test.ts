import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { toPiContext } from '../src/context.js'

/**
 * Image conversion contract (2026-08-18, user-reported production failure:
 * "dsh-kimi-tide v1 supports text only"). The router fix (71b1d18) correctly
 * routes image-bearing steps to kimi-coding/k3, but the adapter still held the
 * v1 "Kimi is text-only" assumption. Aligns with the official dsh-llm-pi-ai
 * conversion: image blocks resolve through the durable attachment service
 * (readImage → base64 bytes + mediaType); without an attachment service the
 * original error is kept.
 */

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function imageAttachmentRef() {
  return {
    attachmentId: 'att-1' as never,
    mediaType: 'image/png' as const,
    bytes: 4,
    width: 1,
    height: 1,
  }
}

function userMessage(content: readonly unknown[]): GenerateOptions['messages'][number] {
  return { role: 'user', content } as never
}

function optionsWith(messages: GenerateOptions['messages']): GenerateOptions {
  return { provider: 'kimi-coding', model: 'k3', messages } as unknown as GenerateOptions
}

function fakeAttachments(stored: StoredImageAttachment | Error) {
  return {
    readImage: async () => {
      if (stored instanceof Error) throw stored
      return stored
    },
  } as never
}

describe('toPiContext image conversion', () => {
  it('converts an image block to pi-ai ImageContent (base64 bytes + mediaType)', async () => {
    const attachments = fakeAttachments({ ref: imageAttachmentRef(), data: PNG_BYTES })
    const options = optionsWith([
      userMessage([
        { type: 'text', text: '看这张图' },
        { type: 'image', attachment: imageAttachmentRef() },
      ]),
    ])
    const context = await toPiContext(options, attachments)
    expect(context.messages).toHaveLength(1)
    const content = context.messages[0]!.content
    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual([
      { type: 'text', text: '看这张图' },
      { type: 'image', data: Buffer.from(PNG_BYTES).toString('base64'), mimeType: 'image/png' },
    ])
  })

  it('keeps image-only user messages (no text placeholder)', async () => {
    const attachments = fakeAttachments({ ref: imageAttachmentRef(), data: PNG_BYTES })
    const options = optionsWith([userMessage([{ type: 'image', attachment: imageAttachmentRef() }])])
    const context = await toPiContext(options, attachments)
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]!.content).toEqual([
      { type: 'image', data: Buffer.from(PNG_BYTES).toString('base64'), mimeType: 'image/png' },
    ])
  })

  it('keeps the original error when no attachment service is available', async () => {
    const options = optionsWith([userMessage([{ type: 'image', attachment: imageAttachmentRef() }])])
    await expect(toPiContext(options)).rejects.toThrow(/supports text only/)
  })

  it('surfaces attachment read failures', async () => {
    const attachments = fakeAttachments(new Error('ATTACHMENT_NOT_FOUND'))
    const options = optionsWith([userMessage([{ type: 'image', attachment: imageAttachmentRef() }])])
    await expect(toPiContext(options, attachments)).rejects.toThrow(/ATTACHMENT_NOT_FOUND/)
  })

  it('text-only paths stay unchanged with attachments present', async () => {
    const attachments = fakeAttachments({ ref: imageAttachmentRef(), data: PNG_BYTES })
    const options = optionsWith([userMessage([{ type: 'text', text: '纯文本' }])])
    const context = await toPiContext(options, attachments)
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]!.content).toBe('纯文本')
  })
})
