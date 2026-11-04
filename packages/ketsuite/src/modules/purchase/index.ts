import { defineModule } from '@ketvietlab/ketjs'
import { productVendorFunctions } from './product-vendors.ts'
import { functions } from './functions/index.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'purchase',
  version: '0.1.0',
  depends: ['company', 'partner', 'product', 'uom', 'stock', 'account'],
  title: 'Mua hàng',
  summary: 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp.',
  category: 'Mua hàng',
  models,
  extend: {
    'product.Template': { purchaseMethod: 'text?' },
    'stock.Move': { purchaseLineId: 'ref:purchase.OrderLine?' },
    'account.MoveLine': { purchaseLineId: 'ref:purchase.OrderLine?' },
  },
  relations,
  functions: { ...functions, ...reportFunctions, ...productVendorFunctions },
  reports,
  messages: {
    vi: {
      'error.suppliers.invalid': 'Dữ liệu nhà cung cấp không hợp lệ. Hãy tải lại và thử lại.',
      'error.suppliers.notEditable':
        'Chỉ sửa nhà cung cấp trên sản phẩm đang dùng, có thể mua và không phải combo.',
      'error.suppliers.conflict': 'Sản phẩm hoặc nhà cung cấp đã thay đổi. Hãy tải lại trước khi lưu.',
      'error.suppliers.ownership': 'Dòng nhà cung cấp không thuộc sản phẩm này.',
      'error.suppliers.duplicate': 'Một dòng nhà cung cấp xuất hiện nhiều lần trong thay đổi.',
      'error.suppliers.limit': 'Mỗi sản phẩm có tối đa 20 dòng nhà cung cấp.',
      'error.suppliers.partner': 'Hãy chọn đối tác còn hoạt động.',
      'error.suppliers.variant': 'Biến thể phải thuộc sản phẩm này và còn hoạt động.',
      'error.suppliers.values':
        'Mã NCC tối đa 40 ký tự; số lượng và giá không âm; số ngày giao là số nguyên từ 0 đến 365.',
      'error.suppliers.unit': 'Đơn vị mua không thể đổi sang đơn vị của sản phẩm.',
      'app.title': 'Mua hàng',
      'app.summary': 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp.',
      'app.category': 'Mua hàng',
      'report.rfq': 'YÊU CẦU BÁO GIÁ',
      'report.purchaseOrder': 'ĐƠN MUA HÀNG',
      'report.number': 'Số',
      'report.date': 'Ngày',
      'report.vendor': 'Nhà cung cấp',
      'report.description': 'Mô tả',
      'report.quantity': 'Số lượng',
      'report.unitPrice': 'Đơn giá',
      'report.subtotal': 'Thành tiền',
      'report.untaxed': 'Trước thuế',
      'report.tax': 'Thuế',
      'report.total': 'Tổng cộng',
    },
    en: {
      'error.suppliers.invalid': 'Supplier changes are invalid. Reload and try again.',
      'error.suppliers.notEditable':
        'Suppliers can only be edited on an active, purchasable product that is not a combo.',
      'error.suppliers.conflict': 'The product or its suppliers changed. Reload before saving.',
      'error.suppliers.ownership': 'The supplier row does not belong to this product.',
      'error.suppliers.duplicate': 'A supplier row occurs more than once in the changes.',
      'error.suppliers.limit': 'A product can have at most 20 supplier rows.',
      'error.suppliers.partner': 'Choose an active partner.',
      'error.suppliers.variant': 'The variant must belong to this product and be active.',
      'error.suppliers.values':
        'Vendor codes allow 40 characters; quantities and prices cannot be negative; lead days must be an integer from 0 to 365.',
      'error.suppliers.unit': 'The purchase unit cannot be converted to the product unit.',
      'app.title': 'Purchase',
      'app.summary': 'RFQs, purchase orders, receipts, and vendor bills.',
      'app.category': 'Purchase',
      'report.rfq': 'REQUEST FOR QUOTATION',
      'report.purchaseOrder': 'PURCHASE ORDER',
      'report.number': 'Number',
      'report.date': 'Date',
      'report.vendor': 'Vendor',
      'report.description': 'Description',
      'report.quantity': 'Quantity',
      'report.unitPrice': 'Unit price',
      'report.subtotal': 'Subtotal',
      'report.untaxed': 'Untaxed',
      'report.tax': 'Tax',
      'report.total': 'Total',
    },
  },
})

export { PURCHASE_STATES, INVOICE_STATUSES, PURCHASE_METHODS } from './types.ts'
