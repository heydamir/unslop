# unslop

[English](README.md) · Tiếng Việt

Được tạo bởi Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), người đã khởi xướng chuỗi [Unslopping](https://x.com/heydamir/status/2115063463063998736) trên X.

![Một dashboard vibecoded đang tự unslop, từng khung hình một](skills/unslop/references/refs/story-dashboard-frames.webp)

unslop là một skill dành cho Claude Code, Codex và Google Antigravity, giúp biến giao diện vibecoded trông đậm mùi AI thành một giao diện được thiết kế bài bản với cá tính riêng. Nó tìm ra phần "slop" trước — những gradient tím, hiệu ứng phát sáng, nhãn gắn emoji, câu chữ gào thét và khoảng cách xô lệch — rồi vạch ra một hướng đi từ chính sản phẩm của bạn và sửa màn hình qua từng lượt, như một designer đang rà soát bản redline. Nó hoạt động với bất cứ công nghệ nào màn hình của bạn được dựng bằng, như Next.js, React, Vue, Svelte, Tailwind hay HTML và CSS thuần, trên dashboard, ứng dụng và landing page, và cả trên một trang web đang chạy khi tất cả những gì bạn có chỉ là một đường link.

## Cài đặt

Đối với Claude Code, hãy cài nó dưới dạng plugin. Chạy lệnh này trong terminal để dùng được trong mọi dự án:

```bash
claude plugin install unslop --marketplace heydamir/unslop
```

Trên Claude Code bản cũ không có `--marketplace`, làm tương tự trong hai bước:

```bash
claude plugin marketplace add heydamir/unslop
claude plugin install unslop@heydamir
```

Để chỉ dùng trong một dự án duy nhất, chạy lệnh cài đặt từ thư mục gốc của dự án đó, thư mục bạn mở Claude Code trong đó, và thêm `--scope local`. Để bật cho mọi người cùng làm trong dự án, thay bằng `--scope project` và commit `.claude/settings.json`. Mỗi thành viên trong nhóm sau đó chạy lệnh này một lần trong bản sao dự án của mình:

```bash
claude plugin marketplace add heydamir/unslop
claude plugin install unslop@heydamir --scope project
```

Sau đó mở một phiên Claude Code mới, hoặc chạy `/reload-plugins` trong phiên đang mở.

Để cập nhật, chạy `claude plugin update unslop@heydamir`, hoặc bật tự động cập nhật cho marketplace heydamir trong mục Marketplaces của `/plugin`.

Nếu trước đây bạn từng sao chép unslop vào `~/.claude/skills/` hoặc `.claude/skills/` của một dự án, hãy xóa bản sao đó, nếu không `/unslop` sẽ tiếp tục chạy bản sao thay vì plugin.

Đối với Codex, hãy bảo nó cài skill thẳng từ repo này.

```
$skill-installer install https://github.com/heydamir/unslop/tree/main/skills/unslop
```

Hoặc sao chép thủ công vào `~/.agents/skills/`, hoặc vào `.agents/skills/` bên trong một dự án duy nhất.

```bash
git clone https://github.com/heydamir/unslop
mkdir -p ~/.agents/skills && cp -r unslop/skills/unslop ~/.agents/skills/
```

Đối với Google Antigravity, sao chép skill vào thư mục skills của bạn.

```bash
git clone https://github.com/heydamir/unslop
mkdir -p ~/.gemini/config/skills && cp -r unslop/skills/unslop ~/.gemini/config/skills/
```

Đối với một dự án duy nhất, thay vào đó hãy sao chép nó vào `.agents/skills/` bên trong dự án đó.

Để chụp snapshot một trang web đang chạy hoặc tạo story video, hãy cài Playwright cùng trình duyệt Chromium của nó từ thư mục dự án nơi bạn chạy skill:

```bash
npm install -D playwright
npx playwright install chromium
```

Story video cũng yêu cầu ffmpeg đã được cài và có sẵn trên PATH của bạn.

## Cách dùng

Trong Claude Code, gõ `/unslop` kèm điều bạn muốn, hoặc `/unslop:unslop` nếu đã có skill khác trùng tên đó. Trong Codex, gõ `$unslop` theo cách tương tự. Hoặc cứ yêu cầu bằng lời của bạn và agent sẽ tự nhận diện skill.

```
/unslop this dashboard
/unslop the hero of https://example.com
/unslop my landing page and make the story video so I can post it
```

Nó rà soát màn hình và đề xuất một hướng đi trước khi sửa bất cứ thứ gì, để bạn có thể điều hướng từ sớm. Nếu màn hình đã ổn, nó sẽ nói thẳng như vậy và gợi ý vài tinh chỉnh nhỏ thay vì thiết kế lại.

## Nó làm được gì

- **Rà soát.** Liệt kê mọi dấu hiệu của slop kèm vị trí của chúng.
- **Định hướng.** Cá tính, thế giới, một hoặc hai khoảnh khắc gánh màu sắc, và một chi tiết dấu ấn — tất cả lấy từ chính sản phẩm của bạn.
- **Từng lượt sửa.** Khoảng cách, màu sắc, icon, câu chữ, kiểu chữ, bố cục, chi tiết, hình ảnh và chuyển động, theo đúng thứ tự đó.
- **Hình ảnh.** Cho thấy sản phẩm của bạn thay vì một khối bóng loáng. Khi một hero cần một cảnh hay một vật thể, nó có thể tạo ra thông qua một dịch vụ ảnh như fal, Replicate, OpenAI images hay Higgsfield. Nếu chưa có dịch vụ nào được kết nối, nó sẽ đề nghị kết nối một dịch vụ dưới dạng MCP server, và nó luôn cho xem prompt và hỏi trước mỗi lần tạo ảnh tốn phí. Dashboard và ứng dụng hiếm khi cần đến việc này.
- **Story video.** Một video vuông dưới 10 giây ghi lại cảnh màn hình của bạn tự unslop, sẵn sàng để đăng. Nó cần Playwright và ffmpeg.

Hãy thử nó trên hai màn hình vibecoded trong [examples](examples).

## Thuê người unslop

Muốn có một designer làm thay hơn? Damir sẽ unslop một màn hình then chốt trong 3 ngày, dựng bằng đúng stack của bạn, tại [heydamir.design/unslop](https://heydamir.design/unslop).

## Giấy phép

[CC BY 4.0](LICENSE). Cứ dùng, sửa và chia sẻ, kể cả cho mục đích thương mại, miễn là bạn ghi công Damir Sokolovsky ([@heydamir](https://x.com/heydamir)) và liên kết về lại repo này.
