import http from 'node:http'
import { Groq } from 'groq-sdk'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = Number(process.env.PORT || 4000)
const HOST = process.env.HOST || '127.0.0.1'

const MODEL = process.env.GROQ_MODEL
const API_KEY = process.env.GROQ_API_KEY || ''

const getGroqClient = () => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new Groq({ apiKey });
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase()
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
  }

  res.writeHead(200, {
    'Content-Type': contentTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  })

  createReadStream(filePath).pipe(res)
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 64 * 1024) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
  }

  try {
    return JSON.parse(body || '{}')
  } catch {
    const error = new Error('Invalid JSON.')
    error.statusCode = 400
    throw error
  }
}

async function handleChat(req, res) {
  const groqClient = getGroqClient();
  const currentModel = process.env.GROQ_MODEL;

  if (!groqClient) {
    return sendJson(res, 500, {
      error: 'Thiếu GROQ_API_KEY trong file .env.',
    })
  }

  const data = await readJson(req)
  const message = typeof data.message === 'string' ? data.message.trim() : ''

  if (!message) {
    return sendJson(res, 400, { error: 'Vui lòng nhập câu hỏi.' })
  }

  if (message.length > 8000) {
    return sendJson(res, 400, { error: 'Câu hỏi quá dài. Vui lòng rút ngắn dưới 8000 ký tự.' })
  }

  let chatCompletion
  try {
    chatCompletion = await groqClient.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Bạn là trợ lý AI thân thiện của một trường THPT. Trả lời bằng tiếng Việt, rõ ràng, hữu ích và phù hợp với học sinh. Khi câu hỏi cần giải thích, trình bày từng bước nhưng không dài dòng không cần thiết.'
        },
        {
          role: 'user',
          content: message,
        },
      ],
      model: currentModel,
      temperature: 0.7,
    })
  } catch (error) {
    console.error("Lỗi Groq API:", error);
    const status = Number(error?.status) || 502
    const apiMessage = error?.message || 'Không thể kết nối tới Groq API.'
    const wrapped = new Error(apiMessage)
    wrapped.statusCode = status
    throw wrapped
  }

  const reply = chatCompletion?.choices?.[0]?.message?.content?.trim() || ''

  if (!reply) {
    throw new Error('Groq API không trả về nội dung trả lời.')
  }

  return sendJson(res, 200, { reply })
}

async function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)
  const distRoot = path.resolve(__dirname, 'dist')
  const hasDist = await stat(path.join(distRoot, 'index.html')).then(() => true).catch(() => false)
  const root = hasDist ? distRoot : __dirname
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
  const filePath = path.resolve(root, relativePath)

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return sendJson(res, 403, { error: 'Forbidden' })
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('Not a file')
    return streamFile(filePath, res)
  } catch {
    if (hasDist) {
      return streamFile(path.join(distRoot, 'index.html'), res)
    }
    return sendJson(res, 404, { error: 'Not found' })
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      return res.end()
    }

    if (req.url === '/api/health') {
      const currentModel = process.env.GROQ_MODEL;
      return sendJson(res, 200, { ok: true, model: currentModel, configured: Boolean(process.env.GROQ_API_KEY) })
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      return await handleChat(req, res)
    }

    if (req.method === 'GET') {
      return await serveStatic(req, res)
    }

    return sendJson(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    const status = Number(error?.statusCode) || 500
    return sendJson(res, status, {
      error: status >= 500 ? `Máy chủ gặp lỗi khi gọi Groq: ${error.message}` : error.message,
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Server chạy tại http://${HOST}:${PORT}`)
  console.log(`Groq model hiện tại: ${process.env.GROQ_MODEL}`)
})
