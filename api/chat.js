import { Groq } from 'groq-sdk'

const MODEL = process.env.GROQ_MODEL || ''
const API_KEY = process.env.GROQ_API_KEY || ''

function json(res, status, data) {
  return res.status(status).json(data)
}

function getGroqClient() {
  if (!API_KEY) return null
  return new Groq({ apiKey: API_KEY })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const groqClient = getGroqClient()
  if (!groqClient) {
    return json(res, 500, {
      error: 'Thiếu GROQ_API_KEY. Hãy thêm biến môi trường này trong Vercel Project Settings.',
    })
  }

  if (!MODEL) {
    return json(res, 500, {
      error: 'Thiếu GROQ_MODEL. Hãy thêm tên model Groq trong Environment Variables.',
    })
  }

  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const message = typeof data.message === 'string' ? data.message.trim() : ''

    if (!message) {
      return json(res, 400, { error: 'Vui lòng nhập câu hỏi.' })
    }

    if (message.length > 8000) {
      return json(res, 400, {
        error: 'Câu hỏi quá dài. Vui lòng rút ngắn dưới 8000 ký tự.',
      })
    }

    const chatCompletion = await groqClient.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'Bạn là trợ lý AI thân thiện của một trường THPT. Trả lời bằng tiếng Việt, rõ ràng, hữu ích và phù hợp với học sinh. Khi câu hỏi cần giải thích, trình bày từng bước nhưng không dài dòng không cần thiết.',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      model: MODEL,
      temperature: 0.7,
    })

    const reply = chatCompletion?.choices?.[0]?.message?.content?.trim() || ''

    if (!reply) {
      return json(res, 502, { error: 'Groq API không trả về nội dung trả lời.' })
    }

    return json(res, 200, { reply })
  } catch (error) {
    console.error('Lỗi Groq API:', error)
    const status = Number(error?.status) || 502
    const message = error?.message || 'Không thể kết nối tới Groq API.'

    return json(res, status >= 400 && status < 600 ? status : 502, {
      error: `Groq API: ${message}`,
    })
  }
}
