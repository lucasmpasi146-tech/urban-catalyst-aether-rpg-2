# Urban Catalyst — Aether RPG: triển khai mới trên Render

Bộ này là phiên bản khởi đầu độc lập, không phụ thuộc project Replit. Nó giữ giao diện Idle AFK RPG hiện có và dùng Express + PostgreSQL để đăng ký/đăng nhập, quản lý phiên và lưu game.

## Cấu trúc

- `server.js`: Express API, session cookie và lưu game.
- `public/index.html`: giao diện game hiện tại.
- `schema.sql`: schema tài khoản và save; server cũng tự tạo các bảng cần thiết khi khởi động.
- `render.yaml`: Blueprint tạo web service và PostgreSQL cho Render.
- `package.json`: lệnh chạy và dependencies.

## Cách triển khai

1. Đưa nội dung thư mục này vào một repository GitHub **Private**. Render cần một nguồn mã có thể kết nối; thông thường Blueprint được triển khai từ repository Git.
2. Trong Render, chọn New → Blueprint, kết nối repository và chọn `render.yaml`.
3. Blueprint đặt web service ở region Singapore, `NODE_ENV=production`, `SESSION_SECRET` tự sinh, `SINGLE_PLAYER_MODE=true`, health-check `/api/health` và kết nối `DATABASE_URL` với PostgreSQL được định nghĩa trong Blueprint.
4. Khi được hỏi, tự đặt `REGISTRATION_CODE` dài và khó đoán trong Environment/Secrets. Không gửi mã này cho ai và không ghi vào Git.
5. Kiểm tra log deploy, sau đó mở `https://<service-url>/api/health`. Kết quả mong đợi có `ok: true` và `database: "connected"`.
6. Mở URL gốc, tạo tài khoản chủ một lần bằng mã đăng ký, rồi tạo nhân vật. Vì `SINGLE_PLAYER_MODE=true`, server sẽ từ chối đăng ký tài khoản thứ hai.

## Lưu ý quan trọng về gói miễn phí và dữ liệu

Blueprint đặt cả web service và PostgreSQL ở plan `free` để tránh tạo tài nguyên trả phí ngoài ý muốn. Điều kiện, thời hạn, giới hạn và khả năng giữ dữ liệu của gói miễn phí có thể thay đổi; đọc kỹ bảng thông tin trong Render trước khi xác nhận. Nếu database miễn phí có thời hạn hoặc không bảo đảm lưu trữ lâu dài, **không dùng nó làm nơi giữ save duy nhất lâu dài**. Nâng cấp sang database persistent hoặc sao lưu dữ liệu ra ngoài trước ngày hết hạn. Không chấp nhận bất kỳ nâng cấp tính phí nào nếu chưa xem rõ giá.

Free web service có thể ngủ khi không hoạt động; lần truy cập đầu có thể mất thời gian khởi động. Không giả định quá trình chiến đấu server-side tiếp tục chạy trong lúc dịch vụ ngủ: bản hiện tại là server lưu tài khoản/save, còn combat và tính thưởng vẫn chủ yếu ở trình duyệt.

## Biến môi trường

`render.yaml` tự cấu hình `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `SINGLE_PLAYER_MODE` và `PGPOOL_MAX`. Bạn cần nhập `REGISTRATION_CODE` bằng một giá trị bí mật riêng trong Render. Không dùng mã ví dụ trong `.env.example` ở môi trường public.

## Kiểm tra sau deploy

- `GET /api/health`: HTTP 200 và database connected.
- `GET /api/auth/me`: khi chưa đăng nhập thường trả `{"authenticated":false}`.
- Đăng ký tài khoản chủ: chỉ làm **một lần**, dùng `REGISTRATION_CODE`.
- Tạo nhân vật, chơi thử, dùng chức năng lưu, đăng xuất/đăng nhập lại và xác nhận save được tải từ server.

## Giới hạn bảo mật/gameplay

Giao diện hiện tại vẫn tính combat/EXP/loot/AP ở trình duyệt rồi gửi save lên server. Backend kiểm tra một số trường dữ liệu nhưng không thể chống gian lận hoàn toàn với mọi trường trong save. Đây là bản chơi riêng/test. Muốn authoritative chống sửa client, cần chuyển tính combat và phát thưởng sang backend.

## Backup

Trước khi nâng cấp, xóa hoặc thay database, luôn xuất backup PostgreSQL. Tải ZIP mã nguồn không sao lưu dữ liệu database.
