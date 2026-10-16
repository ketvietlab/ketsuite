import type { Message } from '@ketvietlab/ketjs'

export const messages: Record<string, Record<string, Message>> = {
  vi: {
    'app.title': 'Đơn vị tính',
    'app.summary': 'Cây đơn vị tương đối và quy đổi.',
    'app.category': 'Bán hàng',
    'type.reference': 'Đơn vị gốc',
    'type.bigger': 'Lớn hơn gốc',
    'type.smaller': 'Nhỏ hơn gốc',
    'error.nameRequired': 'Nhập tên đơn vị.',
    'error.nameTaken': 'Đã có đơn vị mang tên này.',
    'error.factorDigits': 'Số lượng có tối đa 3 chữ số thập phân.',
    'error.archiveCounted': 'Còn đơn vị đang dùng quy đổi từ đơn vị này. Lưu trữ các đơn vị đó trước.',
    'error.factorPositive': 'Số lượng phải lớn hơn 0.',
    'error.referenceLoop': 'Đơn vị tham chiếu không được dẫn ngược về chính đơn vị này.',
    'error.conversionLocked':
      'Đơn vị đã được dùng (đóng gói, tồn kho hoặc chứng từ) nên không đổi được quy đổi. Tạo đơn vị mới cho quy đổi khác.',
    'error.conversionUsedBelow':
      'Đơn vị {unit} quy đổi từ đơn vị này đã được dùng (đóng gói, tồn kho hoặc chứng từ), nên không đổi được quy đổi.',
  },
  en: {
    'app.title': 'Units of measure',
    'app.summary': 'Relative unit trees and conversions.',
    'app.category': 'Sales',
    'type.reference': 'Reference unit',
    'type.bigger': 'Bigger than reference',
    'type.smaller': 'Smaller than reference',
    'error.nameRequired': 'Enter the unit’s name.',
    'error.nameTaken': 'Another unit already has this name.',
    'error.factorDigits': 'A quantity has up to 3 decimals.',
    'error.archiveCounted': 'Active units still count in this unit. Archive them first.',
    'error.factorPositive': 'The quantity must be greater than 0.',
    'error.referenceLoop': 'The reference unit may not lead back to this unit.',
    'error.conversionLocked':
      'This unit is in use (a packaging, stock or documents), so its conversion stays. Create a new unit for another conversion.',
    'error.conversionUsedBelow':
      '{unit} counts in this unit and is in use (a packaging, stock or documents), so the conversion stays.',
  },
}
