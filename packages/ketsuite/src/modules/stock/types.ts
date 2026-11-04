export const RECEPTION_STEPS = ['one_step', 'two_steps', 'three_steps'] as const

export const DELIVERY_STEPS = ['ship_only', 'pick_ship', 'pick_pack_ship'] as const

export const PICKING_TYPE_CODES = ['incoming', 'outgoing', 'internal'] as const

export const LOCATION_USAGES = [
  'supplier',
  'view',
  'internal',
  'customer',
  'inventory',
  'production',
  'transit',
  'scrap',
] as const

export const MOVE_STATES = [
  'draft',
  'waiting',
  'confirmed',
  'partially_available',
  'assigned',
  'done',
  'cancel',
] as const

export const PICKING_STATES = ['draft', 'waiting', 'confirmed', 'assigned', 'done', 'cancel'] as const

export const TRACKING = ['none', 'lot', 'serial'] as const
