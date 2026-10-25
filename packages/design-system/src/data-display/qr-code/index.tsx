import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { encodeQr } from './encode.ts'
import type { QrErrorCorrection } from './encode.ts'

export type { QrErrorCorrection } from './encode.ts'

export const HOOKS = ['qr-code', 'qr-code-symbol', 'qr-code-caption'] as const

/** Modules of light margin around the symbol, as the standard asks for. */
export const QR_QUIET_ZONE = 4

export type QrCodeProps = {
  /** The text the code carries, such as a payment request. Encoded as UTF-8. */
  value: string
  /** The accessible name of the symbol: what scanning it does, such as "Pay 13,020,000 ₫ by bank transfer". */
  label: string
  /** Printed under the symbol for people who cannot scan it, such as the account and the amount. */
  caption?: string | TemplateResult | null
  errorCorrection?: QrErrorCorrection
  size?: 'small' | 'default' | 'large'
}

/** The dark modules as one path, a horizontal run per rectangle, offset by the quiet zone. */
export const qrPath = (modules: readonly (readonly boolean[])[]): string => {
  const parts: string[] = []
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++
        continue
      }
      let end = x
      while (end < row.length && row[end]) end++
      parts.push(`M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${end - x}v1h-${end - x}z`)
      x = end
    }
  })
  return parts.join('')
}

/**
 * A QR code a phone can scan: a payment request, a link, a pairing code.
 *
 * The symbol is an SVG drawn on the server from `encodeQr`, so it prints, scales and needs no
 * script. It is always dark on a light plate with its quiet zone, in either theme, because
 * scanners need that contrast. The symbol is an image named by `label`; what it carries that a
 * person needs to read (the account, the amount) belongs in `caption`, never only in the code.
 */
export const QrCode = (props: QrCodeProps): TemplateResult => {
  const matrix = encodeQr(props.value, { errorCorrection: props.errorCorrection ?? 'M' })
  const side = matrix.size + QR_QUIET_ZONE * 2
  return (
    <figure data-ui="qr-code" data-size={props.size ?? 'default'}>
      <svg
        data-ui="qr-code-symbol"
        viewBox={`0 0 ${side} ${side}`}
        role="img"
        aria-label={props.label}
        focusable="false"
        shape-rendering="crispEdges"
        data-version={String(matrix.version)}
      >
        <path d={qrPath(matrix.modules)} />
      </svg>
      {props.caption ? <figcaption data-ui="qr-code-caption">{props.caption}</figcaption> : null}
    </figure>
  )
}
