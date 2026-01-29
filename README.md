# Hệ thống Key-Value phân tán

## Tổng quan
Dự án hiện thực một kho khóa-giá trị phân tán chạy trên nhiều node. Mỗi node giữ một phần dữ liệu, xử lý PUT/GET/DELETE và phối hợp để duy trì tính nhất quán, sẵn sàng và chịu lỗi.

## Tính năng chính
- **PUT/GET/DELETE**: Thao tác khóa-giá trị cơ bản.
- **Sao lưu đơn giản**: Mỗi cặp khóa-giá trị có ít nhất hai bản sao (triển khai tối giản, có thể mở rộng).
- **Quản lý thành viên**: Thêm/xóa node trong cụm.
- **Khôi phục**: Phục hồi dữ liệu từ replica khi node lỗi (mô phỏng tối giản).
- **CLI**: Giao diện dòng lệnh tương tác.

## Kiến trúc tóm tắt
- Nhiều node giao tiếp qua TCP (transport tối giản). 
- Mỗi node có Storage (Map in-memory), Replication stub, Membership, Recovery. 
- Client kết nối tới một node bất kỳ; node có thể định tuyến/replicate đơn giản.

## Cài đặt
1. Clone mã nguồn:
    ```
    git clone <repository-url>
    ```
2. Di chuyển vào thư mục dự án:
    ```
    cd distributed-kv-store
    ```
3. Cài phụ thuộc:
    ```
    npm install
    ```

## Chạy
- Khởi động node (dùng ts-node):
   ```
   npm run start
   ```
- Hoặc build rồi chạy (nếu đã cấu hình outDir dist):
   ```
   npm run build
   node dist/node/index.js
   ```

## CLI (dòng lệnh)
- Chạy trực tiếp bằng ts-node:
   ```
   npx ts-node src/client/cli.ts
   ```
- Nếu đã build:
   ```
   node dist/client/cli.js
   ```

### Ví dụ lệnh trong CLI
- Lưu giá trị:
   ```
   PUT key1 value1
   ```
- Đọc giá trị:
   ```
   GET key1
   ```
- Xóa giá trị:
   ```
   DELETE key1
   ```

## Kiểm thử
``` 
npm test
```

## Tài liệu
Xem chi tiết kiến trúc, giao thức, sao lưu, xử lý lỗi và giới hạn trong `docs/report.md`.

## Đóng góp
Hoan nghênh pull request và issue cho cải tiến/lỗi.

## Giấy phép
Dự án theo giấy phép MIT.