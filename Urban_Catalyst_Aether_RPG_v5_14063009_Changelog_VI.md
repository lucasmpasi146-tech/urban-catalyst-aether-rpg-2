# Urban Catalyst — Aether RPG v5.1 / Mã 14063009

## Mã quà tặng đặc quyền
- Thêm mã `14063009`, chỉ đổi một lần trong mỗi save.
- Khi túi trang bị đầy và chưa có vũ khí ULR, giao diện báo rõ và không đánh dấu mã đã sử dụng.
- Mã mở khóa class ẩn độc quyền `Chí Tôn Nguyên Sơ`, nhận vũ khí ULR `Thần Khí Khai Thiên`, tự trang bị vũ khí, và hồi đầy HP/MP.
- AP bù khi đổi mã: `20 × cấp độ hiện tại + 50 AP`.
- Class nhận `+20 AP` mỗi lần lên cấp.
- Nội tại class đồng bộ STR, AGI, INT, VIT, SPR và LUK theo chỉ số hiệu dụng cao nhất.

## Nội tại vũ khí ULR
- Khi vũ khí ULR đang trang bị, mỗi 1 AP phân bổ tăng `+2` vào chỉ số được chọn; nếu class Chí Tôn đang hoạt động, nội tại đồng bộ khiến các chỉ số cốt lõi/LUK cùng phản ánh chỉ số cao nhất.
- Không yêu cầu cấp độ để trang bị.
- Có thể cường hóa đến `+30`; xác suất thành công có ảnh hưởng từ LUK.
- Có thể dung luyện trang bị khác (không phải đồ đang mặc) để cộng thêm chỉ số vào ULR. Trang bị bị dung luyện sẽ bị tiêu hao.
- Vũ khí ULR không rơi ngẫu nhiên, không mua trong Chợ Đen và không thể bán nhầm.

## Tương thích và kiểm tra
- Bản này được tạo từ giao diện hiện có và giữ nguyên đường dẫn API đang dùng với Render.
- JavaScript đã qua `node --check`; kiểm tra tĩnh cũng rà ID giao diện trùng/thiếu, handler không có hàm tương ứng và 9 bộ kỹ năng có đủ 6 ô.
- Chưa kiểm thử tương tác đầy đủ trong trình duyệt live. Sau khi deploy cần thử đăng nhập, đổi mã, tải lại trang, phân bổ AP khi trang bị ULR, đổi class, cường hóa và dung luyện.

## Triển khai khuyến nghị
Chỉ thay `public/index.html` trong repository hiện tại rồi commit và redeploy Render. Không cần thay backend hay tạo lại cơ sở dữ liệu cho thay đổi giao diện này.
