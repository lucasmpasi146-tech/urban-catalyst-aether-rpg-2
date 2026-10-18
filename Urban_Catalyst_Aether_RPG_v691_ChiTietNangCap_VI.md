# Urban Catalyst — Aether RPG v6.9.1 · Trang bị, cường hóa rủi ro & Lò Rèn

## 1. Đã cập nhật vào game

### Cường hóa có rủi ro
- **F → LR tối đa +30; ULR chỉ chủ game `lucasmpasi146` tối đa +50.** Không thay đổi giới hạn hay cấp rèn hiện tại của đồ cũ.
- Khi cường hóa thành công: **+1 cấp**.
- Khi cường hóa thất bại: mất vật liệu và tiền cường hóa; có thể **giữ nguyên, tụt 1 hoặc tụt 2 cấp** theo mốc cường hóa; **không làm mất trang bị**.
- Trang bị dưới +5 không tụt cấp (vẫn mất chi phí nếu thất bại).
- Toàn bộ kết quả được xử lý qua **`POST /api/gear/enhance` trên máy chủ, trong giao dịch PostgreSQL**, có ghi lại cấp trước/sau và cấp bị mất trong nhật ký kinh tế.
- Trên mỗi món đồ ở tab Trang bị hiển thị rõ ba xác suất *nếu cường hóa đã thất bại*.

| Cấp cường hóa đang có | Giữ nguyên nếu thất bại | Tụt 1 cấp nếu thất bại | Tụt 2 cấp nếu thất bại |
|---|---:|---:|---:|
| +0 đến +4 | 100% | 0% | 0% |
| +5 đến +9 | 86% | 12% | 2% |
| +10 đến +19 | 70% | 22% | 8% |
| +20 đến +29 | 53% | 32% | 15% |
| +30 đến +39 (chỉ ULR tiếp tục rèn) | 40% | 38% | 22% |
| +40 đến +49 (chỉ ULR) | 30% | 42% | 28% |

**Lưu ý:** đây là xác suất *có điều kiện sau khi đã thất bại*, không phải xác suất trên mọi lượt thử. Khả năng thành công được tính riêng dựa trên cấp cường hóa, LUK và nội tại cường hóa (tối thiểu 8%, tối đa 96%).

### Ấn Hộ Mệnh (đề xuất đã triển khai)
- Từ cấp +5, người chơi có nút **🛡 BẢO HỘ** cạnh nút cường hóa thông thường.
- Tốn **Ma Thạch và Void Shard** bổ sung (ngoài Lõi Aether và tiền) cho từng lần thử, kể cả khi rèn thành công.
- Khi thử có Bảo Hộ mà thất bại, **không mất cấp rèn**; cũng không được hoàn lại tiền hay vật liệu.
- Chi phí Ma Thạch tính theo `ceil((8 + 2×cấp rèn) × hệ số bậc trang bị)`; Shard = `3 + 3×floor(cấp rèn/5)`. Ví dụ F +20 bảo hộ tốn thêm 48 Ma Thạch +15 Shard; LR +20 tốn 137 Ma Thạch +15 Shard.
- Máy chủ xác thực số dư, trừ chi phí, quay kết quả và lưu đồ dưới cùng một giao dịch, không tin kết quả do trình duyệt tự gửi.

### Hệ trang bị của v6.9 tiếp tục được giữ nguyên
- **Chỉ số gốc tăng theo rank/phẩm chất**, ấn phụ ngẫu nhiên phù hợp vũ khí/giáp/phụ kiện và phẩm chất.
- **Thường: 0, Tốt: 1, Hiếm: 2, Sử thi: 3, Huyền thoại: 4 ấn phụ.** Có thể tái đúc bằng nguyên liệu.
- **Bộ trang bị** gồm Thiên Tinh, Thâm Uyên, Thủ Hộ, Liệp Ảnh, Aether; 2 món cùng dòng tăng 4% hiệu lực chỉ số trang bị, 3 món tăng 9%.
- **Thần Khí Khai Thiên ULR** cho `lucasmpasi146`: 7 ấn đặc quyền, 4 nội tại, nội tại 1 AP = +2 chỉ số, giới hạn +50; không thể bán ở Chợ.
- **Lò Rèn Aether** với 24 bản vẽ, ba công thức Sơ luyện/Tinh luyện/Huyền tạo; sử dụng Ma Thạch, Lõi Aether, Bí Cấp, Void Shard và tiền; trang bị tạo ra có UID riêng và có thể giao dịch nếu không đang trang bị.

## 2. Đề xuất tăng độ đa dạng (chưa triển khai)

1. **Khảm ngọc cho trang bị:** mở tối đa 3 ô theo mốc cường hóa; ngọc chí mạng/hút máu/sức chống chịu khác nhau để build nhân vật không đồng nhất.
2. **Phân rã trang bị và hoàn trả nguyên liệu:** đồ cấp thấp hoặc ấn phụ xấu trở thành tài nguyên quay vòng, nhưng phải giới hạn phần hoàn để không tạo vòng lặp lời vô hạn.
3. **Bản vẽ riêng của boss/khu vực:** nguyên liệu độc quyền của boss dùng tạo đồ có tên riêng và hiệu ứng mang tính chủ đề; cần xác nhận loot server-side trước khi mở công khai.
4. **Chế tạo theo đơn đặt hàng:** người chơi giao vật liệu ký gửi, trả công cho thợ rèn, hoàn tất qua transaction PostgreSQL để tránh lừa đảo.
5. **Hệ định hướng thuộc tính khi tái đúc:** khóa tối đa một ấn phụ với chi phí tăng mạnh, giữ chế tạo có chiều sâu nhưng tránh spam ấn hoàn hảo quá dễ.

## 3. Giới hạn cần biết

- Không có SQL di trú mới cho bản v6.9.1; nhưng **vẫn cần sao lưu PostgreSQL trước deploy**.
- Không bảo đảm nền kinh tế chống gian lận tuyệt đối: loot/EXP và một phần tiến trình PvE hiện còn được tính tại client.
- Chưa kiểm chứng hai tài khoản và cơ sở dữ liệu PostgreSQL thật trong môi trường staging/Render. Chỉ có unit test, kiểm tra cú pháp và cấu trúc dự án tại môi trường cục bộ.
