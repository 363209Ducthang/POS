# Tạp Hóa POS – bản FIX đa máy + barcode

## V5.6.0 – Màn hình thanh toán và giao diện mới
- Chọn **Chuyển khoản** sẽ cập nhật QR và tự mở/focus cửa sổ màn hình khách; cửa sổ nhận QR ngay cả khi được mở lần đầu.
- Làm mới giao diện quầy, trang đăng nhập và màn hình khách theo một phong cách thống nhất; thanh điều hướng trên điện thoại có thể cuộn ngang để mở mọi mục.
- Màn hình khách báo rõ khi cửa hàng chưa cài tài khoản nhận chuyển khoản.

## V5.5.2 – Sửa in tem, đơn nháp và Excel tiếng Việt
- Chọn đúng chuẩn EAN-13/EAN-8/UPC cho mã có chữ số kiểm tra hợp lệ; mã khác dùng Code 128 để vẫn có thể in và quét.
- Thu ngân có thể mở nhiều đơn nháp, chuyển qua lại, xóa từng đơn hoặc xóa mặt hàng; số lượng trong các đơn nháp được tính chung khi kiểm tra tồn kho.
- Tệp mẫu, tệp nhập/xuất hàng hóa, đơn hàng và chi phí dùng tiêu đề tiếng Việt. Khi nhập vẫn nhận được tệp cũ dùng tên cột tiếng Anh.

Bản này sửa lỗi cấu trúc của gói được gửi: `app.html` trước đây gọi `assets/app.js` và `index.html` gọi `assets/login.js` nhưng hai file JS không có trong gói. Bản FIX bổ sung đầy đủ JS chạy thực tế, chuyển sang Firebase modular SDK và thêm luồng quét barcode.

## Chức năng chính
- Thu ngân: quét barcode USB/Bluetooth kiểu HID/Keyboard + Enter, quét liên tục, mã không tồn tại sẽ mở form tạo sản phẩm.
- Nhập kho: quét barcode để chọn sản phẩm, tự chọn đơn vị/hệ số và cộng tồn theo đơn vị cơ sở.
- Sản phẩm: barcode duy nhất, tối đa 3 đơn vị, hệ số quy đổi, giá vốn, giá bán, tồn và mức cảnh báo.
- Thanh toán: tiền mặt/chuyển khoản; tồn kho được trừ bằng Firestore transaction.
- Đa máy: sản phẩm/đơn hàng/tồn kho dùng Firestore `onSnapshot`; mỗi máy có `machineId` riêng; giỏ hàng không dùng chung.
- Chống bán vượt tồn khi hai máy thao tác đồng thời: giao dịch đọc lại tồn kho và từ chối giao dịch thứ hai nếu không đủ.
- Màn hình khách hàng, in hóa đơn, khách hàng, nhà cung cấp, chi phí và dashboard.

## Máy quét
Dùng máy quét USB hoặc Bluetooth ở chế độ HID/Keyboard. Máy quét phải gửi mã + Enter. POS giữ focus ở ô barcode sau mỗi lần quét.

## Nhiều máy
1. Tất cả máy mở cùng Firebase project.
2. Bật Email/Password trong Firebase Authentication.
3. Nếu dùng Google/Facebook thì bật provider tương ứng.
4. Cài Firestore Rules từ `firestore.rules`.
5. Mỗi máy đăng nhập tài khoản riêng. Dữ liệu sản phẩm/kho/đơn hàng đồng bộ realtime.

## Lưu ý bảo mật
`firestore.rules` trong gói FIX cho phép người dùng đã đăng nhập đọc/ghi dữ liệu để ưu tiên chạy được ngay. Khi triển khai cửa hàng thật nên siết Rules theo `users/{uid}.role` (admin/manager/staff), đặc biệt quyền xóa sản phẩm và sửa giá.

## Chạy
Mở `index.html` qua web server (khuyến nghị VS Code Live Server hoặc hosting HTTPS), không nên mở trực tiếp bằng `file://` nếu trình duyệt chặn module/network. Cần Internet để tải Firebase, QR, Excel và barcode library.

