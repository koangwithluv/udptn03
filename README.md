# Hệ thống Key-Value phân tán

## Tổng quan
Kho khóa-giá trị phân tán chạy nhiều node, giao tiếp TCP (JSON + ký tự xuống dòng). Mỗi key có primary/secondary (2 bản) dựa trên băm; node không phải primary sẽ forward yêu cầu đến primary. Heartbeat định kỳ để phát hiện node hỏng; snapshot stub để đồng bộ khi node khởi động lại.

## Tính năng chính
- PUT/GET/DELETE qua TCP JSON.
- Replication 2 bản (primary + secondary) đồng bộ đơn giản.
- Forwarding: node nhận sai phân vùng sẽ chuyển tiếp tới primary.
- Heartbeat phát hiện peer down; snapshot trả toàn bộ store.
- CLI TCP gửi trực tiếp tới một node.

## Cài đặt
```bash
git clone <repository-url>
cd distributed-kv-store
npm install
```

## Chạy nhiều node (ví dụ 3 node)
Mỗi terminal một lệnh (giữ cửa sổ mở):
```bash
npx ts-node src/node/index.ts --port=3000 --id=node1 --peers="3001,3002"
npx ts-node src/node/index.ts --port=3001 --id=node2 --peers="3000,3002"
npx ts-node src/node/index.ts --port=3002 --id=node3 --peers="3000,3001"
```
Nếu cần đổi cổng, cập nhật cả `--peers` tương ứng.

## CLI (TCP client)
- Dùng ts-node. Hỗ trợ failover nhiều cổng qua biến môi trường `KV_PORTS` (danh sách cổng, phân tách bằng dấu phẩy). Ví dụ kết nối 3 node:
```bash
KV_HOST=127.0.0.1 KV_PORTS=3000,3001,3002 npx ts-node src/client/cli.ts
```
- Nếu chỉ một cổng: dùng `KV_PORT=3000` (hoặc đặt một giá trị duy nhất trong `KV_PORTS`).
- Sau khi build:
```bash
KV_HOST=127.0.0.1 KV_PORTS=3000,3001,3002 node dist/client/cli.js
```

### Lệnh trong CLI
```text
PUT key1 value1
GET key1
DELETE key1
```

### Quy trình test nhanh (chịu lỗi và forward)
1) Chạy 3 node (3 terminal, giữ mở):
```bash
npx ts-node src/node/index.ts --port=3000 --id=node1 --peers="3001,3002"
npx ts-node src/node/index.ts --port=3001 --id=node2 --peers="3000,3002"
npx ts-node src/node/index.ts --port=3002 --id=node3 --peers="3000,3001"
```
2) Mở CLI với failover:
```bash
KV_HOST=127.0.0.1 KV_PORTS=3000,3001,3002 npx ts-node src/client/cli.ts
```
3) Ghi và đọc thử:
```
PUT k1 v1
GET k1          # kỳ vọng v1
```
4) Tắt node1 (Ctrl+C ở terminal node1), giữ node2/3. CLI vẫn hoạt động nhờ thử cổng còn sống:
```
GET k1          # kỳ vọng vẫn v1
PUT k2 v2       # ghi thêm khi thiếu 1 node
```
5) Khởi động lại node1:
```bash
npx ts-node src/node/index.ts --port=3000 --id=node1 --peers="3001,3002"
```
6) Kiểm tra lại dữ liệu:
```
GET k1
GET k2
```
Nếu dùng Windows PowerShell, thay `KV_HOST=... KV_PORTS=...` bằng `$env:KV_HOST="127.0.0.1"; $env:KV_PORTS="3000,3001,3002";` rồi chạy lệnh.

## Giao thức tóm tắt
- Client → Node: `{type:"PUT"|"GET"|"DELETE", key, value?}`
- Node → Client: `{type:"RESPONSE", success, data?, error?}`
- Replication: `{type:"REPL_PUT"|"REPL_DEL", key, value?}` giữa các node.
- Heartbeat: `{type:"HEARTBEAT", nodeId}`; Snapshot: `{type:"SNAPSHOT_REQUEST"}` / `{type:"SNAPSHOT_CHUNK", data:{...}}`.

## Kiểm thử
```bash
npm test
```

## Tài liệu
Chi tiết kiến trúc, giao thức, sao lưu, xử lý lỗi: xem `docs/report.md`.

## Đóng góp
Hoan nghênh pull request và issue cho cải tiến/lỗi.

