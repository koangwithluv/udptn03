# Distributed Key-Value Store Documentation Report

## 1. Tổng quan hệ thống
Hệ thống lưu trữ dạng key-value phân tán được thiết kế để cung cấp khả năng lưu trữ và truy xuất dữ liệu hiệu quả trên nhiều node. Mỗi node trong cụm lưu trữ chịu trách nhiệm quản lý một phần dữ liệu và phối hợp với các node khác để đảm bảo tính nhất quán và khả năng chịu lỗi.

## 2. Kiến trúc tổng thể
Hệ thống bao gồm ít nhất ba node, mỗi node lưu trữ một phần dữ liệu của cơ sở dữ liệu khóa-giá trị. Các node giao tiếp với nhau qua giao thức TCP, cho phép chia sẻ thông tin về vị trí dữ liệu và trạng thái của các node trong cụm.

### 2.1 Giao thức truyền thông
Giao thức truyền thông được sử dụng là TCP, với định dạng tuần tự hóa dữ liệu là JSON. Các yêu cầu từ client được gửi đến node, và nếu dữ liệu không có ở node đó, yêu cầu sẽ được chuyển tiếp đến node chứa dữ liệu.

## 3. Sao lưu dữ liệu
Mỗi cặp khóa-giá trị được sao lưu trên ít nhất hai node khác nhau để đảm bảo tính sẵn sàng và nhất quán. Khi một dữ liệu mới được ghi, nó sẽ được lan truyền đến các bản sao trên các node khác thông qua cơ chế sao lưu.

## 4. Chịu lỗi và quản lý node
Hệ thống được thiết kế để tiếp tục hoạt động ngay cả khi một node bị hỏng. Các node còn lại có thể phục vụ yêu cầu đọc/ghi mà không bị gián đoạn. Cơ chế phát hiện hỏng được triển khai thông qua việc gửi heartbeat định kỳ giữa các node.

### 4.1 Khôi phục dữ liệu
Khi một node khởi động lại, nó sẽ yêu cầu dữ liệu thiếu từ các node khác để khôi phục phân vùng dữ liệu của mình. Phương thức khôi phục đơn giản là yêu cầu một ảnh chụp (snapshot) đầy đủ dữ liệu từ node khác.

## 5. Tình huống lỗi
Khi một node khởi động lại hoặc khi một phần hệ thống bị hỏng, các node còn lại sẽ tiếp tục phục vụ yêu cầu. Hệ thống duy trì tính sẵn sàng và nhất quán của dữ liệu thông qua cơ chế sao lưu và khôi phục.

## 6. Phân chia và mở rộng hệ thống
Hệ thống có thể mở rộng bằng cách thêm các node mới vào cụm. Các node mới sẽ tự động tham gia vào quá trình sao lưu và đồng bộ hóa dữ liệu với các node hiện có.

## 7. Hạn chế và đề xuất cải tiến
Mặc dù hệ thống đã được thiết kế để chịu lỗi và đảm bảo tính nhất quán, vẫn có thể cải thiện hiệu suất và khả năng mở rộng bằng cách tối ưu hóa cơ chế sao lưu và khôi phục. Ngoài ra, việc triển khai các thuật toán phân phối dữ liệu thông minh hơn có thể giúp cải thiện hiệu quả lưu trữ.