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
Mỗi terminal một lệnh:
```bash
npx ts-node src/node/index.ts --port 3000 --id node1 --peers 3001,3002
npx ts-node src/node/index.ts --port 3001 --id node2 --peers 3000,3002
npx ts-node src/node/index.ts --port 3002 --id node3 --peers 3000,3001
```

## CLI (TCP client)
- Dùng ts-node (kết nối mặc định 127.0.0.1:3000; đổi bằng KV_HOST/KV_PORT):
```bash
KV_HOST=127.0.0.1 KV_PORT=3000 npx ts-node src/client/cli.ts
```
- Sau khi build:
```bash
KV_HOST=127.0.0.1 KV_PORT=3000 node dist/client/cli.js
```

### Lệnh trong CLI
```text
PUT key1 value1
GET key1
DELETE key1
```

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

