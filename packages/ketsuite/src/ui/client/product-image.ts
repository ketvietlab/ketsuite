/**
 * Where a product image is read from, at a rendition size or as uploaded.
 *
 * Not storage's `/files/{id}`: that serves only whoever holds `storage.view`, which
 * reads every file of the company, so a role that sees the catalogue would see a
 * broken image in place of each picture. The product's own route asks only whether
 * the viewer may see product images (`product_media.getMediaAttachment`). The
 * original is served until the render job has made the size.
 */
export const productImageUrl = (attachmentId: string, size?: 'thumb' | 'medium' | 'large'): string =>
  `/admin/product/images/${encodeURIComponent(attachmentId)}${size ? `?size=${size}` : ''}`
