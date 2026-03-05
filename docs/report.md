# Báo cáo: Hệ thống lưu trữ Key-Value phân tán

---

## Phần 0 — Đọc trước: các khái niệm bạn cần biết

Nếu bạn chưa từng học về hệ thống phân tán, hãy đọc phần này trước. Mỗi thuật ngữ được giải thích bằng ví dụ đời thường.

---

### 0.1 Kho Key-Value là gì?

Hãy tưởng tượng một cuốn sổ điện thoại. Mỗi trang có hai thông tin:

```
Tên (khóa — key)  →  Số điện thoại (giá trị — value)
"alice"            →  "0901234567"
"bob"              →  "0987654321"
```

Kho Key-Value (KV Store) hoạt động y hệt như vậy. Bạn có thể:
- **PUT** — lưu một cặp `(key, value)`, ví dụ `PUT alice 0901234567`
- **GET** — lấy giá trị theo key, ví dụ `GET alice` → trả về `0901234567`
- **DELETE** — xóa một key, ví dụ `DELETE alice`

---

### 0.2 Hệ thống phân tán là gì?

Thông thường, một phần mềm chạy trên **một máy duy nhất**. Nếu máy đó hỏng → mất dữ liệu, dịch vụ ngừng.

**Hệ thống phân tán** = nhiều máy (gọi là **node**) cùng nhau lưu trữ và phục vụ dữ liệu. Nếu một node hỏng, các node còn lại vẫn tiếp tục hoạt động.

```
            ┌──────────┐
            │  Client  │  ← người dùng gửi PUT/GET/DELETE
            └────┬─────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Node A  │ │ Node B  │ │ Node C  │  ← 3 máy chủ cùng phục vụ
└─────────┘ └─────────┘ └─────────┘
```

---

### 0.3 Bản sao (Replica)

Nếu chỉ lưu dữ liệu ở 1 node, node đó hỏng là mất. Vì vậy, mỗi cặp key-value được lưu ở **2 node** (2 bản sao).

- Bản chính gọi là **primary** — chịu trách nhiệm ghi.
- Bản phụ gọi là **secondary** — giữ bản dự phòng.

Ví dụ: key `"alice"` → primary ở Node A, secondary ở Node B. Nếu Node A hỏng, dữ liệu vẫn còn ở Node B.

---

### 0.4 Heartbeat (nhịp tim)

Các node thường xuyên gửi tín hiệu cho nhau: "Tôi vẫn đang chạy". Đây gọi là **heartbeat** (nhịp tim).

- Cứ mỗi **2 giây**, mỗi node gửi heartbeat cho các node bạn.
- Nếu sau **5 giây** không nhận được heartbeat từ một node → coi node đó đã **hỏng**.

---

### 0.5 Snapshot và WAL (ghi nhật ký)

Giả sử máy mất điện đột ngột. Dữ liệu trong RAM bị bay. Làm sao khôi phục?

**WAL (Write-Ahead Log — Nhật ký ghi trước):**
- Giống cuốn sổ nhật ký: trước khi làm bất cứ thay đổi nào, ghi vào sổ trước.
- Sau khi bật lại máy, đọc sổ và làm lại từng bước để khôi phục.
- File trên đĩa: `data-<port>.wal`

**Snapshot (Ảnh chụp):**
- Định kỳ chụp ảnh toàn bộ dữ liệu tại một thời điểm, ghi ra file JSON.
- Nhanh hơn phát lại toàn bộ WAL.
- File trên đĩa: `data-<port>.json`

**Kết hợp cả hai:**
1. Khi bật lại → đọc snapshot (trạng thái từ lần chụp gần nhất).
2. → Phát lại WAL (các thao tác xảy ra sau lần snapshot đó).
3. → Dữ liệu về trạng thái ngay trước lúc mất điện.

---

### 0.6 Hashing (Băm — phân công key cho node)

Khi có nhiều node, mỗi key cần được "giao" cho một node cụ thể làm primary. Làm thế nào để chọn?

**Hashing:** biến chuỗi key thành một con số, rồi chia lấy dư cho số node đang sống.

```
hash("alice") = 87654  →  87654 % 3 = 0  →  Node 0 là primary
hash("bob")   = 12345  →  12345 % 3 = 2  →  Node 2 là primary
```

