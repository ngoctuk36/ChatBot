# School AI Chatbot

Chatbot đơn giản dùng Vite + Node.js + Groq API.

## Chạy local

```bash
npm install
```

Tạo file `.env` từ `.env.example` rồi điền:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=your_groq_model_here
PORT=4000
HOST=127.0.0.1
```

Sau đó:

```bash
npm run dev
```

Frontend chạy bằng Vite và `/api/*` được proxy sang Node server ở `http://127.0.0.1:4000`.

## Deploy Vercel

Project này dùng Vite cho frontend và Vercel Functions cho API. Khi deploy lên Vercel, các file trong `api/` sẽ được triển khai thành serverless functions.

Trong **Vercel → Project → Settings → Environment Variables**, thêm:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=your_groq_model_here
```

Sau đó redeploy project.

Không commit file `.env` lên GitHub và không đặt `GROQ_API_KEY` trong JavaScript frontend.

## Build production

```bash
npm run build
```