## FIX đăng nhập V5.1
- Trang đăng nhập dùng Firebase Compat để tránh lỗi module/CORS khi mở bằng trình duyệt.
- Có nút `Tài khoản demo: admin / 123456`; hệ thống dùng email nội bộ `admin@pos-sale-7b97d.firebaseapp.com` và tự tạo Firebase user nếu chưa có.
- Nếu Firebase báo `auth/api-key-not-valid` thì API key trong Web App config đã hết hiệu lực/bị giới hạn; mã nguồn không thể tự tạo một API key mới. Hãy lấy Web API Key mới tại Firebase Console → Project settings → Your apps → Web app và thay `apiKey` trong `assets/login.js`.
- Nếu báo `operation-not-allowed`, bật Email/Password trong Authentication → Sign-in method.
- Nếu báo `unauthorized-domain`, thêm domain đang chạy POS vào Authentication → Settings → Authorized domains.


## V5.2 Firebase Login Fix
- Đã cập nhật đúng Web App config do chủ cửa hàng cung cấp.
- API key: `AIzaSyCQqF...JJOR...` (không dùng key cũ có `...M6JOR...`).
- appId: `1:956872121564:web:adae0ace428374cc652819`.
- Trang đăng nhập dùng Firebase Compat SDK 10.7.1 để tương thích trực tiếp với index.html.
- Tài khoản demo được tạo bằng Firebase Authentication khi chưa tồn tại.


## V5.5 – QR đẹp hơn, ghi nợ, đồng bộ liên tục
- **Màn hình khách**: bố cục 2 cột khi chuyển khoản (giỏ hàng + thẻ QR lớn có khung quét, số tiền, tài khoản, nội dung CK), màn hình "Thanh toán thành công" / "Đã ghi nợ", báo trạng thái kết nối với quầy.
- **Ghi nợ**: nút `📒 Ghi nợ` cạnh Tiền mặt / Chuyển khoản. Bắt buộc chọn khách (không dùng Khách lẻ), có ô "Khách trả trước". Công nợ lưu ở `customers/{id}.debt`, đơn lưu `debtAmount` / `debtPaid`, phiếu thu lưu ở collection `debtPayments`. Thu nợ tại Khách hàng → chọn khách → **Thu nợ** (trừ dần vào các đơn nợ cũ nhất).
- **Đồng bộ**: nhà cung cấp, chi phí, cài đặt chuyển sang `onSnapshot`; chip trạng thái đồng bộ ở thanh trên; giá/tên sản phẩm trong giỏ tự cập nhật khi máy khác sửa; màn hình khách nhận dữ liệu qua BroadcastChannel + localStorage + postMessage và được quầy gửi lại mỗi 4 giây.
- Đơn **Chờ chuyển khoản** có nút "✓ Đã nhận tiền" ở trang Đơn hàng. Doanh thu tính các đơn `paid`, `completed`, `debt` (bán chịu tính vào doanh thu, công nợ hiển thị riêng ở Báo cáo).
- `firestore.rules` không cần đổi (collection `debtPayments` nằm trong `users/{uid}/{collection}`).

## V5.5.1 – In tem barcode
- Form thêm/sửa sản phẩm có hàng **Số tem in / Khổ tem / Nội dung tem / 🖨 In tem**: in được ngay cả khi chưa lưu sản phẩm (dùng đúng barcode, tên, giá đang nhập). Khổ tem: 50×30 mm, 40×25 mm (cuộn tem nhiệt) hoặc giấy A4 3 cột. Tối đa 500 tem mỗi lần.
- Trang Hàng hóa có nút 🖨 từng dòng để in nhanh theo số lượng nhập. Khổ tem và nội dung tem được nhớ cho lần sau.
- Khi in, chọn đúng khổ giấy trong hộp thoại in của trình duyệt và tắt "Headers and footers".