Cách này đảm bảo:
- Cùng một key luôn được giao cho cùng một node (nhất quán).
- Tải trải đều ra các node.

---

### 0.7 Rebalance (Cân lại dữ liệu)

Khi có node **mới vào** hoặc **node cũ rời đi**, kết quả hashing thay đổi. Một số key bây giờ "thuộc về" node khác.

**Rebalance** là quá trình tự động chuyển key về đúng node mới. Nó diễn ra theo batch (nhiều key một lần) và chờ xác nhận (ack) trước khi xóa bản cũ.

---

### 0.8 Circuit Breaker (Cầu dao tự động)

Nếu Node A liên tục gọi sang Node B nhưng B đang hỏng → lãng phí tài nguyên, làm chậm hệ thống.

**Circuit Breaker** hoạt động như cầu dao điện:
- Sau **3 lần lỗi liên tiếp** → **mở cầu dao**: ngừng gọi sang Node B trong một khoảng thời gian.
- Thời gian ngừng tăng theo mũ: 2s → 4s → 8s → 16s → 32s (tối đa).
- Khi có một lần thành công → **đóng cầu dao**: gọi bình thường trở lại.

---

### 0.9 Epoch (Thế hệ cấu hình — chống thông tin cũ)

Khi mạng bị chia đôi, mỗi nhóm node có thể tự quyết định cấu hình khác nhau → **split-brain**: hai nhóm cùng nghĩ mình là chủ và ghi dữ liệu trái ngược nhau.

**Epoch** là số thứ tự cấu hình. Mỗi khi danh sách node thay đổi, epoch tăng lên 1. Quy tắc:
- Nhận thông tin membership với **epoch cao hơn** → cập nhật theo.
- **Epoch bằng nhau** → hợp nhất (union) danh sách peers.
- **Epoch thấp hơn** → bỏ qua, đây là thông tin cũ.

---


## Phần 1 — Tổng quan hệ thống

Đây là hệ thống kho Key-Value phân tán viết bằng **TypeScript/Node.js**. Các node giao tiếp qua **TCP** dùng định dạng **JSON** (mỗi thông điệp trên một dòng, kết thúc bằng `\n`).

### Những gì hệ thống làm được

| Tính năng | Mô tả |
|---|---|
| PUT / GET / DELETE | Lưu, đọc, xóa dữ liệu |
| Replication | Mỗi key có 2 bản sao (primary + secondary) |
| Forwarding | Node nhận "sai phần" tự chuyển yêu cầu đến đúng node |
| Fallback | Nếu primary hỏng, node khác tự xử lý để không mất yêu cầu |
| Heartbeat | Phát hiện node hỏng sau 5 giây không có tín hiệu |
| Snapshot + WAL | Khôi phục dữ liệu sau khi máy crash |
| Snapshot stream | Xin dữ liệu từ node khác khi mới khởi động |
| Membership gossip | Tự động cập nhật danh sách node qua giao tiếp ngang hàng |
| Epoch | Chống dùng cấu hình cũ khi mạng hồi phục |
| Rebalance batch | Di chuyển key về đúng node sau khi cấu hình thay đổi |
| Circuit Breaker | Tránh gọi liên tục sang node hỏng |

---

## Phần 2 — Cấu trúc mã nguồn

```
src/
  client/
    cli.ts               <- Chương trình CLI cho người dùng gõ lệnh
  node/
    server.ts            <- Trái tim: nhận kết nối, điều phối mọi logic
    storage.ts           <- Lưu dữ liệu: Map + Snapshot + WAL
    replication.ts       <- Gửi bản sao sang node khác (REPL_PUT/DEL)
    membership.ts        <- Quản lý danh sách node + epoch
    index.ts             <- Khởi động server từ tham số dòng lệnh
  protocol/
    messages.ts          <- Định nghĩa tất cả loại thông điệp JSON
  utils/
    logger.ts            <- Ghi log ra file
tests/
  node.test.ts           <- Kiểm thử đơn vị logic node
  client.test.ts         <- Kiểm thử đơn vị client
  integration.test.ts    <- Kiểm thử tích hợp: replication, failover, WAL crash
docs/
  report.md              <- Tài liệu này
README.md                <- Hướng dẫn chạy nhanh
```

### Mỗi file làm gì?

