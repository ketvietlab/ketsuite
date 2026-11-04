import { quotationMessages } from './quotation-messages.ts'
import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions/index.ts'
import { withOrderHistory } from '../sale/order-history.ts'

export default defineModule({
  name: 'loyalty_sale',
  version: '0.1.0',
  // Cancelling an order through sale hands its freed goods to stock's reservation job (K60).
  depends: ['loyalty', 'sale', 'stock'],
  title: 'Loyalty trong bán hàng',
  summary: 'Áp ưu đãi, tích và đổi điểm trên báo giá và đơn bán.',
  category: 'Bán hàng',
  extend: {
    'sale.Order': {
      loyaltyState: 'text?',
      loyaltyPointsEarned: 'decimal?',
      loyaltyPointsSpent: 'decimal?',
    },
    'sale.OrderLine': {
      loyaltyApplicationId: 'ref:loyalty.Application?',
      loyaltyRewardId: 'ref:loyalty.Reward?',
      loyaltyPointsCost: 'decimal?',
    },
  },
  relations: {
    'sale.OrderLine': {
      loyaltyApplication: { belongsTo: 'loyalty.Application', by: 'loyaltyApplicationId' },
      loyaltyReward: { belongsTo: 'loyalty.Reward', by: 'loyaltyRewardId' },
    },
  },
  functions: withOrderHistory(functions),
  messages: {
    vi: {
      ...quotationMessages.vi,
      'error.invalid': 'Giá trị không hợp lệ.',
      'error.changed': 'Chương trình đã thay đổi. Tải lại trước khi lưu.',
      'error.date': 'Ngày không hợp lệ hoặc ngày kết thúc trước ngày bắt đầu.',
      'error.reference': 'Lựa chọn không tồn tại, đã lưu trữ hoặc không thuộc công ty hiện tại.',
      'error.missing': 'Không tìm thấy chương trình trong công ty hiện tại.',
      'error.legacy': 'Quản lý chương trình cũ tại màn loyalty hiện có.',
      'error.name': 'Nhập tên chương trình tối đa 80 ký tự.',
      'error.duplicate': 'Tên hoặc mã đã được sử dụng, kể cả chương trình lưu trữ.',
      'error.cards': 'Không thể đổi loại chương trình đã có thẻ.',
      'error.code': 'Mã gồm 3–30 chữ cái, chữ số, dấu gạch ngang hoặc gạch dưới.',
      'app.title': 'Loyalty trong bán hàng',
      'app.summary': 'Áp ưu đãi, tích và đổi điểm trên báo giá và đơn bán.',
      'app.category': 'Bán hàng',
    },
    en: {
      ...quotationMessages.en,
      'error.invalid': 'Enter a valid value.',
      'error.changed': 'The program changed. Reload before saving.',
      'error.date': 'Enter valid dates with the end on or after the start.',
      'error.reference': 'The selection is missing, archived, or outside the current company.',
      'error.missing': 'The program was not found in the current company.',
      'error.legacy': 'Manage this legacy program in its existing loyalty workspace.',
      'error.name': 'Enter a program name of up to 80 characters.',
      'error.duplicate': 'This name or code is already used, including archived programs.',
      'error.cards': 'A program with cards cannot change its type.',
      'error.code': 'Use 3–30 letters, digits, hyphens or underscores.',
      'app.title': 'Loyalty in Sales',
      'app.summary': 'Apply benefits, earn points, and redeem on quotations and sales orders.',
      'app.category': 'Sales',
    },
  },
})
