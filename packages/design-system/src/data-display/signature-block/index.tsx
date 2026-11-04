import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'signature-block',
  'signature-block-label',
  'signature-block-hint',
  'signature-block-name',
] as const

export type SignatureBlockProps = {
  /** Who signs, such as "Storekeeper". */
  label: string
  /** How to sign, under the label, such as "(Signature, full name)". */
  hint?: string
  /** The signer's name when it is known; otherwise a line to write it on. */
  name?: string
}

/**
 * Where one person signs a printed document: who they are and how to sign, the room to sign in, and their
 * name under it. Its geometry (the room to sign, the line for a name not yet known) is the component's;
 * a parent `Grid` sets several side by side.
 */
export const SignatureBlock = (props: SignatureBlockProps): TemplateResult => (
  <div data-ui="signature-block">
    <p data-ui="signature-block-label">{props.label}</p>
    {props.hint ? <p data-ui="signature-block-hint">{props.hint}</p> : null}
    <p data-ui="signature-block-name" data-empty={props.name ? null : 'true'}>
      {props.name ?? ''}
    </p>
  </div>
)
