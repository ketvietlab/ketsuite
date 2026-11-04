// The guide (Help drawer) in Markdown, kept apart from ./order-help.tsx, which draws it.
export const saleOrderHelp = {
  vi: {
    title: 'Báo giá và đơn bán',
    source: `Màn hình này là một báo giá hoặc đơn bán: khách hàng, các dòng sản phẩm, phiếu giao hàng và hoá đơn. Các nút ở đầu trang đổi theo trạng thái của đơn.

\`\`\`mermaid
flowchart TD
  A[Báo giá<br>nháp] --> B{Gửi khách<br>trước?}
  B -->|Có| C[Đánh dấu<br>đã gửi]
  B -->|Không| D[Xác nhận]
  C --> D
  D --> E[Đơn bán]
  E --> F[Giao hàng và<br>lập hoá đơn]
  class F kv-positive
\`\`\`

Mỗi báo giá hay đơn bán là một trang riêng, có địa chỉ riêng để gửi hoặc mở lại. Từ danh sách **Báo giá**, **Đơn bán hàng** hay trang **Tổng quan**, bấm một dòng để mở trang của đơn; **Về danh sách** trở lại đúng danh sách đã mở, giữ bộ lọc.

## Tạo báo giá

Bấm **Tạo báo giá** để mở trang báo giá mới. **Khách hàng** tìm trong cả danh bạ khi gõ (gõ đúng dấu của tên), trừ đối tác chỉ là nhà cung cấp; chưa có thì bấm **Xem thêm…** để tạo ngay. Chọn **Kho** xuất hàng. Kho được chọn sẵn khi bạn chỉ được gán một kho (ở **Nhân viên kho** của màn **Kho hàng**), hoặc khi bạn chưa được gán kho nào và công ty chỉ có một kho; được gán nhiều kho thì ô để trống cho bạn tự chọn, tránh nhầm kho. Tenant chưa có kho thì ô này khoá và chỉ chỗ tạo kho. Bấm **Tạo báo giá**: trang chuyển sang báo giá vừa tạo để thêm dòng.

Để trống **Bảng giá** và **Điều khoản thanh toán** thì báo giá lấy của khách hàng (đặt ở hồ sơ khách); khách chưa có bảng giá thì dùng bảng giá đầu tiên đang dùng của công ty (bảng giá bán lẻ), không có bảng giá nào thì dùng giá niêm yết.

## Cập nhật giá

Trên báo giá nháp hoặc đã gửi, bấm **Cập nhật giá** cạnh bảng **Sản phẩm**, chọn bảng giá (giữ nguyên hoặc đổi sang bảng khác, để trống là giá niêm yết) rồi bấm **Cập nhật giá**. Mọi dòng chưa giao, chưa xuất hoá đơn lấy lại đơn giá và chiết khấu theo bảng giá đó; giá sửa tay trên các dòng này được thay. Dòng combo, ưu đãi, chiết khấu đơn và dòng đã giao giữ nguyên. Lưu các thay đổi đang nhập trước khi cập nhật. Đơn đã xác nhận giữ bảng giá lúc bán nên không có nút này.

## Người bán và đội

Báo giá mới lấy người bán phụ trách của khách (màn **Khách hàng**); khách chưa có thì lấy người tạo. Đội bán hàng theo đội của người bán. Khi tạo, ô **Người bán** và **Đội bán hàng** để trống thì theo quy tắc đó, chọn thì lấy giá trị đã chọn. Đơn từ website không có người bán. Bấm **Sửa người bán** trên thẻ **Thông tin đơn hàng** để đổi: người bán mới mang theo đội của họ, trừ khi bạn chọn đội khác; xoá ô đội để đơn không thuộc đội nào. Sửa được cả khi đơn đã xác nhận và không đổi phiên bản đơn. Đội đã lưu trữ vẫn ở trên đơn đang thuộc nó nhưng không chọn được cho đơn khác. Gõ tên đội vào ô tìm kiếm của danh sách báo giá hoặc đơn bán để thấy các đơn của đội. Ở hai danh sách này, **Thêm bộ lọc** lọc theo người bán, đội ("chưa đặt" là đơn không thuộc đội nào) hoặc khách hàng; danh sách đơn bán lọc thêm theo sản phẩm. Trưởng bán hàng quản lý đội ở **Cấu hình → Đội bán hàng**.

## Thẻ

Bấm **Sửa thẻ** trên thẻ **Thông tin đơn hàng**, chọn tối đa 10 thẻ rồi bấm **Lưu thẻ**. Thẻ sửa được cả khi đơn đã xác nhận và không đổi điều khoản hay phiên bản của đơn. Thẻ đã lưu trữ vẫn ở trên đơn đang mang nó nhưng không gắn thêm được. Gõ tên thẻ vào ô tìm kiếm của danh sách báo giá hoặc đơn bán để thấy các đơn mang thẻ đó. Trưởng bán hàng tạo và sửa thẻ ở **Cấu hình → Thẻ bán hàng**.

## Cảnh báo khi bán

Khi công ty bật cảnh báo, **Lưu ý về…** hiện khách hàng trước rồi từng sản phẩm, kể cả quà tặng. Đổi khách hoặc sản phẩm trong bản nháp sẽ đọc lại lời nhắc; nhiều biến thể cùng sản phẩm chỉ hiện một lần. Cảnh báo không chặn lưu, gửi hay xác nhận. Đơn huỷ không hiện cảnh báo. Nội dung được sửa tại danh bạ khách và trang sản phẩm theo quyền riêng.

## Sửa bảng dòng của báo giá

- Báo giá nháp hoặc đã gửi thì bảng **Sản phẩm** sửa trực tiếp như bảng tính, nếu bạn có quyền thao tác báo giá; không có quyền đó thì bảng chỉ để xem. Bấm ô để sửa, dùng **Thêm dòng**, xoá hoặc sắp lại các dòng, rồi bấm **Lưu các dòng** để lưu cả bảng.
- Chọn sản phẩm trước, sau đó chọn đơn vị. Đổi sản phẩm xoá đơn vị và giá cũ; đổi đơn vị xoá giá cũ. Để đơn giá trống để tính giá tự động theo một đơn vị đóng gói. Đơn giá tự nhập cũng là giá cho một gói; giữ nguyên chuỗi thập phân khi nhập số tiền lớn.
- Dòng giá tự động đổi đơn giá và chiết khấu khi số lượng qua một bậc của bảng giá, kể cả bảng giá gốc. Quy tắc phần trăm hiện đơn giá gốc và CK riêng; công thức hiện giá kết quả với CK 0. Tự sửa đơn giá hoặc CK sẽ giữ giá thương lượng khi đổi số lượng. Lưu dòng để kiểm tra lại trên máy chủ; dòng đã giao hoặc xuất hóa đơn không tự đổi giá.
- Ô Sản phẩm hiện mã SKU; bộ chọn vẫn có tên đầy đủ để tìm. Cột thông tin xuống dưới bảng dòng khi trang chưa đủ rộng. Có thể để sản phẩm và đơn vị trống rồi nhập Diễn giải cho dòng tự do (tối đa 500 ký tự). Dòng này không thêm sản phẩm vào danh mục, không giao hàng, xuất hóa đơn theo số lượng đặt và có giá vốn 0. Cấu hình **Bắt buộc sản phẩm** chặn xác nhận và nêu tên dòng cần sửa.
- Cột Thuế chọn một thuế hoặc không thuế. Dòng đã có nhiều thuế giữ nguyên và khóa cột này. Thay đổi chỉ có hiệu lực khi lưu thành công; nếu một dòng không hợp lệ, cả bảng chưa được ghi. Bản nháp trên bảng vẫn còn để sửa.
- Nếu người khác đã sửa đơn, hệ thống từ chối phiên bản cũ. Tải lại trang để đọc phiên bản mới trước khi nhập lại thay đổi cần giữ.
- Báo giá đã có giao hàng hay hoá đơn, và đơn đã xác nhận, cũng dùng bảng này theo các giới hạn bên dưới.

## Sửa dòng đơn đã xác nhận

Đơn đã xác nhận chưa khoá vẫn sửa số lượng, đơn giá, chiết khấu, thuế và diễn giải trên bảng. Cột Đã giao/Đã lập hoá đơn thay cột lợi nhuận. Giữ số đặt khi giao vượt hoặc tăng số đặt đều được; chỉ giảm khi không thấp hơn số đã giao/lập hoá đơn. Giá tự động không đổi theo bậc khi đã có lịch sử. Chứng từ cũ giữ nguyên giá và số lượng của chúng.

Bảng này cũng thêm dòng hàng, nhóm hàng và ghi chú, xoá dòng và kéo để đổi thứ tự, như trên báo giá. Dòng hàng mới vào phiếu xuất đang mở của đơn; chưa có phiếu nào mở thì đơn tạo phiếu mới. Dòng chưa giao và chưa lập hoá đơn còn đổi được SKU, đơn vị hoặc xoá được: phần đang chờ giao của dòng trên phiếu xuất bị huỷ. Dòng đã giao, đã lập hoá đơn (kể cả hoá đơn đã huỷ hay đã trả lại) giữ nguyên SKU, đơn vị và không xoá được. Dòng đang lấy hàng dở trên phiếu cần bỏ số đã lấy trước.

Dòng combo cha chỉ đổi số lượng hoặc xoá cả combo khi chưa món nào giao; dòng con và ưu đãi giữ nguyên. Các thay đổi cùng lần lưu là một transaction: một dòng bị từ chối thì không dòng nào được ghi. Người khác sửa trước sẽ làm phiên bản của bạn hết hạn.

## Giảm giá

Trên báo giá chưa khóa, mở menu **Giảm giá** phía trên bảng sản phẩm. Menu gồm **Giảm tay**, **Khuyến mãi**, **Nhập mã** và **Đổi điểm**; mục Khuyến mãi và Đổi điểm chỉ hiện khi báo giá đã lưu có phần thưởng dùng được. Với **Giảm tay**, lưu nháp dòng hàng hoặc kế hoạch giao trước, rồi chọn phần trăm trên đơn, số tiền trước thuế hoặc phần trăm cho từng dòng bán thông thường. Cách cuối đặt CK của dòng và giữ giá thương lượng.

Giảm trên đơn thay khoản giảm đơn trước đó và chia theo tiền hàng trước thuế của từng nhóm thuế; nhóm cuối nhận phần dư làm tròn. Khoản giảm không vượt tiền hàng. Thuế phần trăm đã gồm trong giá giảm theo cơ sở trước thuế; thuế cố định theo đơn vị không đổi. Dòng chiết khấu/phần thưởng không sửa tay, chỉ xóa được. Nhập số tiền giảm 0 để bỏ chiết khấu đơn. Chỉ lập hóa đơn khi có dòng bán lập được và tổng không âm; nếu đổi số lượng, kiểm tra lại khoản giảm trước khi lập hóa đơn.

## Ưu đãi, mã và điểm thành viên

Khối **Ưu đãi và điểm** chỉ để xem: ưu đãi đã áp, điểm thành viên dự kiến/đã nhận và thẻ liên quan đến đơn. Mọi thao tác nằm trong menu **Giảm giá**. **Nhập mã** nhận mã chương trình, CP, DS hoặc TT. **Khuyến mãi** đưa ra chương trình đủ điều kiện mà báo giá chưa nhận, ví dụ khuyến mãi bạn đã xóa dòng giảm; mỗi lựa chọn ghi tên chương trình, phần thưởng theo đúng chữ của danh sách Khuyến mãi (ví dụ “Giảm 10% trên đơn”) và số tiền giảm trên báo giá này. **Đổi điểm** đưa ra phần thưởng mua bằng điểm của khách; mỗi lựa chọn ghi thêm điểm cần dùng. Cột **Phần thưởng** của bảng ưu đãi đã áp dùng cùng câu đó. Nếu báo giá đang có thay đổi chưa lưu, lưu trước khi áp mã, khuyến mãi hoặc đổi điểm.

Mã không tồn tại, đã dùng/hết hạn, sai khách/bảng giá, thiếu số lượng/giá trị hoặc hết lượt sẽ có thông báo ngay tại ô nhập; nội dung đã nhập được giữ để sửa. Nhập lại mã đang áp dụng không áp thêm lần nữa. Người chỉ xem không có nút thay đổi; server vẫn kiểm quyền của mỗi lệnh.

Chiết khấu thủ công được tính trước, rồi các chương trình dùng phần giá trị còn lại theo thứ tự cấu hình. Sửa báo giá sẽ tính lại và bỏ thưởng không còn đủ điều kiện. Dòng thưởng nằm cuối bảng và không sửa trực tiếp. Muốn bỏ một ưu đãi, xóa dòng giảm của nó trong bảng rồi lưu: hệ thống bỏ cả các dòng tách thuế của ưu đãi đó và nhả điểm; sửa số lượng sau đó không tự áp lại. Muốn áp lại, chọn ở **Khuyến mãi** hoặc nhập lại mã.

Điểm TT cần tiêu được giữ đủ trước khi xác nhận, điểm kiếm được tính trên tổng cuối cùng sau giảm. Thẻ TT chỉ được cấp khi có phát sinh; đọc báo giá không tạo thẻ. CP dùng một lần; DS phát sinh sau đơn nguồn để dùng cho đơn sau. Đơn đã xác nhận giữ nguyên ưu đãi lịch sử. Khi xác nhận báo giá cũ có ưu đãi mới đủ điều kiện, tải và lưu lại báo giá trước khi xác nhận.

## Giao vượt và lập hoá đơn
Hộp Tạo hoá đơn hiển thị số lượng còn lập được. Hàng theo số giao gồm cả phần giao vượt số đặt, được ghi riêng dưới số lượng. Hàng theo số đặt đã lập hết hoá đơn nhưng giao vượt có trạng thái Cơ hội bán thêm. Số đặt không tự tăng; tăng số đặt chỉ tạo thêm nhu cầu chưa giao, không giao trùng.

## Tiền đặt cọc
Trên báo giá đã gửi hoặc đơn đã xác nhận, kế toán bấm **Thu đặt cọc** ở thẻ **Tiền đặt cọc**: chọn phần trăm tổng đơn hoặc số tiền, sổ thu tiền (ngân hàng hoặc tiền mặt) và tài khoản phải thu của khách. Tiền cọc ghi thành phiếu thu của khách, đã ghi sổ, không phải hoá đơn: hàng hoá lập hoá đơn khi chuyển giao quyền sở hữu, dù đã thu tiền hay chưa (Nghị định 123/2020, điều 9). Tổng các khoản cọc không vượt tổng đơn.

Khi hoá đơn của đơn đã ghi sổ, bấm **Trừ vào hoá đơn**, chọn khoản cọc và hoá đơn. Phần trừ là số nhỏ hơn giữa phần hoá đơn còn phải thu và phần cọc chưa trừ; cột **Chưa trừ** cho biết còn lại bao nhiêu. Khoản cọc và hoá đơn phải cùng tài khoản phải thu. Người bán thấy các khoản cọc trên đơn nhưng không thu hay trừ.

## Nhân bản báo giá

Trên đầu trang, chọn **Nhân bản báo giá** với quyền thao tác báo giá. Lưu các thay đổi đang nhập trước khi xác nhận. Có thể nhân bản báo giá, đơn đã xác nhận hoặc đã hủy do hệ thống này quản lý.

Bản sao có số mới, trạng thái nháp và ngày hôm nay; thời hạn hiệu lực được dịch theo số ngày của bản gốc. Giữ khách hàng, kho, điều khoản, nhóm hàng tùy chọn, món combo đã chọn và yêu cầu ký/đặt cọc. Giá tự động và ưu đãi được tính lại theo ngày mới; giá thương lượng giữ nguyên. Mã khuyến mãi dùng lại chỉ được giữ nếu còn hợp lệ. Thẻ coupon, thẻ lần mua sau và điểm đã dùng không chuyển sang bản sao.

Lịch sử gửi, ký, thanh toán, giao hàng, hóa đơn và điểm đã ghi nhận vẫn thuộc đơn gốc. Xác nhận bản sao sẽ tạo chứng từ và điểm mới theo chính sách hiện hành. Nếu sản phẩm không còn bán, mã đích bị trùng hoặc nguồn vừa thay đổi, hệ thống từ chối toàn bộ; tải lại nguồn và thử lại.

## Nhóm hàng mẫu và mẫu báo giá

Nhóm hàng mẫu là một nhóm dòng (ví dụ "Bộ chăm sóc tối") được lưu lại để thêm vào báo giá khác. Khi có module Mẫu bán hàng và bạn được cấp quyền, menu **Nhóm hàng mẫu → Lưu “tên nhóm” làm mẫu** lưu nhóm có sản phẩm từ đơn chưa hủy. Mẫu thuộc người lưu; trùng tên của chính bạn cần xác nhận ghi đè hoặc khôi phục bản đã lưu trữ. Không sao chép giá, combo, dòng tự do hoặc nhóm lồng nhau.

**Thêm nhóm hàng mẫu** nối vào cuối đơn chưa khóa, giữ dòng cũ và tính giá hiện tại. Lưu các thay đổi đang nhập trước khi lưu hoặc thêm nhóm. Người bán chỉ chọn mẫu hoạt động thuộc đội của mình hoặc dùng chung; quản lý chọn được mọi đội.

Chọn **Mẫu báo giá** khi tạo mới để tạo đơn và chèn dòng cùng một lần lưu. **Dùng báo giá mẫu** trên đơn nháp/đã gửi hỏi xác nhận trước khi thay dòng. Quản lý mẫu tại **Cài đặt → Mẫu bán hàng**. Yêu cầu ký/trả trước chỉ được lưu trong bản ghi; chức năng này không tạo liên kết ký hoặc thu tiền.

## Lưới số lượng biến thể

Menu **Chọn biến thể** ở phần dòng liệt kê sản phẩm đang bán có ít nhất hai SKU hoạt động và bật **Lưới số lượng** trong thông tin chung. Chọn sản phẩm để lưu nháp đơn và mở lưới. Nhập các ô cần đổi rồi **Lưu số lượng**; ô trống hoặc 0 xóa dòng đầu tiên nếu lịch sử cho phép. Cả lưới được lưu cùng nhau; một ô bị từ chối thì không ô nào thay đổi. Combo luôn chọn trên dòng hàng.

## Danh mục sản phẩm

Bấm **Danh mục** ở phần dòng để lưu các thay đổi đang nhập trong bảng và kế hoạch giao, rồi mở trang chọn sản phẩm. Bộ lọc nằm trong đường dẫn để có thể quay lại hoặc chia sẻ. Nhập số lượng rồi Enter/rời ô, hoặc dùng nút cộng/trừ; thay đổi áp dụng vào dòng đầu tiên của SKU đó. Giá tự động được tính lại theo số lượng khi chưa có lịch sử; giá nhập tay và giá có lịch sử được giữ. Số 0 chỉ xóa dòng chưa có tham chiếu giao hàng/hóa đơn. Đơn đã xác nhận nhưng chưa khóa vẫn sửa được trong danh mục, theo giới hạn đã giao/lập hóa đơn.

## Nhóm hàng và ghi chú

Dùng **Thêm nhóm hàng** hoặc **Thêm ghi chú**, nhập tên rồi **Lưu các dòng**. Các dòng này không tính tiền, không có giá vốn và không tạo giao hàng hay hóa đơn. Nhóm hàng gồm các dòng phía sau tiêu đề nhóm cho đến nhóm tiếp theo; ghi chú không kết thúc nhóm.

Lưu bảng trước khi mở **Nhóm hàng tùy chọn** ở thẻ Dòng hàng. Chỉ người sửa được báo giá mới dùng lệnh này. Đánh dấu một nhóm hàng lần đầu đưa số lượng dòng trong nhóm về 0, kể cả các món combo. Lưu lại cùng lựa chọn giữ số lượng đã sửa; bỏ đánh dấu cũng giữ số lượng. Nhãn **· Tùy chọn** hiện sau tên nhóm hàng, kể cả trên bản in báo giá, đơn bán và hóa đơn chiếu lệ. Bản in giữ thứ tự dòng; nhóm hàng và ghi chú trải hết chiều rộng, không có ô số lượng hoặc giá. Người bán nhập số lượng khách chọn vào bảng và lưu. Số lượng 0 được giữ khi xác nhận nhưng không giao, không xuất hóa đơn; dòng hóa đơn vẫn cần số lượng dương. Màn hình này chưa có luồng khách tự chọn khi ký hoặc thanh toán.

## Kế hoạch giao hàng

**Giao ngay phần có sẵn** lấy ngày dự kiến sớm nhất của các hàng hóa; **Giao một lần** lấy ngày muộn nhất. Phiếu giao theo **Giao một lần** chỉ **Sẵn sàng** khi mọi dòng đã giữ đủ hàng; đổi cách giao trên đơn đã xác nhận thì trạng thái phiếu đổi theo ngay. Báo giá tính từ ngày lập đơn; đơn đã xác nhận tính từ lúc xác nhận. Ngày lịch tính theo múi giờ công ty, không theo múi giờ người xem. Số ngày lấy từ sản phẩm hiện tại và dùng chung cho các biến thể. Dịch vụ không tạo ngày dự kiến; combo tính theo các món hàng hóa.

**Ngày cam kết giao** không được trước ngày lập đơn. Có thể để trống; dòng gợi ý bên dưới và cột thông tin hiện ngày dự kiến. Khi xác nhận hoặc lưu kế hoạch, phiếu xuất chưa hoàn tất dùng ngày cam kết nếu có, nếu không dùng ngày dự kiến. Phiếu đã hoàn tất hoặc đã hủy giữ nguyên. Người có quyền thao tác báo giá có thể sửa kế hoạch khi đơn chưa khóa; đơn do kênh ngoài quản lý không sửa tại đây. Thay đổi số ngày trên sản phẩm cập nhật dự kiến khi đọc lại; lưu kế hoạch để áp dụng cho phiếu đang mở.

## Giá vốn của các dòng đã lưu

Nếu có quyền xem giá vốn bán hàng, khối **Giá vốn của các dòng đã lưu** hiện giá vốn cho một đơn vị của từng dòng, bằng tiền tệ công ty. Khối này chưa phản ánh bản nháp bạn đang sửa. Lưu dòng thì giá vốn lấy theo giá vốn sản phẩm lúc đó; đọc lại hoặc xác nhận đơn không tự tính lại. Khi hàng của dòng đã xuất kho, giá vốn tính theo giá trị Kho thực xuất (trừ hàng khách trả về), phần chưa giao theo giá vốn bình quân hiện tại; số này cập nhật sau mỗi phiếu giao, phiếu trả và mỗi lần lưu bảng dòng của đơn đã xác nhận. Giá vốn thiếu hiện **Chưa có giá vốn**, khác với giá vốn bằng 0. Dữ liệu này không đi vào báo giá gửi khách. Dòng cũ chưa có giá vốn sẽ chưa hiện ở đây.

## Sửa lợi nhuận trên báo giá

Người có quyền xem giá vốn thấy cột **Lợi nhuận** và **Lợi nhuận %**. Gõ lợi nhuận dòng để tính lại đơn giá từ giá vốn, số lượng và chiết khấu; gõ tỷ lệ để tính mức giá đạt tỷ lệ đó. Đơn giá được làm tròn đến đồng rồi lưu như giá nhập tay bằng **Lưu các dòng**. Đây là tính toán theo đơn giá sau chiết khấu trong bản nháp; thuế và số tiền đã lưu vẫn do server tính. **Lợi nhuận đã lưu** ở phần tổng và bảng giá vốn chỉ đổi sau khi lưu thành công.

Dòng tự do, combo/món combo, thiếu giá vốn hoặc khác tiền tệ không sửa lợi nhuận. Số lượng 0, chiết khấu 100%, tỷ lệ từ 100% trở lên, giá âm hoặc kết quả vượt phạm vi số an toàn giữ giá cũ. Giá vốn 0 khác với thiếu giá vốn. Đổi SKU xoá đơn vị/giá/giá vốn nháp; chọn lại đơn vị lấy giá bán và giá vốn theo đúng đóng gói qua quyền giá vốn. Sau khi xác nhận, bảng dòng hiện số đã giao/đã xuất hóa đơn; tổng lợi nhuận đã lưu vẫn hiện với đúng quyền.

## Dòng combo

Chọn sản phẩm Combo và lưu: mỗi lựa chọn tạo một dòng món ngay dưới combo. Món đầu tiên được chọn sẵn. Giá combo theo bảng giá được chia theo tỷ lệ giá bán của các món, món cuối nhận phần làm tròn, rồi cộng phụ thu. Ô giá của combo trong bảng sửa là giá để phân bổ; số tiền đơn hàng chỉ tính ở các món.

Dòng món chỉ đổi được sản phẩm trong lựa chọn của nó. Số lượng và chiết khấu theo combo; đơn vị, thuế và giá món bị khóa. Xóa riêng dòng món rồi lưu sẽ đưa nó trở lại; xóa combo xóa cả nhóm.

Giao hàng và hóa đơn ghi từng món. Khi đã có phiếu kho hoặc hóa đơn, đổi giá combo không chia lại giá món. Có thể sửa số lượng combo nhưng không thấp hơn số đã giao, lập hóa đơn hoặc nhặt hàng. Hệ thống điều chỉnh phần chưa giao và trả phần giữ hàng dư; tăng sau khi giao xong tạo phiếu bổ sung. Giá món, thuế và chiết khấu đã phát sinh được giữ nguyên. Không xóa combo có lịch sử giao/hóa đơn.


## Báo giá đã có giao hàng hoặc hoá đơn

- Báo giá (nháp hoặc đã gửi) có dòng đã có phiếu kho hay hoá đơn, ví dụ một đơn đã xác nhận được mở lại thành báo giá, vẫn sửa trên bảng **Sản phẩm**. Các dòng đã lưu được giữ nguyên: không đổi sản phẩm hay đơn vị, không xoá hay sắp lại dòng. Cột **Đã giao** và **Đã lập hoá đơn** hiện cạnh số lượng.
- Số lượng, đơn giá, chiết khấu, thuế và diễn giải của dòng đã lưu sửa như trên đơn đã xác nhận; số lượng không giảm dưới số đã giao hoặc đã lập hoá đơn.
- **Thêm dòng** thêm dòng sản phẩm mới. Lưu xong, các dòng mới nằm sau các dòng đã có, theo thứ tự trên bảng. Báo giá này không nhận thêm nhóm hàng hay ghi chú.
- Ô **Sản phẩm** hiện mã của biến thể; gõ để tìm trong mọi sản phẩm đang bán theo tên đầy đủ (ví dụ "Áo thun cổ tròn S · Xanh lá"), không cần gõ dấu, và mã hay barcode cũng tìm được. Biến thể đã ngừng bán, hoặc sản phẩm chưa bật **Có thể bán**, không có trong kết quả.
- Để trống **Đơn giá** thì hệ thống dùng bảng giá của đơn, nếu không có thì dùng giá niêm yết. Một dòng bị từ chối thì không dòng nào được ghi.
- **Dùng báo giá mẫu** và **Giảm giá** › **Giảm tay** không có trên báo giá này, vì cả hai viết lại mọi dòng. Giảm giá một dòng thì sửa ô **Chiết khấu** của dòng đó.

## Trạng thái và hành động

Các nút ở đầu trang:

- **Đánh dấu đã gửi** ghi nhận báo giá đã gửi cho khách. Bạn vẫn sửa được các dòng.
- **Xác nhận** chuyển báo giá thành đơn bán và tạo phiếu giao hàng từ kho của đơn. Danh mục vẫn cho phép thêm hoặc sửa số lượng trên đơn chưa khóa; lịch sử giao hàng/hóa đơn giới hạn việc giảm hoặc xóa dòng. Khi công ty dùng Loyalty, xác nhận cũng chốt ưu đãi của đơn; **Mở ưu đãi Loyalty** mở phần ưu đãi trước khi xác nhận.
- Phiếu giao hoặc phiếu trả hoàn tất thì đơn tự cập nhật số lượng đã giao. **Đồng bộ giao hàng** đọc lại các phiếu khi số trên đơn chưa khớp.
- Bảng **Giao hàng** có một dòng cho mỗi sản phẩm trên phiếu (combo hiện từng món), với số đã giao và trạng thái của phiếu.

Cũng ở đầu trang, khi trạng thái cho phép:

- **Khoá đơn** đánh dấu đơn bán đã chốt; **Mở khoá** bỏ dấu này.
- **Huỷ** đưa báo giá hoặc đơn bán sang trạng thái huỷ (và hoàn ưu đãi Loyalty nếu có). Đơn đã huỷ có **Đưa về nháp** để mở lại thành báo giá nháp.

Trong Commerce có tích hợp loyalty, xác nhận lưu đơn, phiếu giao và sổ điểm cùng nhau. Nếu ưu đãi đã áp không còn hợp lệ, xác nhận bị từ chối và đơn giữ nguyên; kiểm tra chương trình trước khi thử lại. Hủy đơn hoàn tác sổ điểm trong cùng lần lưu. Xác nhận lại sau khi đưa về nháp tạo một lần ghi điểm và phiếu giao mới; gọi lại cùng lệnh không ghi điểm hai lần.

## Giao hàng và hoá đơn

Trang đọc từ trên xuống: **Thông tin đơn hàng**, **Sản phẩm**, rồi **Giao hàng** và **Hoá đơn** khi đơn đã có. Đơn bán đã xác nhận có nút **Tạo hoá đơn** ở khối **Hoá đơn**: chọn sổ nhật ký, tài khoản doanh thu và công nợ, tài khoản thuế nếu có và ngày hoá đơn, rồi bấm **Tạo hoá đơn**. Hoá đơn đã tạo nằm trong bảng của khối này. Lập hoá đơn là việc của kế toán (và chủ doanh nghiệp); người bán xem được đơn nhưng không có nút này. Không có chứng từ giảm trừ riêng: kế toán huỷ hoá đơn nháp hoặc đảo bút toán hoá đơn đã ghi sổ, và số lượng đó trở lại trạng thái **Chờ lập hoá đơn** của đơn.

## Lịch sử thay đổi

Khối cuối trang ghi lại mỗi thao tác đã làm đổi đơn, mới nhất ở trên, tối đa 30 dòng:
- **Thời điểm** theo múi giờ của công ty, **Người thực hiện**, **Thao tác** và **Chi tiết**.
- Thao tác gồm tạo, lưu, gửi, xác nhận, huỷ, khoá, sửa dòng, giảm giá, đổi người bán hoặc thẻ, tạo hoá đơn, thu và cấn trừ đặt cọc.
- **Chi tiết** nêu chứng từ liên quan: hoá đơn, phiếu thu cọc, hoặc báo giá gốc của bản nhân bản. Bấm vào để mở chứng từ nếu bạn có quyền xem nó.
- Lệnh bị từ chối, lệnh gọi lại hoặc lệnh không làm đơn thay đổi thì không thêm dòng.
- Thao tác do hệ thống chạy hiện là **Hệ thống**.

Nhật ký chỉ được thêm, không ai sửa hay xoá được. Ai xem được đơn thì đọc được lịch sử của đơn. Các thay đổi đến từ chứng từ khác (hoàn tất phiếu giao, huỷ hoặc đảo hoá đơn) không ghi ở đây; xem chúng trên chính chứng từ đó. Đơn tạo trước khi có nhật ký chỉ có các thao tác từ lúc đó trở đi.

## In và trao đổi

Nút **In** chỉ đưa ra các mẫu hợp với trạng thái hiện tại của đơn. Cột bên phải (trên màn hẹp là phần dưới đơn) ghi lại trao đổi và hoạt động của đơn.`,
  },
  en: {
    title: 'Quotations and sales orders',
    source: `When company **Sales warnings** is enabled, **Note about…** shows the customer first, followed by each product including gifts. Changing draft selections reloads the notes; variants of one product share a single warning. Notes do not block saving, sending or confirming. Cancelled orders hide them. Authorized editors maintain notes on the customer and product pages.

This page is one quotation or sales order: its customer, product lines, deliveries and invoices. The buttons at the top change with the order's state.

\`\`\`mermaid
flowchart TD
  A[Draft<br>quotation] --> B{Send to the<br>customer first?}
  B -->|Yes| C[Mark as<br>sent]
  B -->|No| D[Confirm]
  C --> D
  D --> E[Sales order]
  E --> F[Deliver and<br>invoice]
  class F kv-positive
\`\`\`

Each quotation or sales order is a page of its own, with an address to share or reopen. From **Quotations**, **Sales Orders** or the **Overview**, open a row to go to the order's page; **Back to list** returns to the list you came from, filters kept.

## Creating a quotation

Press **Create Quotation** to open a new quotation's page. **Customer** searches all contacts as you type (with the name's accents), leaving out partners that only supply; when they are not there yet, **Search more…** creates them on the spot. Pick the **Warehouse** it ships from. It is chosen for you when you are assigned to one warehouse only (in **Warehouse staff** on the **Warehouses** screen), or when you are assigned to none and the company has one warehouse; assigned to several, the field stays empty for you to choose, so no quotation lands in the wrong warehouse. A tenant without a warehouse sees the field shut, with where to create one. Press **Create Quotation**: the page moves to the new quotation, ready for lines.

Leave **Pricelist** and **Payment Terms** empty and the quotation takes the customer's (set on the customer page); a customer without a pricelist gets the company's first active pricelist (the retail one), and with no pricelist at all, list prices.

## Update prices

On a draft or sent quotation, choose **Update prices** beside the **Products** table, pick the pricelist (the same, another, or empty for list prices) and choose **Update prices**. Every line not yet delivered or invoiced takes its unit price and discount from that pricelist again; prices typed by hand on those lines give way. Combo items, rewards, order discounts and delivered lines stay as they are. Save pending edits before updating. A confirmed order keeps the pricelist it was sold under, so it has no such button.

## Salesperson and team

A new quotation takes the customer's salesperson (**Customers** screen), or the person creating it when the customer has none, and that salesperson's sales team. Creating, leave **Salesperson** and **Sales team** empty to follow that rule, or choose others. Web orders have no salesperson. Choose **Edit salesperson** on the **Order information** card to change them: a new salesperson brings their team unless you choose another; clear the team to leave the order in none. This works on confirmed orders too and does not change the order's revision. An archived team stays on the orders in it but cannot be chosen for others. Type a team's name in the quotation or sales order list search to find its orders. In both lists, **Add filter** narrows by salesperson, team ("is not set" for orders outside every team) or customer; the sales order list also by product. Sales managers keep teams in **Configuration → Sales teams**.

## Tags

Choose **Edit tags** on the **Order information** card, pick up to 10 tags and choose **Save tags**. Tags can change on a confirmed order too and change neither its terms nor its revision. An archived tag stays on an order that carries it but cannot be added. Type a tag's name in the quotation or sales order list search to find the orders that carry it. Sales managers create and edit tags in **Configuration → Sales tags**.

## Edit confirmed order lines

An unlocked confirmed order can edit quantity, unit price, discount, tax and description in the grid. Delivered/Invoiced columns replace margins. Keep the original ordered quantity after overdelivery or increase it; reductions cannot go below delivered or invoiced quantities. Automatic tiers preserve historical prices. Existing delivery and invoice documents keep their own values.

The grid also adds product lines, sections and notes, removes lines and reorders them by dragging, as on a quotation. A new product line joins the order's open delivery; with none open the order creates one. A line neither delivered nor invoiced can still change its SKU or unit, or be removed: what it was waiting to deliver is cancelled on the delivery. A delivered or invoiced line (including a cancelled or refunded invoice) keeps its SKU and unit and stays on the order. A line partly picked on its delivery needs the picked quantity cleared first.

Combo parents edit quantity only, or remove the whole combo while none of its items is delivered; child and benefit rows remain fixed. A save is atomic: one refused line rolls back every edit. A concurrent edit makes the old revision stale.

## Discounts

On an unlocked quotation, open the **Discount** menu above the products. It holds **Manual discount**, **Promotions**, **Enter code** and **Redeem points**; Promotions and Redeem points appear only when the saved quotation has a reward it can take. For **Manual discount**, save pending line or delivery edits first, then choose a percentage on the order, a fixed untaxed amount, or a percentage for each ordinary line. The last option sets the line discount and keeps the negotiated price.

Order discounts replace the previous order adjustment and split across tax groups in proportion to untaxed merchandise; the final group receives the rounding remainder. They cannot exceed that merchandise amount. Included percentage taxes are reduced from the untaxed base; fixed per-unit levies are unchanged. Discount/reward rows cannot be edited, but may be removed. Set the order amount to zero to remove its discount. Invoice creation requires an ordinary billable line and a non-negative total; if quantities change, review the discount before invoicing.

## Benefits, codes and membership points

The **Benefits and points** block is read-only: applied rewards, expected/earned membership points and cards related to this order. Every action sits in the **Discount** menu. **Enter code** accepts a program, CP, DS or TT code. **Promotions** lists eligible programs the quotation does not have yet, such as one whose discount row you deleted; each choice gives the program name, its reward in the words of the Promotions list (such as “10% off the order”) and the amount it takes off this quotation. **Redeem points** lists rewards bought with the customer’s points and adds their point cost. The **Reward** column of the applied benefits uses the same words. Save pending quotation changes before applying a code, promotion or points reward.

Missing, used/expired, wrong-customer/price-list, minimum quantity/amount and usage-limit errors appear beside the code while retaining the input. Entering an applied code again does not apply it twice. Readers have no write controls; each server command independently checks authorization.

Manual discounts apply first, then programs use the remaining basis in configured order. Saving recalculates benefits and removes ineligible rewards. Reward rows stay at the end and cannot be edited directly. To drop a benefit, delete its discount row in the table and save: every tax-group row of that benefit goes and its points are released; later quantity edits do not silently restore it. Choose it under **Promotions** or enter its code again to apply it again.

TT spending is fully reserved before confirmation; earning uses the final discounted total. Reading a quotation never issues a TT card. CP coupons are single-use; DS coupons are issued by the source order for a later order. Confirmed benefits remain historical. If a stale quotation is missing a newly eligible automatic reward, reload and save it before confirming.

## Overdelivery and invoicing
Create invoice previews the remaining invoiceable quantities. Delivery-based lines include excess delivery, listed below the quantity. Order-based lines become an Upselling Opportunity after all billable quantities are invoiced. Ordered quantities do not increase automatically; increasing them creates only undelivered demand.

## Deposits
On a sent quotation or a confirmed order, the accountant clicks **Collect deposit** on the **Deposits** card: a percent of the order's total or an amount, the journal it is received into (bank or cash) and the customer's receivable account. A deposit is a posted customer receipt, not an invoice: goods are invoiced when ownership passes, paid or not (Decree 123/2020, article 9). Deposits never add up to more than the order.

Once the order's invoice is posted, click **Set off against invoice** and choose the deposit and the invoice. It sets off the smaller of what the invoice still owes and what the deposit has not yet set off; the **Not set off** column shows what is left. The deposit and the invoice must use the same receivable account. Sellers see the deposits on the order but neither collect nor set them off.

## Duplicate a quotation

At the top of the page, choose **Duplicate quotation** with quotation operation permission. Save pending edits before confirming. Locally managed quotations, confirmed orders and cancelled orders can be copied.

The copy has a new number, draft state and today's date; its validity period shifts by the original number of days. Customer, warehouse, commercial terms, optional sections, selected combo items and signature/deposit preferences are retained. Automatic prices and benefits are recalculated for the new date; negotiated prices stay unchanged. Reusable promotion codes survive only while eligible. Coupons, next-order cards and spent membership points are not transferred.

Sending, signature, payment, delivery, invoice and posted-point history stays with the original. Confirming the copy creates fresh documents and points under current policy. An unavailable product, conflicting destination ID or changed source refuses the whole operation; reload the source and retry.

## Section and quotation templates

When Sales templates is installed and permitted, **Section templates** saves a product section from a non-cancelled order. The saver owns the copy; overwriting their same-name template or restoring its archived version requires confirmation. Prices, combos, free lines and nested sections are excluded.

**Add section from template** appends to an unlocked order, preserves old lines and calculates current prices. Save pending edits first. Sellers choose active templates for their own teams or shared templates; managers may choose every team.

Choose a quotation template when creating a quotation to create the order and lines atomically. **Apply quotation template** asks before replacing existing draft/sent quotation lines. Manage templates through **Settings → Sales templates**. Signature/prepayment preferences are saved requirements, not signing or payment links.

## Editing quotation lines

- A draft or sent quotation edits its **Products** table in place, like a spreadsheet, when you may operate quotations; without that right, the table is read only. Edit cells, add or remove rows, or reorder them, then choose **Save lines** to save the whole grid.
- Choose a product before its unit. Changing the product clears its unit and price; changing the unit clears its price. Leave the price blank for automatic pricing per packaging. An entered price is also per packaging; decimal text preserves large exact amounts.
- Automatic lines update unit price and discount when quantity crosses a pricelist tier, including base-list tiers. Percentage rules show the base unit price and a separate discount; formulas show the resulting price with zero discount. Editing price or discount keeps the negotiated price on quantity changes. Save lines to validate on the server; delivered or invoiced lines do not automatically reprice.
- Product cells show the SKU code; the picker keeps the full name for searching. The reference rail moves below wide line tables until the page has enough room. Leave product and unit empty and enter a Description for a free line (up to 500 characters). It creates no catalogue product or delivery, invoices ordered quantities and has zero cost. **Require a product** in Sales configuration blocks confirmation and names the affected line.
- The Tax column selects one tax or no tax. Existing multi-tax lines retain their taxes and lock this column. Changes take effect only after saving. If any row is invalid, none of the changes are written and the grid keeps your draft for correction.
- If another person changed the order, the old revision is refused. Reload the page to read the latest revision before entering the changes you need to retain.
- Quotations with delivery or invoice history, and confirmed orders, use the same grid within the limits below.

## Product catalogue

**Choose variants** lists active selling products with at least two active SKUs and **Quantity matrix** enabled in General information. Selecting one saves pending order drafts and opens the matrix. Edit quantities and choose **Save quantities**. Blank or zero removes the first line only when history permits. All cells save together; any refusal leaves every cell unchanged. Combos always use order lines.

**Catalogue** in the lines section saves pending grid and delivery-plan edits before opening the product page. Filters remain in the URL. Enter a quantity and press Enter or leave the field, or use plus/minus; this updates the first line for that SKU. Automatic prices requote before stock/invoice history; manual and historical prices stay fixed. Zero removes only lines without stock/invoice references. Confirmed unlocked orders remain editable within delivered/invoiced quantity limits.

## Sections and notes

Use **Add section** or **Add note**, enter a name and **Save lines**. These rows have no amounts, costs, deliveries or invoices. A section contains following rows until the next section; notes do not end it.

Save the grid before opening **Optional sections** in Lines. Only quotation editors can use this command. Newly checking a section sets its line quantities to zero, including combo items. Saving the same checked set preserves quantities you subsequently entered; unchecking also preserves them. The section shows **· Optional**, including quotation, sales-order and pro-forma reports. Reports preserve line order; sections and notes span the content width without quantity or price cells. Sellers enter customer-selected quantities in the grid and save. Confirmation retains zero-quantity rows without delivery or invoicing; invoice lines still require positive quantities. This screen does not yet provide customer selection during signing or payment.

## Delivery plan

**Deliver available items** uses the earliest goods date; **Deliver once** uses the latest. A delivery under **Deliver once** is **Ready** only when every line is held in full; changing how a confirmed order ships changes its delivery's state at once. Quotations start from the order date and confirmed orders from their confirmation time. Calendar days use the company timezone, independently of the viewer timezone. Lead days come from the current product and are shared by its variants. Services have no expected delivery date; combos use their goods items.

The **Committed delivery date** cannot precede the order date and may be cleared. Its hint and the record aside show the expected date. Confirmation or saving the plan schedules open outgoing transfers to the commitment, otherwise the expected date. Completed and cancelled transfers retain their dates. Quotation operators can edit unlocked local orders; externally managed orders cannot be changed here. Catalogue lead changes update the displayed expectation; save the plan to apply it to open transfers.

## Saved line costs

With sales cost access, **Saved line costs** shows the cost of one selling unit in the company currency. It describes saved lines, not your pending draft. Saving lines takes the product cost of that moment; reading or confirming an order does not reprice them. Once a line's goods leave the warehouse, its cost is what stock took out (less what the customer returned), with what is still to deliver at today's average cost; it updates after each delivery, return and each save of a confirmed order's lines. **Cost unavailable** is different from zero. Customer quotations do not include this information. Older lines without a cost are not listed yet.

## Editing quotation margins

Readers with cost access see **Margin** and **Margin %**. Enter a line margin to solve unit price from cost, quantity and discount, or enter a percentage to solve for that rate. The price rounds to a whole currency unit and is persisted as a manually entered price through **Save lines**. This draft calculation uses the discounted unit price; the server still calculates taxes and saved amounts. **Saved order margin** and the cost table update only after a successful save.

Free lines, combos/items, missing costs and differing currencies cannot edit margin. Zero quantity, 100% discount, a percentage of 100% or higher, negative prices or results beyond the safe numeric range keep the old price. Known zero cost differs from missing cost. Changing SKU clears draft unit/price/cost; selecting the unit loads its packaging price and cost through the cost permission. Confirmed line tables show delivered/invoiced quantities; the saved margin total remains visible with cost access.

## Combo lines

Save a Combo product to create one item line immediately below it for each choice, using its first item by default. The pricelist combo price is allocated in proportion to item sales prices; the last item receives the rounding remainder, then each item's extra is added. The combo price shown in the editable grid is its allocation price; only items contribute to order amounts.

An item line can only select another product from its choice. Quantity and discount follow the parent; item unit, tax and price are locked. Removing an item alone restores it on save; removing the combo removes its group.

Deliveries and invoices contain items. Once stock or invoice history exists, changing the retained combo price never reallocates item prices. Combo quantity cannot fall below delivered, invoiced or picked quantities. Changing it adjusts pending demand and releases excess reservations; increasing a fully delivered combo creates a supplementary transfer. Historical item prices, taxes and discounts stay fixed. A combo with delivery/invoice history cannot be removed.


## Quotations with deliveries or invoices

- A quotation (draft or sent) whose lines already have a transfer or an invoice, such as a confirmed order reopened as a quotation, still edits its **Products** grid. Its saved lines stay: their product and unit do not change, and they are not removed or reordered. **Delivered** and **Invoiced** show beside the quantity.
- The quantity, unit price, discount, tax and description of a saved line change as on a confirmed order; the quantity cannot fall below what was delivered or invoiced.
- **Add line** adds a new product line. Once saved, new lines follow the existing ones, in the grid's order. Such a quotation takes no new section or note.
- The **Product** cell shows the variant's code; type to search every product on sale by its full name (for example "Crew-neck tee S · Green"); accents are optional, and codes and barcodes match too. A variant that stopped selling, or a product not marked **Can be sold**, is not found.
- Leave **Unit Price** blank to use the order's pricelist, or the list price when there is none. If one line is refused, none is written.
- **Apply quotation template** and **Discount** › **Manual discount** are not offered on such a quotation, because both rewrite every line. To discount a line, edit its **Discount** cell.

## States and actions

The buttons at the top of the page:

- **Mark as Sent** records that the quotation went to the customer. Its lines stay editable.
- **Confirm** turns the quotation into a sales order and creates a delivery from the order's warehouse. The catalogue still allows quantity edits and additions on unlocked orders, subject to delivery and invoice history. Where the company uses Loyalty, confirming also finalizes the order's rewards; **Open Loyalty benefits** opens them before you confirm.
- When a delivery or return is done, the order updates its delivered quantities. **Sync Deliveries** reads the transfers again when the order's numbers do not match.
- The **Deliveries** table has one row per product on the delivery (a combo shows each item), with the quantity delivered and the delivery’s state.

Also at the top, when the state allows:

- **Lock** marks a sales order as settled; **Unlock** clears that mark.
- **Cancel** moves a quotation or sales order to cancelled (and reverses its Loyalty rewards, if any). A cancelled order offers **Set to draft** to reopen it as a draft quotation.

In Commerce with loyalty installed, confirmation saves the order, delivery and points ledger together. If an applied reward is no longer eligible, confirmation is refused and the order stays unchanged; review the program before retrying. Cancellation reverses the points ledger in the same save. Confirming again after resetting to draft creates a new posting cycle and delivery; retrying the same command does not earn twice.

## Deliveries and invoices

The page reads top to bottom: **Order information**, **Products**, then **Deliveries** and **Invoices** once the order has any. A confirmed sales order offers **Create Invoice** on the **Invoices** card: choose the journal, the revenue and receivable accounts, a tax account if any and the invoice date, then press **Create Invoice**. Created invoices are listed on that card. Invoicing belongs to accountants (and the owner); sellers read the order without this button. There is no separate credit note: accounting cancels a draft invoice or reverses a posted one, and its quantity returns to **To invoice** on the order.

## Change history

The last card lists every action that changed the order, newest first, up to 30 rows:
- **Time** in the company's time zone, **By**, **Action** and **Details**.
- Actions include create, save, send, confirm, cancel, lock, line edits, discounts, salesperson or tag changes, invoicing, and collecting or setting off deposits.
- **Details** names the related document: the invoice, the deposit receipt, or the quotation a copy came from. Click it to open the document if you may read it.
- A refused command, a retry, or a command that changes nothing adds no row.
- Actions the system runs show as **System**.

The history is append-only: nobody edits or deletes it. Anyone who can read the order reads its history. Changes that come from another document (completing a delivery, cancelling or reversing an invoice) are not listed here; see them on that document. Orders created before the history existed show only the actions taken since.

## Printing and conversation

**Print** only offers the documents that suit the order's current state. The right-hand column (below the order on a narrow screen) keeps the order's conversation and activity.`,
  },
} as const
