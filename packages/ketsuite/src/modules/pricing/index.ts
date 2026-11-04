import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'pricing',
  version: '0.1.0',
  depends: ['product', 'company', 'uom'],
  optional: ['user'],
  title: 'Bảng giá',
  summary: 'Quy tắc giá trong tiền tệ của công ty.',
  category: 'Bán hàng',
  models,
  relations,
  functions,
  messages: {
    vi: {
      'error.choice': 'Chọn giá trị hợp lệ.',
      'error.missing': 'Bản ghi không tồn tại trong công ty này.',
      'error.dateRange': 'Ngày kết thúc phải sau ngày bắt đầu.',
      'error.nonnegative': 'Giá trị không được âm.',
      'error.baseRequired': 'Chọn bảng giá gốc.',
      'error.targetRequired': 'Chọn đối tượng áp dụng cho quy tắc.',
      'error.packagingScope': 'Chỉ chọn đóng gói cho sản phẩm hoặc biến thể.',
      'error.packagingAvailable': 'Đóng gói chưa được bật cho sản phẩm này.',

      'error.items': 'Danh sách quy tắc không hợp lệ (tối đa 500 dòng).',
      'error.permission': 'Bạn không có quyền sửa quy tắc giá.',
      'error.changed': 'Bảng giá đã thay đổi. Tải lại trước khi sửa tiếp.',
      'error.baseActive': 'Bảng giá gốc phải đang dùng và cùng tiền tệ.',
      'error.cycle': 'Quy tắc tạo vòng bảng giá. Hãy chọn bảng giá gốc khác.',
      'error.referenced': 'Bảng giá đang là giá gốc của một bảng giá còn dùng.',
      'error.costFormula': 'Giá vốn chỉ dùng cho công thức.',
      'error.discountRange': 'Chiết khấu không đúng giới hạn của cách tính.',
      'error.integerSurcharge': 'Phụ phí phải là số nguyên đồng.',
      'app.title': 'Bảng giá',
      'app.summary': 'Quy tắc giá dùng tiền tệ của công ty.',
      'app.category': 'Bán hàng',
    },
    en: {
      'error.choice': 'Choose a valid value.',
      'error.missing': 'The record does not exist in this company.',
      'error.dateRange': 'The end date must follow the start date.',
      'error.nonnegative': 'The value must not be negative.',
      'error.baseRequired': 'Choose a base pricelist.',
      'error.targetRequired': 'Choose a target for this rule.',
      'error.packagingScope': 'Packaging requires a product or variant rule.',
      'error.packagingAvailable': 'This packaging is not enabled for the product.',

      'error.items': 'Invalid rule list (at most 500 rows).',
      'error.permission': 'You do not have permission to edit pricing rules.',
      'error.changed': 'The pricelist changed. Reload before editing again.',
      'error.baseActive': 'The base pricelist must be active and use the same currency.',
      'error.cycle': 'This rule creates a pricelist cycle. Choose another base pricelist.',
      'error.referenced': 'An active pricelist still uses this pricelist as its base.',
      'error.costFormula': 'Cost is available only for formulas.',
      'error.discountRange': 'The discount is outside the range allowed for this calculation.',
      'error.integerSurcharge': 'The surcharge must be a whole currency amount.',
      'app.title': 'Pricing',
      'app.summary': 'Pricing rules in the company currency.',
      'app.category': 'Sales',
    },
  },
})

export { APPLIED_ON, COMPUTE_PRICE, PRICE_BASES } from './functions.ts'
