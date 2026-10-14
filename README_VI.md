# Urban Catalyst — Aether RPG: máy chủ lưu game trực tuyến

Gói này chuyển đăng ký/đăng nhập và lưu tiến trình khỏi `localStorage` sang một máy chủ Node.js + PostgreSQL. Giao diện HTML/CSS/JavaScript của game được giữ lại trong `public/index.html`.

## Quan trọng: gói này làm được gì?

- Tạo tài khoản phía máy chủ; mật khẩu được băm bằng bcrypt.
- Giữ phiên đăng nhập bằng cookie `HttpOnly`, `SameSite=Lax`.
- Lưu mỗi nhân vật vào PostgreSQL và tải lại tiến trình khi đăng nhập từ trình duyệt khác.
- Lưu tự động theo đợt khi đang auto đánh quái; có nút lưu thủ công và thao tác xóa save trên máy chủ khi reset.
- Có mã đăng ký riêng và chế độ một tài khoản bật mặc định; sau khi tạo tài khoản chủ, không thể đăng ký thêm tài khoản trên cùng server.
- Có endpoint `/api/health` để kiểm tra máy chủ và kết nối database.

**Giới hạn của bản thử nghiệm:** giao diện hiện tại vẫn tính chiến đấu, EXP, rơi đồ và AP trong trình duyệt rồi gửi trạng thái để lưu. Vì thế đây là máy chủ đăng nhập + lưu game trực tuyến cho bạn thử nghiệm một mình, chưa phải hệ thống game authoritative chống gian lận. Muốn chống sửa save tuyệt đối thì cần chuyển thêm các phép tính chiến đấu, phần thưởng, rơi giấy ẩn và bù AP sang backend.

## Cách triển khai trên hosting

1. Tạo ứng dụng Node.js từ toàn bộ thư mục này (hoặc tải file ZIP và nhập vào nền tảng hosting hỗ trợ Node.js).
2. Tạo một PostgreSQL database trong cùng dự án hoặc dịch vụ database của nhà cung cấp.
3. Đặt các biến môi trường:
   - `NODE_ENV=production`
   - `PORT` do nền tảng cấp (thường tự cấp)
   - `DATABASE_URL` là connection string PostgreSQL riêng tư của database
   - `SESSION_SECRET` là chuỗi ngẫu nhiên dài, tối thiểu 32 ký tự
   - `REGISTRATION_CODE` là một mã bí mật riêng do bạn tự đặt (khuyến nghị 32 ký tự trở lên)
   - `SINGLE_PLAYER_MODE=true` để khóa server ở chế độ một tài khoản (mặc định; chỉ tắt nếu sau này muốn mở cho nhiều người chơi)
4. Build command: `npm install`
5. Start command: `npm start`
6. Deploy/publish app. Mở URL HTTPS được cấp, nhập `REGISTRATION_CODE` khi tạo tài khoản lần đầu. Sau đó bạn đăng nhập bằng username/password thông thường; không cần nhập mã đăng ký nữa.
7. Mở `/api/health` trên URL vừa deploy. Kết quả đúng có dạng `{"ok":true,"database":"connected",...}`.

**Không gửi `DATABASE_URL`, `SESSION_SECRET`, `REGISTRATION_CODE` hoặc mật khẩu tài khoản cho người khác.** Không đặt chúng vào file HTML/JavaScript, GitHub công khai hay biến môi trường phía trình duyệt.

## Chạy thử trên máy tính bằng Docker

1. Cài Docker Desktop.
2. Tạo `.env` từ `.env.example` nếu muốn tùy chỉnh mã đăng ký và session secret. Đừng dùng giá trị mẫu khi public trên Internet.
3. Mở terminal trong thư mục này rồi chạy:

   ```bash
   docker compose up --build
   ```

4. Mở `http://localhost:3000`.

Docker Compose lưu dữ liệu PostgreSQL trong volume `aether_db`. Không chạy `docker compose down -v` trừ khi bạn muốn xóa vĩnh viễn database local.

## API

- `POST /api/auth/register` — đăng ký (yêu cầu mã đăng ký riêng).
- `POST /api/auth/login` — đăng nhập.
- `POST /api/auth/logout` — đăng xuất.
- `GET /api/auth/me` — kiểm tra phiên.
- `GET /api/game/save` — tải save của tài khoản hiện tại.
- `PUT /api/game/save` — cập nhật save của tài khoản hiện tại.
- `DELETE /api/game/save` — xóa save của tài khoản hiện tại.
- `GET /api/health` — kiểm tra server/database.

## Sao lưu

Hãy bật backup ở nền tảng PostgreSQL hoặc xuất backup định kỳ. Một URL online không thay thế cho sao lưu; nếu xóa database hoặc xóa dịch vụ database, save có thể mất.
