// The vendor bills guide (Help drawer) in Markdown, kept apart from ./vendor-bill-help.tsx, which
// draws it. It describes ./vendor-bills-list.tsx and a vendor bill's ./move-detail.tsx, with the
// purchase order matching of ./bill-match.tsx when Purchase is composed.
export const vendorBillHelp = {
  vi: {
    title: 'Hoá đơn nhà cung cấp',
    source: `Hoá đơn và phiếu giảm của nhà cung cấp trong công ty đang chọn. Bấm một dòng để mở.

## Lập hoá đơn

- Từ đơn mua đã xác nhận: mở đơn mua rồi bấm **Tạo hoá đơn**. Hoá đơn lấy số đã nhận (hoặc số đã đặt, với hàng lập hoá đơn theo số đặt) và giá trên đơn mua.
- **Tạo mới** lập hoá đơn tay, không gắn đơn mua.

## Đọc danh sách

- **Trạng thái**: Nháp, Đã ghi sổ hoặc Đã huỷ. **Thanh toán**: Chưa thanh toán, Thanh toán một phần, Đã thanh toán hoặc Đã đảo.
- **Đối chiếu** (khi công ty dùng Mua hàng và bạn được xem đơn mua): **Khớp**, **Lệch đơn mua** hoặc **Đang tạm giữ**. Dấu — là hoá đơn không gắn đơn mua.

## Trên trang hoá đơn

- Hoá đơn nháp có **Ghi sổ**, **Huỷ** và **Thêm dòng**.
- Mục **Đối chiếu đơn mua** so từng dòng với đơn mua: số trên hoá đơn này với số được lập (bên dưới là số đã đặt và số đã lập hoá đơn trước), rồi giá đơn mua với giá hoá đơn (đều sau chiết khấu).
- Hoá đơn lệch thì **Ghi sổ** bị từ chối, câu báo nêu dòng lệch. Khi cần trao đổi với nhà cung cấp, bấm **Tạm giữ hoá đơn** và nêu lý do; xong thì **Bỏ tạm giữ**. Ghi sổ cũng tự bỏ tạm giữ.
- Dung sai giá đặt ở **Cài đặt → Cấu hình mua hàng**; để trống thì không so đơn giá.

\`\`\`mermaid
flowchart TD
  post("Bấm Ghi sổ") --> linked("Có dòng gắn<br>đơn mua?"):::kv-decision
  linked -->|Không| done("Đã ghi sổ"):::kv-positive
  linked -->|Có| match("Khớp số lượng<br>và đơn giá?"):::kv-decision
  match -->|Có| done
  match -->|Không| refused("Bị từ chối, vẫn là nháp"):::kv-danger
  refused --> hold("Tạm giữ, trao đổi<br>với nhà cung cấp"):::kv-warning
\`\`\``,
  },
  en: {
    title: 'Vendor bills',
    source: `The active company's vendor bills and credit notes. Choose a line to open it.

## Creating a bill

- From a confirmed purchase order: open the order and choose **Create Bill**. The bill takes the received quantity (or the ordered one, for products billed on ordered quantities) and the order's price.
- **Create** enters a bill by hand, without a purchase order.

## Reading the list

- **State**: Draft, Posted or Cancelled. **Payment**: Not Paid, Partially Paid, Paid or Reversed.
- **Matching** (when the company uses Purchase and you may read its orders): **Matches**, **Does not match** or **On hold**. A dash is a bill without a purchase order.

## On a bill

- A draft bill offers **Post**, **Cancel** and **Add line**.
- **Purchase order matching** compares each line with its order: this bill's quantity against the billable one (with what was ordered and billed before beneath it), then the order's price against the bill's (both after discount).
- A bill that does not match cannot be posted, and the message names the line. While you sort it out with the vendor, choose **Hold Bill** with a reason, then **Release Hold** when done. Posting also releases the hold.
- The price tolerance is set in **Settings → Purchasing settings**; leave it empty and prices are not compared.

\`\`\`mermaid
flowchart TD
  post("Post") --> linked("Lines from a<br>purchase order?"):::kv-decision
  linked -->|No| done("Posted"):::kv-positive
  linked -->|Yes| match("Quantity and<br>price match?"):::kv-decision
  match -->|Yes| done
  match -->|No| refused("Refused, stays a draft"):::kv-danger
  refused --> hold("Hold it while the<br>vendor corrects it"):::kv-warning
\`\`\``,
  },
}
