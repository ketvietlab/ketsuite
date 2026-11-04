import { defineModule } from '@ketvietlab/ketjs'
import { productVendorFunctions } from './product-vendors.ts'
import { functions } from './functions/index.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'purchase',
  version: '0.1.0',
  depends: ['company', 'partner', 'user', 'product', 'uom', 'stock', 'account'],
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
      'error.approval.ownOrder': 'Người lập đơn không tự duyệt đơn của mình. Nhờ người duyệt khác.',
      'error.approval.finalPending': 'Đơn đã qua duyệt cấp 1 và đang chờ người duyệt cấp cuối.',
      'error.configuration.amount':
        'Nhập số tiền lớn hơn 0, tối đa 2 chữ số thập phân; để trống nếu không dùng.',
      'error.configuration.finalAmount': 'Ngưỡng duyệt cấp cuối cần ngưỡng cấp 1 và phải lớn hơn ngưỡng đó.',
      'error.configurationChanged': 'Cấu hình mua hàng vừa được người khác đổi. Tải lại rồi nhập lại.',
      'error.configuration.tolerance': 'Nhập dung sai từ 0 đến 100 (%), tối đa 2 số lẻ, hoặc để trống.',
      'error.bill.quantity':
        'Dòng “{line}” ({order}) sẽ được lập hoá đơn {billed}, vượt số được phép là {allowed} (số đã nhận, hoặc số đã đặt với hàng lập hoá đơn theo số đặt). Sửa số lượng hoặc tạm giữ để trao đổi với nhà cung cấp.',
      'error.bill.price':
        'Đơn giá dòng “{line}” ({order}) lệch quá {tolerance}% so với đơn mua. Sửa giá hoặc tạm giữ để trao đổi với nhà cung cấp.',
      'error.bill.reasonRequired': 'Nêu lý do tạm giữ để nhà cung cấp biết cần sửa gì.',
      'error.bill.reasonLength': 'Lý do tạm giữ tối đa 500 ký tự.',
      'error.bill.missing': 'Không tìm thấy hoá đơn nhà cung cấp này.',
      'error.bill.notDraft': 'Chỉ tạm giữ được hoá đơn nháp.',
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
      'error.approval.ownOrder': 'The person who drafted an order cannot approve it. Ask another approver.',
      'error.approval.finalPending': 'The order passed level one and waits for a final approver.',
      'error.configuration.amount': 'Enter an amount above 0 with at most 2 decimals, or leave it empty.',
      'error.configuration.finalAmount':
        'The final threshold needs a level one threshold and must exceed it.',
      'error.configurationChanged':
        'Someone else just changed the purchasing settings. Reload and enter them again.',
      'error.configuration.tolerance':
        'Enter a tolerance from 0 to 100 (%) with at most 2 decimals, or leave it empty.',
      'error.bill.quantity':
        'Line “{line}” ({order}) would be billed {billed}, more than the {allowed} allowed (received, or ordered for products billed on ordered quantities). Correct the quantity or put the bill on hold to contact the vendor.',
      'error.bill.price':
        'The unit price of line “{line}” ({order}) differs from the purchase order by more than {tolerance}%. Correct the price or put the bill on hold to contact the vendor.',
      'error.bill.reasonRequired': 'Enter a hold reason so the vendor knows what to correct.',
      'error.bill.reasonLength': 'A hold reason has at most 500 characters.',
      'error.bill.missing': 'This vendor bill was not found.',
      'error.bill.notDraft': 'Only a draft bill can be put on hold.',
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
