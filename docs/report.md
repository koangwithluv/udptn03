# Báo cáo hệ thống Key-Value phân tán

## 1. Tổng quan
Hệ thống kho khóa-giá trị phân tán chạy trên nhiều node TCP. Mỗi key có 1 primary và 1 secondary (2 bản) được chọn bằng hàm băm vòng tròn dựa trên danh sách cổng node. Node nhận yêu cầu nhưng không phải primary sẽ forward đến primary, đảm bảo ghi/đọc đúng phân vùng. Các node gửi heartbeat định kỳ để phát hiện hỏng và có cơ chế snapshot đơn giản để khôi phục.

## 2. Kiến trúc
- **Thành phần node**: Storage (Map in-memory), Server TCP (forwarding, replicate), Replication (gửi REPL_PUT/REPL_DEL), Membership (danh sách peers), Heartbeat (gửi/nhận), Snapshot stub.
- **Triển khai tối thiểu 3 node**: mỗi node một tiến trình/port. Danh sách peers truyền qua CLI `--peers`.
- **Client**: CLI TCP gửi JSON line-based tới một node bất kỳ; node sẽ xử lý hoặc forward.

### 2.1 Giao thức truyền thông
- **Transport**: TCP, message kết thúc bằng ký tự xuống dòng `\n`.
- **Định dạng**: JSON. Thông điệp chính:
	- Client → Node: `{type:"PUT"|"GET"|"DELETE", key, value?}`.
	- Node → Client: `{type:"RESPONSE", success, data?, error?}`.
	- Replication giữa node: `{type:"REPL_PUT"|"REPL_DEL", key, value?}`.
	- Heartbeat: `{type:"HEARTBEAT", nodeId}`.
	- Snapshot: `{type:"SNAPSHOT_REQUEST"}` và `{type:"SNAPSHOT_CHUNK", data:{...}}`.

## 3. Sao lưu và nhất quán
- Mỗi key có 2 bản (primary, secondary). Hàm băm chọn primary, secondary là node tiếp theo trong vòng.
- Khi PUT/DELETE tại primary: ghi local, gửi REPL_PUT/REPL_DEL đến secondary, đợi ack rồi trả `success` cho client (write quorum 2/2 trong triển khai tối giản).
- GET: primary trả dữ liệu từ local store. (Có thể mở rộng đọc từ secondary khi primary down.)

## 4. Chịu lỗi và quản lý node
- **Heartbeat**: gửi định kỳ 2s; nếu quá 5s không thấy peer thì log là down. (Chưa tự động reconfig vòng băm, cần mở rộng nếu muốn loại peer.)
- **Tiếp tục phục vụ**: Khi một node down, replica còn lại vẫn giữ bản sao. Forwarding dựa trên vòng băm cố định; cần cập nhật danh sách peers thủ công hoặc tái khởi động với cấu hình mới để loại bỏ node hỏng.

### 4.1 Khôi phục dữ liệu
- Node khởi động lại có thể yêu cầu snapshot: gửi `SNAPSHOT_REQUEST` tới peer còn sống, nhận `SNAPSHOT_CHUNK` chứa toàn bộ Map và nạp vào store.
- (Hiện snapshot gửi toàn bộ một lần; có thể chia nhỏ chunk nếu dữ liệu lớn.)

## 5. Tình huống lỗi
- **Node tắt đột ngột**: heartbeat phát hiện, log peer down; secondary vẫn phục vụ dữ liệu của key được replicate. Forwarding vẫn cố gửi tới primary cũ nên cần cấu hình lại peers hoặc tái khởi động cụm để loại primary hỏng.
- **Node khởi động lại**: gửi snapshot request để đồng bộ lại dữ liệu, sau đó tham gia phục vụ.
- **Mất mạng tạm thời**: chưa có cơ chế anti split-brain; giả định một cụm liên lạc được.

## 6. Phân chia dữ liệu & mở rộng
- Phân vùng theo băm modulo số node trong danh sách peers + chính nó (vòng tròn). 
- Thêm node: cần khởi động lại các tiến trình với danh sách peers mới để vòng băm phản ánh node mới (chưa có rebalancing tự động, dữ liệu cũ không tự di chuyển; cần snapshot/replicate thủ công hoặc tái ghi).

## 7. Hạn chế & hướng cải tiến
- Chưa có rebalancing tự động khi thêm/bớt node; forwarding vẫn dùng danh sách tĩnh.
- Chưa có cơ chế quorum động hay chọn leader; write vẫn chặn chờ secondary.
- Chưa xử lý split-brain, chưa có log WAL; snapshot gửi toàn bộ một lần.
- Replication đồng bộ đơn giản; có thể cải tiến thành bất đồng bộ + apply queue.
- Client chưa nhận thông tin topology động; cần cấu hình thủ công host/port.

## 8. Cách chạy nhanh
- 3 node (ví dụ):
```
npx ts-node src/node/index.ts --port 3000 --id node1 --peers 3001,3002
npx ts-node src/node/index.ts --port 3001 --id node2 --peers 3000,3002
npx ts-node src/node/index.ts --port 3002 --id node3 --peers 3000,3001
```
- CLI kết nối node bất kỳ:
```
KV_PORT=3000 npx ts-node src/client/cli.ts
PUT k v
GET k
DELETE k
```