// The vendor price list guide (Help drawer) in Markdown, kept apart from ./vendor-pricelist-help.tsx,
// which draws it. It describes ./vendor-pricelists-list.tsx, the vendor price modal
// (../modal/pricelist-view.tsx) and the billing policy form the list route in ../index.ts accepts.
export const vendorPricelistHelp = {
  vi: {
    title: 'Bảng giá nhà cung cấp',
    source: `Mỗi dòng là giá một nhà cung cấp bán một sản phẩm: số lượng tối thiểu, đơn giá, chiết khấu, thời gian giao và thời gian hiệu lực. Yêu cầu báo giá dùng các dòng này để điền đơn giá khi bạn để trống.

## Đọc danh sách

- **Hiệu lực** cho biết khoảng ngày giá áp dụng (tính cả ngày bắt đầu và ngày kết thúc) và trạng thái hôm nay theo lịch của công ty: **Đang hiệu lực**, **Sắp hiệu lực** (chưa tới ngày bắt đầu) hoặc **Hết hạn** (đã qua ngày kết thúc). Dòng không có ngày thì **Không giới hạn**.
- Bộ lọc **Theo bậc số lượng** giữ các giá chỉ áp từ một số lượng; **Có chiết khấu** giữ các giá có chiết khấu; **Đang hiệu lực**, **Sắp hiệu lực**, **Hết hạn** lọc theo hiệu lực.
- Bấm một dòng để mở và sửa giá đó.

## Thêm giá

Bấm **Thêm giá nhà cung cấp**, chọn nhà cung cấp và sản phẩm, rồi nhập số lượng tối thiểu, đơn giá, chiết khấu, thời gian giao. **Ngày bắt đầu** và **Ngày kết thúc** để trống nghĩa là giá luôn áp dụng; ngày kết thúc không được trước ngày bắt đầu.

## Yêu cầu báo giá chọn giá thế nào

Khi thêm dòng mà để trống đơn giá, đơn lấy giá của chính nhà cung cấp trên đơn, còn hiệu lực vào ngày đặt hàng theo lịch của công ty; ngày kết thúc vẫn được tính trọn. Các giá được xét theo thứ tự ưu tiên trên sản phẩm: giá đầu tiên có số lượng tối thiểu không vượt quá số lượng đặt được chọn, không giá nào đủ thì lấy giá đầu tiên. Nhà cung cấp đã lưu trữ thì không có giá. Giá đã điền vào dòng không tự đổi khi sửa số lượng hay khi bảng giá đổi sau đó.

## Chính sách lập hoá đơn sản phẩm

Mục **Chính sách lập hoá đơn sản phẩm** (cho người có quyền) chọn **Cơ sở lập hoá đơn** nhà cung cấp cho một mẫu sản phẩm: **Theo số lượng đặt** hay **Theo số lượng nhận**. Mặc định hàng hoá lập theo số lượng nhận, dịch vụ theo số lượng đặt.`,
  },
  en: {
    title: 'Vendor pricelists',
    source: `Each line is one vendor's price for a product: its minimum quantity, unit price, discount, lead time and validity. A request for quotation fills the unit price from these lines when you leave it empty.

## Reading the list

- **Validity** shows the days a price applies (its start and end days included) and its state today in the company's calendar: **In force**, **Not yet in force** (before its start date) or **Expired** (after its end date). A line without dates has **No limit**.
- The **Quantity tiers** filter keeps prices that apply from a quantity; **Discounted** keeps prices with a discount; **In force**, **Not yet in force** and **Expired** filter by validity.
- Choose a line to open and edit that price.

## Adding a price

Choose **Add Vendor Price**, pick the vendor and the product, then enter the minimum quantity, unit price, discount and lead time. Leave **Start Date** and **End Date** empty and the price always applies; the end cannot come before the start.

## How a request for quotation picks a price

When you add a line without a unit price, the order takes a price from its own vendor that is valid on its order date in the company's calendar; the end date counts in full. Prices are tried in the product's priority order: the first whose minimum quantity does not exceed the ordered quantity is used, and when none does, the first price. An archived vendor has no price. A price already on a line does not change when you edit the quantity or when the pricelist changes later.

## Product billing policy

The **Product billing policy** section (for those allowed) sets a product template's **Control Policy** for vendor bills: **On ordered quantities** or **On received quantities**. By default goods are billed on received quantities and services on ordered quantities.`,
  },
}
