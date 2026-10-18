# Urban Catalyst — Aether RPG v6.6

## Thay đổi đã triển khai

1. **Giấy Chuyển Class Thường có thể giao dịch trong Chợ Người Chơi.** Loại resource mới là `classTransferTickets`; khi đăng bán sẽ bị trừ khỏi túi, khi mua/hủy sẽ nhận lại qua sự kiện và giao dịch PostgreSQL. Giới hạn 9.999 giấy mỗi tin; tối đa 20 tin hoạt động mỗi tài khoản.
2. **ULR chỉ dành cho Admin đăng nhập tên `lucasmpasi146`.** Server không cho tài khoản khác lưu class `sovereign`, quyền Chí Tôn hay bất cứ món đồ hạng ULR. Vũ khí ULR không thể đăng bán/mua qua chợ. Điều kiện ở frontend cũng kiểm tra tên đăng nhập và quyền admin; `ADMIN_USERNAME` phải đặt bằng `lucasmpasi146` trên Render. Khi di trú, save người chơi khác có ULR sẽ bị bỏ trang bị ULR và class `sovereign` bị đưa về `music` (phải sao lưu trước).
3. **Ẩn danh sách mã quà tặng mẫu trong giao diện.** Ô nhập không còn ví dụ; nội bộ frontend vẫn chứa danh sách mã quà tặng, nên đây chưa phải hệ thống giftcode bí mật phía máy chủ.
4. **Bốn mệnh giá tiền:** một ví lưu bằng Đồng tệ và tự hiển thị thành Đồng/Ngân/Kim/Bạch kim. Tỉ lệ: 100 Đồng = 1 Ngân; 100 Ngân = 1 Kim; 100 Kim = 1 Bạch kim.
5. **Di trú tiền cũ 1 lần:** mỗi **1 Aether Coin → 1 Bạch kim tệ = 1.000.000 Đồng tệ**. Di trú cập nhật `game_saves.state.gold`, `marketplace_events.gold_delta`, `marketplace_listings.price`, đánh dấu phiên bản `currencyVersion=2` và ghi bảng `game_migrations`. Có advisory lock và transaction; không làm lại sau restart. Giá bán lại trang bị lưu cũ cũng được điều chỉnh tương đối sang mặt bằng giá mới. Nếu ví tiền cũ vượt ngưỡng an toàn, máy chủ cố ý dừng để không cắt bớt tiền âm thầm.
6. **Đánh quái rơi tiền mới:** quái thường ~73% rơi tiền (tăng tối đa 10 điểm % nhờ LUK), tinh anh ~94%, boss 100%; quái tinh anh nhận x3, boss x10 lượng tiền thường; có xác suất tiền bậc Kim/Bạch kim riêng với quái mạnh. Cả AFK đều theo quy tắc mới.
7. **Giá Chợ Đen đã đổi:** bình HP 75 Ngân, bình Mana 65 Ngân, 20 Void Shard giá 92 Ngân, giấy class thường 1 Kim 75 Ngân + 25 Ma Thạch; hàng trang bị đã có giá mới theo cấp; cường hóa và thưởng nhiệm vụ được điều chỉnh.
8. **Rương tăng giá so với khung giá mới:** Rương Thợ Săn 12 Kim; Rương Aether 24 Kim + 45 Void Shard + 12 Ma Thạch.
9. **Ảnh nhân vật theo class:** 9 WebP nhỏ trong `public/assets/classes/`, được dùng trực tiếp ở chân dung hồ sơ, biểu tượng chiến đấu, tab class và danh sách tạo nhân vật. Không phải ảnh chụp UI tĩnh; không thay đổi cảnh combat sang game 3D.

## Trước khi deploy: sao lưu bắt buộc

Bản v6.6 có một lần di trú dữ liệu tài chính và ULR. Hãy **sao lưu database PostgreSQL** (hoặc snapshot từ nhà cung cấp), ghi lại phiên bản commit GitHub đang chạy, thử trên Render staging và hai tài khoản thử. Nếu chuyển ngược về server.js v6.5 sau di trú mà không khôi phục DB backup sẽ gây sai lệch tiền vì giá và ledger đã đổi đơn vị.

## Deploy lên Render

1. Giải nén `Urban_Catalyst_Aether_RPG_v66_Render_Complete.zip`, upload *nội dung* vào gốc repo GitHub (không upload nguyên ZIP, không lồng thư mục cha). Cấu trúc phải có `server.js`, `package.json`, `verify-structure.js`, `schema.sql`, `public/index.html`, `public/assets/classes/*.webp`.
2. Render: **Root Directory để trống** nếu `server.js` nằm gốc repo; Build Command `npm install && npm run check:structure`; Start Command `npm start`.
3. Giữ nguyên `DATABASE_URL`, `SESSION_SECRET` và `REGISTRATION_CODE`. Đặt **`ADMIN_USERNAME=lucasmpasi146`** là username tài khoản chủ, không phải tên nhân vật. Đặt `SINGLE_PLAYER_MODE=false` nếu cần người chơi khác đăng ký/mua bán.
4. Commit / Push, Render → **Manual Deploy → Deploy latest commit**. Quan sát log thông báo chuyển tiền một lần hoặc cho biết đã chuyển. Nếu báo giới hạn ví lớn, dừng, không sửa hoặc xóa database để ép chạy.
5. Kiểm tra `/api/health` trả `version:"6.6.0"`; logout/login lại tài khoản `lucasmpasi146`, nhấn **🛡 Kiểm tra quyền** và xác nhận role admin. Kiểm tra ảnh class, tab Chợ, kiểm tra quy đổi tiền.
6. Thử với hai tài khoản test: (a) một tài khoản đăng bán 1 Giấy Chuyển Class Thường giá 1 Ngân; (b) tài khoản kia mua; (c) người bán nhận tiền, người mua nhận giấy; (d) F5 cả hai trang để chắc đồng bộ.

**Quan trọng:** chỉ thay `public/index.html` không đủ, vì thay đổi này cần backend và migration database; dùng ZIP hoàn chỉnh.

## Kiểm thử đã thực hiện

- `node --check` backend và JS frontend đều qua; `npm run check:structure` dùng kiểm tra cấu trúc dự án.
- Chromium (giao diện cục bộ): trang khởi tạo không có exception, tab Chợ & Admin tồn tại, URL ảnh theo class được gắn.
- Kiểm tra hàm tiền: `123456789 Đồng` hiển thị `123 Bạch kim · 45 Kim · 67 Ngân · 89 Đồng`.
- Thử chức năng cục bộ: bình HP trừ 7.500 Đồng, giấy thường có trong chọn món đăng bán, chọn đơn vị giá, giá rương đúng, tỉ lệ rơi quái thường nằm trong khoảng dự kiến.
- **Chưa** kết nối PostgreSQL/Render production để chạy migration thực tế, kiểm thử mua bán thật hoặc kiểm tra quyền admin online.
