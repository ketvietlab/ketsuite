import { KetError } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'

/** The trusted upload route reads the actual stored bytes before issuing immutable header evidence. */
export async function validateHospitalityImage(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  attachment: { id: string; checksum?: string | null; storeKey?: string; mimetype: string; size: number },
) {
  const invalid = (): never => {
    throw new KetError({
      code: 'E_HOSPITALITY_CONTENT_INVALID',
      message: ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.content_image'),
    })
  }
  const storeKey = attachment.storeKey,
    checksum = attachment.checksum
  if (!storeKey || !checksum) return invalid()
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(attachment.mimetype) ||
    attachment.size <= 0 ||
    attachment.size > 10 * 1024 * 1024
  )
    invalid()
  const stored = await (await ctx.storageOf(url, req)).get(storeKey)
  if (!stored) return invalid()
  const parts: Uint8Array[] = []
  let size = 0
  for await (const part of stored.body) {
    size += part.byteLength
    if (size > 10 * 1024 * 1024) invalid()
    parts.push(part)
  }
  let metadata: { format?: string; width?: number; height?: number }
  try {
    const { default: sharp } = await import('sharp')
    metadata = await sharp(Buffer.concat(parts), {
      limitInputPixels: 100_000_000,
      animated: false,
    }).metadata()
  } catch {
    return invalid()
  }
  const types: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
  if (
    types[String(metadata.format)] !== attachment.mimetype ||
    Math.min(metadata.width ?? 0, metadata.height ?? 0) < 1024
  )
    invalid()
  await ctx.callUnchecked(
    'hospitality_core.recordContentImageEvidence',
    {
      attachmentId: attachment.id,
      checksum,
      mimetype: attachment.mimetype,
      width: Number(metadata.width),
      height: Number(metadata.height),
    },
    url,
    req,
  )
}
