# Tạp Hóa POS – bản FIX đa máy + barcode

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
