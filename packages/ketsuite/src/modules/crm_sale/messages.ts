const vi = {
  'app.title': 'CRM · Bán hàng',
  'app.summary': 'Tạo báo giá từ cơ hội bán hàng.',
  'app.category': 'Bán hàng',
  'error.opportunityRequired': 'Chỉ cơ hội bán hàng mới tạo được báo giá.',
  'error.productRequired': 'Cần chọn ít nhất một sản phẩm cho báo giá.',
  'error.partnerRequired': 'Cơ hội cần có đối tác trước khi tạo báo giá.',
  'error.quotationClosed': 'Báo giá đã thành đơn hoặc đã huỷ; tạo phương án mới.',
  'error.attachOff': 'Công ty chưa cho gắn báo giá lập ở Bán hàng vào cơ hội.',
  'error.attachCustomer': 'Chỉ gắn báo giá của cùng khách với cơ hội.',
  'error.attachTaken': 'Báo giá đã thuộc một cơ hội khác.',
  'error.policyUnknown': 'Chọn một cách gắn báo giá.',
  'error.policyChanged': 'Cấu hình đã đổi; tải lại trước khi lưu.',
} as const

const en: Record<keyof typeof vi, string> = {
  'app.title': 'CRM · Sales',
  'app.summary': 'Create quotations from sales opportunities.',
  'app.category': 'Sales',
  'error.opportunityRequired': 'Only an opportunity can create a quotation.',
  'error.productRequired': 'A quotation needs at least one product.',
  'error.partnerRequired': 'The opportunity needs a partner before it can be quoted.',
  'error.quotationClosed': 'The quotation is an order or was cancelled; write a new one.',
  'error.attachOff': 'The company does not let Sales quotations be attached to opportunities.',
  'error.attachCustomer': 'Attach only a quotation of the opportunity’s customer.',
  'error.attachTaken': 'The quotation already belongs to another opportunity.',
  'error.policyUnknown': 'Choose how quotations are attached.',
  'error.policyChanged': 'The setting changed; reload it before saving.',
}

export const messages = { vi, en }
