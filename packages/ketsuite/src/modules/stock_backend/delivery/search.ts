import type { ListState, Translator } from '@ketvietlab/ketjs'
import { listSearchFilterConfig, type ListFavorite } from '../../backend/search-filter.ts'
import {
  carrierListSearch,
  deliveryStatementListSearch,
  dispatchListSearch,
  shipmentListSearch,
} from '../search.ts'
import type { DeliveryList } from './shared.ts'

export const DELIVERY_SPECS = {
  dispatch: dispatchListSearch,
  shipments: shipmentListSearch,
  statements: deliveryStatementListSearch,
  carriers: carrierListSearch,
} as const

/** What each list's status filter offers, in the words of its badges. */
export const STATUS_CHOICES: Record<DeliveryList, readonly string[]> = {
  dispatch: ['toHandOver', 'toBook', 'noShipment', 'waiting'],
  shipments: ['failed', 'booked', 'draft', 'shipping', 'delivered', 'returned', 'cancel'],
  statements: ['draft', 'posted', 'paid', 'cancel'],
  carriers: ['active', 'archived'],
}
export const statusWord = (list: DeliveryList, status: string) =>
  `stock_backend.${
    list === 'dispatch'
      ? 'dispatch.status'
      : list === 'shipments'
        ? 'shipment.state'
        : list === 'statements'
          ? 'statement.state'
          : 'carrier.state'
  }.${status}`

export function deliverySearch(
  _: Translator,
  list: DeliveryList,
  state: ListState,
  href: string,
  favorites: ListFavorite[] = [],
) {
  const spec = DELIVERY_SPECS[list]
  return {
    ...listSearchFilterConfig(_, {
      name: `stock-delivery-${list}-filter`,
      bodyId: `stock-delivery-${list}-list`,
      spec,
      state,
      favorites,
      applyInput: { listKey: spec.key, returnTo: href },
      labels: {
        // Statements and carriers have no customer or tracking code to find them by.
        searchPlaceholder: _(
          list === 'statements' || list === 'carriers'
            ? `stock_backend.delivery.search.${list}`
            : 'stock_backend.delivery.search',
        ),
      },
      fieldChoices: {
        status: STATUS_CHOICES[list].map((value) => ({ value, label: _(statusWord(list, value)) })),
      },
      functions: {
        apply: 'stock_backend.applySearchFilter',
        saveFavorite: 'stock_backend.saveSearchFavorite',
        deleteFavorite: 'stock_backend.deleteSearchFavorite',
        setDefaultFavorite: 'stock_backend.setDefaultSearchFavorite',
      },
    }),
    applyOnInput: true,
  }
}
