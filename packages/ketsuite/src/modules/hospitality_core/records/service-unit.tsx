import { Text } from '@ketvietlab/design-system'
import { signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps } from '@ketvietlab/ketjs-view'
export function serviceUnit(props: IslandProps): IslandController {
  const value = signal(String(props.value ?? ''))
  const controller = new AbortController()
  return {
    view: () => (
      <Text variant="bodySm">{value() || (props.productId ? String(props.loading ?? '') : '—')}</Text>
    ),
    mount: () => {
      if (!props.productId || !props.propertyId) return
      void fetch(`/_ket/fn/hospitality_core.lookupServiceProducts${props.query ? `?${props.query}` : ''}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: props.productId, propertyId: props.propertyId, limit: 1 }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Service unit unavailable')
          const payload = await response.json()
          if (!payload.ok || !Array.isArray(payload.value)) throw new Error('Service unit unavailable')
          if (controller.signal.aborted) return
          const product = payload.value[0]
          const input = document.getElementById(String(props.priceInputId))
          if (product && input instanceof HTMLInputElement && !input.disabled && !input.value) {
            input.value = String(product.unitPrice ?? '')
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }
          value.set(String(product?.unitName ?? '—'))
        })
        .catch(() => {
          if (!controller.signal.aborted) value.set('—')
        })
    },
    dispose: () => controller.abort(),
  }
}