**server.ts** — File quan trọng nhất. Mỗi node chạy một instance của class Server. Nó mở cổng TCP, phân loại thông điệp nhận được (yêu cầu client? replication? heartbeat? snapshot? membership?) và gọi đúng hàm xử lý tương ứng. Quản lý circuit breaker khi gửi ra ngoài.

**storage.ts** — Lưu dữ liệu. Bên trong có Map<string,string> (hashmap trong RAM), cộng với WAL (file .wal) và Snapshot (file .json). Khi khởi động: đọc snapshot rồi replay WAL để khôi phục đúng trạng thái cuối cùng trước crash.

**replication.ts** — Gửi bản sao sang node khác. Khi primary ghi xong, gọi replicatePut() / replicateDelete() để secondary có bản sao. Tự động retry với backoff tăng dần nếu thất bại.

**membership.ts** — Biết danh sách node nào đang tham gia cụm. Giữ epoch để tránh dùng thông tin cũ từ trước khi mạng bị gián đoạn.

**messages.ts** — Định nghĩa "hình dạng" của từng loại thông điệp JSON để TypeScript kiểm tra kiểu dữ liệu tại compile time.

---

## Phần 3 — Các luồng xử lý chi tiết

### 3.1 Khi client gửi PUT

Ví dụ: PUT alice 0901234567

```
Client
  |  PUT alice 0901234567
  v
Node B (nhận yêu cầu)
  |
  +-- Tính primary của key "alice":
  |   hash("alice") % 2 = 0  -->  primary = Node A (port 3000)
  |
  +-- Node B không phải primary -> forward sang Node A
  |   (Nếu Node A không trả lời -> Node B tự ghi -- fallback)
  |
  v
Node A (primary)
  +-- Lưu vào Map: alice -> 0901234567
  +-- Ghi vào WAL (nhật ký trên đĩa)
  +-- Ghi Snapshot (ảnh chụp toàn bộ dữ liệu)
  +-- Gửi REPL_PUT sang Node B (secondary)
  |     Node B xác nhận (ack)
  +-- Trả "success" -> Node B -> Client
```

Nói đơn giản hơn: Client nhờ B lưu. B hỏi "ai giữ key này?" -- là A. B chuyển cho A. A lưu, nhắn B giữ bản phụ, rồi báo ngược về "xong rồi".

---

### 3.2 Khi client gửi GET

```
Client
  |  GET alice
  v
Node B (nhận yêu cầu)
  |
  +-- Tính primary = Node A -> forward sang A
  |
  v
Node A
  +-- Đọc từ Map -> trả về "0901234567" -> Node B -> Client
```

---

### 3.3 Khi primary bị hỏng trong lúc PUT (Fallback)

```
Client
  |  PUT alice 0901234567
  v
Node B
  +-- Forward sang Node A... timeout hoặc circuit breaker đang mở
  |
  +-- Fallback: Node B tự ghi alice -> 0901234567
  |   (ghi WAL + snapshot, replicate nếu còn node khác)
  |
  +-- Trả "success" cho Client
     (Khi Node A sống lại -> rebalance sẽ chuyển key về A)
```

---

### 3.4 Khi một node crash rồi khởi động lại

```
Node A khởi động lại
  |
  +-- 1. Đọc snapshot từ đĩa (data-3000.json)
  |       -> Khôi phục Map + version
  |
  +-- 2. Replay WAL (data-3000.wal)
  |       -> Áp dụng các thao tác chưa có trong snapshot
  |
  +-- 3. Gửi SNAPSHOT_REQUEST sang Node B
  |       Node B gửi lại toàn bộ dữ liệu chia chunk + checksum SHA-256
  |       Node A ghép chunk, kiểm tra checksum
  |       Nếu version từ B mới hơn -> áp dụng
  |
  +-- 4. Tham gia lại cụm, bắt đầu phục vụ
```

---

### 3.5 Heartbeat và phát hiện node hỏng

```
Mỗi 2 giây:
  Node A --HEARTBEAT--> Node B
  Node A --HEARTBEAT--> Node C

  Node B và C ghi nhận "A vừa gửi vào lúc X"

Khi kiểm tra (mỗi giây):
  Nếu now - lastSeen[A] > 5000ms -> A được coi là hỏng
  -> Không tính A vào danh sách "alive" khi chọn primary/secondary
```

---

### 3.6 Rebalance khi membership thay đổi

