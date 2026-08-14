/**
 * Cordis Context augmentation for the browser half: the slot system service
 * (provided by the client runtime; not part of the public cordis types).
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      /**
       * Register into a slot once its declaration exists; unwinds with this
       * plugin's fiber.
       */
      inject(key: string, callback: () => () => void): () => void
      /** The single registration API (list slot: id/order/label + component). */
      register(options: Record<string, unknown>, component: unknown): () => void
    }
  }
}
