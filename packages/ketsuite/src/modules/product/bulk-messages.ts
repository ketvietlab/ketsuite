export const bulkMessages = {
  vi: {
    'error.bulk.input': 'Giá trị mới của {field} không hợp lệ. Không sản phẩm nào đã đổi.',
    'error.bulk.company': 'Chọn công ty trước khi sửa hàng loạt.',
    'error.bulk.field': 'Chọn trường cần đổi.',
    'error.bulk.value': 'Sản phẩm {product}: giá trị của {field} không hợp lệ. Không sản phẩm nào đã đổi.',
    'error.bulk.selection': 'Chọn từ 1 đến 200 sản phẩm, rồi tải lại nếu dữ liệu đã thay đổi.',
    'error.bulk.conflict': 'Sản phẩm {product} đã thay đổi. Tải lại rồi thử lại; không sản phẩm nào đã đổi.',
    'error.bulk.replay': 'Lần sửa này đã được lưu với dữ liệu khác. Mở một lần sửa mới.',
    'error.bulk.missing': 'Sản phẩm {product} không còn dùng hoặc không thuộc công ty này.',
    'error.bulk.permission':
      'Sản phẩm {product}: {field} đang khóa với bạn, như trên trang sản phẩm. Không sản phẩm nào đã đổi.',
    'error.bulk.locked': 'Sản phẩm {product}: {field} bị khóa do đã có tồn kho. Không sản phẩm nào đã đổi.',
  },
  en: {
    'error.bulk.input': 'The new value for {field} is invalid. No products were changed.',
    'error.bulk.company': 'Select a company before editing products.',
    'error.bulk.field': 'Choose a field to change.',
    'error.bulk.value': 'Product {product}: the value for {field} is invalid. No products were changed.',
    'error.bulk.selection': 'Select between 1 and 200 products, and reload if their data has changed.',
    'error.bulk.conflict': 'Product {product} changed. Reload and retry; no products were changed.',
    'error.bulk.replay': 'This edit was already saved with different data. Open a new bulk edit.',
    'error.bulk.missing': 'Product {product} is archived, missing or belongs to another company.',
    'error.bulk.permission':
      'Product {product}: your role cannot change {field}, just as on the product page. No products were changed.',
    'error.bulk.locked': 'Product {product}: physical stock locks {field}. No products were changed.',
  },
}
