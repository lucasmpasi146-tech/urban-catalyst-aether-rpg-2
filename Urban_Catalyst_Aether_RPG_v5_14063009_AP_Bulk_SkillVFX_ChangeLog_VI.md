# Urban Catalyst Aether RPG v5.2 — Hiệu ứng kỹ năng

- Giữ nguyên hệ thống nâng nhiều AP từ bản trước: nhập số lượng, nút 1/10/100/MAX và phân bổ theo STR/AGI/INT/VIT/SPR.
- Thêm hiệu ứng đồ họa khi thi triển kỹ năng: vòng phép, chém, tia năng lượng, bùng nổ, sóng lan, khiên và bóng tối.
- Mỗi kỹ năng có màu, biểu tượng, nhịp/kiểu hiệu ứng được xác định từ ID kỹ năng; màu sắc/kiểu hiển thị đa dạng giữa các class và kỹ năng.
- Hiệu ứng gắn vào thao tác castSkill nên chạy khi dùng tay hoặc Auto kỹ năng, không thay đổi sát thương, hồi chiêu, tiêu hao MP hay logic AP.
- Tôn trọng `prefers-reduced-motion`; giới hạn hiệu ứng lên đến 3 mục tiêu để giảm tải khi encounter nhiều quái.

## Cập nhật
Thay file `public/index.html` trên GitHub bằng file HTML mới, commit rồi deploy latest commit trên Render. Không cần thay backend.