Giả sử Node C mới vào cụm, alive đổi từ [A, B] thành [A, B, C]. Một số key trước đây thuộc A, giờ theo hashing mới lại thuộc C.

```
Node A nhận biết membership đổi
  |
  +-- Duyệt toàn bộ key trong local Map
  |
  +-- key "bob":  primary mới = C  (trước là A)
  |   -> gom vào bucket gửi cho C
  |
  +-- Gửi REBALANCE_PUSH {entries: {bob: "..."}} -> Node C
  |   Node C nhận, ghi vào Map, replicate sang secondary, ack
  |
  +-- A nhận ack -> xóa "bob" khỏi local Map của mình
```

---

### 3.7 Circuit Breaker từng bước

```
Lần gọi 1 -> lỗi  -> failure count = 1 (chưa mở)
Lần gọi 2 -> lỗi  -> failure count = 2 (chưa mở)
Lần gọi 3 -> lỗi  -> failure count = 3 -> MỞ BREAKER, chờ 2s

Trong 2s: mọi lần gọi sang peer này -> trả về lỗi ngay, không thử TCP

Sau 2s: thử lại
  -> Thành công -> ĐÓNG BREAKER, reset failure count = 0
  -> Lỗi lại    -> failure count = 4 -> chờ 4s

Thời gian chờ tăng: 2s -> 4s -> 8s -> 16s -> 32s (tối đa)
```

---

## Phần 4 — Giao thức thông điệp

Các node giao tiếp bằng JSON, mỗi thông điệp trên một dòng (kết thúc \n).

### Bảng tổng hợp thông điệp

| Loại | Hướng | Nội dung | Ý nghĩa |
|---|---|---|---|
| PUT | Client -> Node | {type, key, value} | Lưu key-value |
| GET | Client -> Node | {type, key} | Lấy giá trị |
| DELETE | Client -> Node | {type, key} | Xóa key |
| RESPONSE | Node -> Client | {type, success, data?, error?} | Kết quả |
| REPL_PUT | Node -> Node | {type, key, value, opId} | Sao chép ghi |
| REPL_DEL | Node -> Node | {type, key, opId} | Sao chép xóa |
| HEARTBEAT | Node -> Node | {type, nodeId} | Tôi còn sống |
| SNAPSHOT_REQUEST | Node -> Node | {type, from} | Xin toàn bộ dữ liệu |
| SNAPSHOT_CHUNK | Node -> Node | {type, data, seq, total, checksum} | Gói dữ liệu thứ seq/total |
| SNAPSHOT_DONE | Node -> Node | {type, totalChunks, checksum, version} | Xong snapshot |
| JOIN | Node -> Node | {type, nodeId, epoch, peers} | Tôi vào cụm |
| LEAVE | Node -> Node | {type, nodeId, epoch, peers} | Tôi rời cụm |
| MEMBERSHIP_SNAPSHOT | Node -> Node | {type, nodeId, epoch, peers} | Đây là danh sách node hiện tại |
| REBALANCE_PUSH | Node -> Node | {type, entries, from} | Nhận batch key này từ tôi |

### Ví dụ JSON gửi trên dây

```json
{"type":"PUT","key":"alice","value":"0901234567"}
{"type":"RESPONSE","success":true}
{"type":"REPL_PUT","key":"alice","value":"0901234567","opId":"3000-alice-1234-abc"}
{"type":"HEARTBEAT","nodeId":"3000"}
{"type":"JOIN","nodeId":"3000","epoch":1,"peers":[3000,3001]}
{"type":"REBALANCE_PUSH","entries":{"bob":"0987654321"},"from":3000}
```

---

## Phần 5 — Tính đúng đắn dữ liệu

### 5.1 Idempotency — chống trùng lặp khi retry

Khi gửi REPL_PUT thất bại, node sẽ thử lại (retry). Nhưng nếu lần đầu thực ra đã thành công (chỉ mất phản hồi), node nhận sẽ xử lý hai lần cùng một thao tác. Vì đây là PUT cùng một giá trị, không vấn đề gì.

Để an toàn hơn, mỗi thông điệp replication có opId duy nhất (tổ hợp port + key + timestamp + random). Node nhận ghi nhớ các opId đã xử lý; nếu nhận lại cùng opId -> bỏ qua, trả success ngay.

### 5.2 Version snapshot — tránh ghi đè dữ liệu mới

