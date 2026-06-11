/**
 * Twitch chat messages are limited to 500 characters and cannot contain
 * line breaks (IRC sends one message per line).
 */
export const TWITCH_MESSAGE_LIMIT = 500

/**
 * Normalizes LLM response text into Twitch-chat-sized message chunks.
 *
 * Before:
 * - "First paragraph.\nSecond paragraph that is longer than the limit ..."
 *
 * After:
 * - ["First paragraph.", "Second paragraph that is", "longer than the limit ..."]
 *
 * Splits on line breaks first, then on word boundaries within each line, and
 * falls back to hard cuts for unbroken runs longer than the limit.
 */
export function chunkChatMessage(text: string, limit: number = TWITCH_MESSAGE_LIMIT): string[] {
  const chunks: string[] = []

  for (const line of text.split(/\r?\n/)) {
    let remaining = line.trim()

    while (remaining.length > limit) {
      const lastSpace = remaining.lastIndexOf(' ', limit)
      const cutAt = lastSpace > 0 ? lastSpace : limit
      chunks.push(remaining.slice(0, cutAt).trimEnd())
      remaining = remaining.slice(cutAt).trimStart()
    }

    if (remaining.length > 0)
      chunks.push(remaining)
  }

  return chunks
}
