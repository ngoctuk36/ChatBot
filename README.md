# School AI Chatbot

Chatbot đơn giản dùng Vite + Node.js + Google Gemini API.

## Chạy local

```bash
npm install
```

Tạo file `.env` từ `.env.example`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Sau đó:

```bash
npm run dev
```

Frontend chạy bằng Vite, API server chạy ở `http://127.0.0.1:4000`.

## Build production

```bash
npm run build
npm start
```

API key chỉ được đọc ở Node.js server, không đưa vào JavaScript chạy trên trình duyệt.

## Đổi model

Chỉ cần đổi `GEMINI_MODEL` trong `.env`, ví dụ model khác mà tài khoản Gemini API của bạn được phép dùng.