Mỗi lần PUT/DELETE tăng version lên 1. Khi node xin snapshot từ peer, chỉ áp dụng nếu version nhận được mới hơn version hiện tại -> tránh ghi đè dữ liệu mới bằng dữ liệu cũ hơn.

### 5.3 Checksum SHA-256 cho snapshot

Snapshot chia thành nhiều chunk, mỗi chunk 200 mục. Mỗi chunk có checksum SHA-256 riêng. Khi nhận đủ tất cả chunk, tính lại checksum tổng so sánh với giá trị trong SNAPSHOT_DONE. Nếu không khớp -> bỏ toàn bộ, không áp dụng dữ liệu có thể bị lỗi.

---

## Phần 6 — Kiểm thử

| File | Loại | Những gì được kiểm tra |
|---|---|---|
| node.test.ts | Unit | PUT/GET/DELETE, replication cơ bản, khôi phục từ WAL |
| client.test.ts | Unit | CLI: PUT, GET, DELETE qua Server thật trên localhost |
| integration.test.ts | Integration | Replication đa node, failover + WAL recovery, fault-injection crash |

**Test fault-injection quan trọng nhất:**

```
Kịch bản: Máy chủ crash giữa chừng, chỉ có WAL (không có snapshot)

Bước 1: Khởi động node với KV_FAULT_SKIP_SNAPSHOT=1
         -> node bỏ qua ghi snapshot, chỉ ghi WAL
Bước 2: PUT một số key
Bước 3: Dừng node (giả lập crash đột ngột)
Bước 4: Khởi động lại bình thường (có ghi snapshot)
Bước 5: GET các key -> phải vẫn còn (nhờ WAL đã ghi ở bước 2)

Kết quả mong đợi: PASS — WAL đủ để khôi phục dù không có snapshot
```

---

## Phần 7 — Cách chạy

### Khởi động cụm 3 node

Mở 3 terminal riêng biệt, mỗi terminal chạy một lệnh:

```bash
# Terminal 1
npx ts-node src/node/index.ts --port=3000 --id=node1 --peers="3001,3002"

# Terminal 2
npx ts-node src/node/index.ts --port=3001 --id=node2 --peers="3000,3002"

# Terminal 3
npx ts-node src/node/index.ts --port=3002 --id=node3 --peers="3000,3001"
```

### Kết nối CLI (Windows PowerShell)

```powershell
$env:KV_HOST="127.0.0.1"
$env:KV_PORTS="3000,3001,3002"
npx ts-node src/client/cli.ts
```

### Gõ lệnh trong CLI

```
> PUT k1 hello
success
> GET k1
hello
> DELETE k1
success
> GET k1
(trả về rỗng)
```

### Chạy tất cả bài kiểm thử

```bash
npm test
```

Kết quả mong đợi: 12/12 tests passing.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| KV_SNAPSHOT_PATH | data-<port>.json | Đường dẫn file snapshot |
| KV_WAL_PATH | data-<port>.wal | Đường dẫn file WAL |
| KV_FAULT_SKIP_SNAPSHOT | không đặt | Nếu = 1, bỏ qua ghi snapshot (chỉ dùng khi test) |
| KV_HOST | 127.0.0.1 | Host cho CLI kết nối |
| KV_PORTS | 3000 | Danh sách port CLI thử khi một port hỏng |

---

## Phần 8 — Giới hạn hiện tại và hướng phát triển

### Giới hạn hiện tại

- Đọc chỉ từ local: nếu node nhận GET chưa có key (chưa rebalance xong), trả null tạm thời.
- Không có leader bầu cử: không có Raft/Paxos; dựa hoàn toàn vào hashing.
- Epoch đơn giản: chống được cấu hình cũ nhưng chưa có xác thực chữ ký hay lease.
- WAL không có compaction: WAL tăng mãi; cần restart để dọn dẹp.

### Hướng phát triển

- Đọc từ secondary khi primary hỏng; thêm tùy chọn quorum đọc.
- Compaction WAL và snapshot tăng dần (incremental snapshot).
- Tự động loại peer khỏi hashing sau khi hỏng quá lâu.
- Thêm metrics (số yêu cầu, độ trễ) và distributed tracing.
- Kiểm thử chaos: mô phỏng mất gói mạng, độ trễ ngẫu nhiên.
