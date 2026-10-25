import { CANCELLATION_POLICY_TYPES } from '../types.ts'

export const chargeDescription = (
  _: (key: string) => string,
  charge: { type: string; description: string },
): string => {
  if (charge.type === 'room' && charge.description.startsWith('room:'))
    return _('hospitality_core.folio.charge.roomDescription')
  if (charge.type === 'cancellation' && charge.description.startsWith('no_show:'))
    return _('hospitality_core.folio.charge.noShowDescription')
  if (charge.type === 'cancellation' && charge.description.startsWith('cancellation:')) {
    const reason = charge.description.slice('cancellation:'.length)
    if (reason === 'provider') return _('hospitality_core.folio.charge.cancellationByChannel')
    return CANCELLATION_POLICY_TYPES.includes(reason as (typeof CANCELLATION_POLICY_TYPES)[number])
      ? _(`hospitality_core.policy.${reason}`)
      : _('hospitality_core.folio.charge.cancellationByPolicy')
  }
  return charge.description
}

export const chargeReason = (_: (key: string) => string, reason: string) =>
  CANCELLATION_POLICY_TYPES.includes(reason as (typeof CANCELLATION_POLICY_TYPES)[number])
    ? _(`hospitality_core.policy.${reason}`)
    : reason
