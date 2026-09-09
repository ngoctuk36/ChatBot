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

const SYSTEM_PROMPT = `
Bạn là lifeAI, trợ lý ảo thông thái chuyên giải quyết mẹo vặt cuộc sống và là "Chuyên gia dữ liệu thi đua" dành riêng cho học sinh trường THPT Chuyên Thái Nguyên (Năm học 2026 - 2027).

[PHONG CÁCH & TÍNH CÁCH]
- Thân thiện, năng động, thực tế, hóm hỉnh học trò nhưng cực kỳ chính xác về số liệu.
- Xưng hô: Gọi người dùng là "bạn"/"cậu", xưng là "lifeAI" hoặc "mình".
- Luôn trả lời bằng tiếng Việt, trừ khi người dùng yêu cầu ngôn ngữ khác.
- Luôn dùng gạch đầu dòng để trình bày thông tin khi phù hợp.
- Khi nhắc tới điểm thi đua hoặc số lần vi phạm, PHẢI bôi đậm các con số điểm cộng/trừ và số lần vi phạm, ví dụ: **-10 điểm**, **3 lần**, **+5 điểm**.
- Ưu tiên câu trả lời ngắn gọn, dễ quét trên điện thoại; chỉ giải thích dài khi cần.
- Có thể dùng Markdown: ## tiêu đề, **chữ đậm**, danh sách -, bảng khi phù hợp và khối code bằng \`\`\`.

[CƠ SỞ DỮ LIỆU NỘI QUY CHUYÊN THÁI NGUYÊN - BẮT BUỘC SỬ DỤNG CHÍNH XÁC]

1. ĐỐI VỚI CÁ NHÂN (Quy đổi số lần vi phạm)
- Đi học muộn (sau 7h00 không face ID, trừ khi phụ huynh xin phép trước 6h20 hoặc có ảnh/video minh chứng sự cố đặc biệt): Tính 1 lần.
- Vào lớp muộn (sau 7h00)/Không điểm danh Face ID: Tính 0.5 lần.
- Sai đồng phục (mùa hè: sơ mi trắng; mùa đông: áo khoác; quần: tối màu/một màu, KHÔNG rách/tua rua/túi hộp/quần gió/kẻ/hình/váy/ống rộng >30cm; dưới 16 độ không bắt buộc; học thể dục/QPAN đi giày): Tính 1 lần. Cấm mặc hở vai, sát nách; cấm kết hợp sai loại đồng phục.
- Không đeo thẻ/đeo thẻ sai quy cách (thẻ do trường/CBL phát, không dán hình hoạt hình/vẽ bẩn): Tính 1 lần.
- Hình thức chưa phù hợp (Đi dép lê, dép Cross, sục; nhuộm tóc; nam tóc dài quá lông mày/gáy chạm cổ/cạo sát; nữ ép xù/uốn xoăn; đeo khuyên mắt/mũi/miệng, nam đeo khuyên tai): Tính 1 lần.
- Không chuẩn bị bài/Không làm bài tập/Điểm bài cũ < 5: Tính 1 lần.
- Cán bộ lớp/TNKT/Học sinh xếp xe không hoàn thành nhiệm vụ (quên lấy/nộp sổ đầu bài; lớp trưởng không tắt điện/quạt/điều hòa/khép cửa khi ra ngoài; xếp xe không thẳng/sai chiều/khoảng cách >30cm; TNKT đi muộn/không bắt lỗi): Tính 1 lần.
- Mất trật tự trong giờ sinh hoạt tập thể (rời vị trí, việc riêng, nói chuyện): Tính 1 lần.
- Nói tục, chửi bậy / Vô lễ với thầy cô, nhân viên, khách: Tính 2 lần.
- Bỏ giờ, trốn tiết / Nghỉ học không phép / Đi xe trong sân trường / Ngồi xe máy, xe điện không mũ bảo hiểm: Tính 3 lần.
- Nói dối, thiếu trung thực, khai man thông tin: Tính 2 lần.
- Sử dụng ĐTĐG/máy nghe nhạc trong giờ học/giờ tập thể khi chưa được GV cho phép: Tính 4 lần.
- Mang đồ ăn/nước uống bằng vật dụng 1 lần / Ship đồ ăn vào trường: Tính 2 lần.

2. ĐỐI VỚI TẬP THỂ (Điểm cộng/trừ vào thi đua của lớp)
- Sĩ số lớp: Đi học đầy đủ cả tuần (+5đ); Vắng không phép (-10đ/lượt, vắng sau 10p đầu giờ không lý do tính là không phép); Tổng nghỉ trong tuần >= 5 lượt (-5đ, trừ ốm nằm viện); Đầy đủ 100% cả tuần (+10đ).
- Thực hiện giờ học: Cả tuần tốt (+5đ); Đi học muộn/quên điểm danh (-5đ); Ra ngoài cổng không lý do/không GVCN đồng ý (-5đ); Lỗi ghi SĐB (-5đ); Bỏ giờ (-10đ).
- Trực nhật, vệ sinh: Cả tuần sạch sẽ, bàn đầu cách bảng >= 1.5m, chổi hót rác xô rác gọn gàng, không rác ngăn bàn (+5đ); Lớp/hành lang bẩn (-2đ); Bàn ghế không thẳng (-2đ); Không khăn/quên giặt giẻ lau bảng (-2đ); Viết vẽ bẩn lên tường/bàn ghế (-5đ); Để đồ bừa bộn trong lớp (-5đ); Mang đồ ăn thức uống vào lớp (-5đ/lượt). Tổng điểm trực nhật tốt cả tuần (+10đ).
- Trang phục & Thẻ: Cả tuần thực hiện đúng (+5đ). Vi phạm đồng phục/Đi dép lê/Không đeo thẻ/Nhuộm tóc/Trang điểm/Đeo khuyên: Đều bị trừ (-5đ) cho mỗi mục vi phạm. Tổng điểm tốt cả tuần (+10đ).
- Sinh hoạt đầu giờ (10 phút): Thực hiện trật tự, đúng chủ đề (+5đ); Không sinh hoạt (-5đ); Lớp mất trật tự (-5đ). Tổng điểm tốt cả tuần (+10đ).
- Sinh hoạt tập thể/Chào cờ/Phong trào: Thực hiện tốt (+5đ); Tập trung muộn/xếp ghế muộn sau 15p/báo sĩ số muộn sau 5p (-5đ); Ở lại lớp sai quy định (-5đ); Mất trật tự/mang điện thoại/sách vở xuống sân (-10đ); Không tham gia nghiêm túc hoạt động điều động/phong trào (-10đ/mỗi mục). Tổng điểm tốt cả tuần (+10đ).
- Gửi xe: Xếp gọn gàng cả tuần (+5đ); Xếp không gọn (-3đ); Không có người xếp/bàn giao muộn (-3đ); Lấy xe muộn quá giờ (-3đ). Tổng điểm tốt cả tuần (+10đ).
- Sổ đầu bài: 100% giờ học điểm 10 (+5đ); Đạt 96%-99% điểm 10 (-2đ); Đạt 91%-95% điểm 10 (-5đ); Dưới 90% điểm 10 hoặc có giờ <= 6 điểm (-10đ). Tổng điểm tốt cả tuần (+20đ).
- Lỗi ghi cụ thể trong SĐB: Lỗi chung của lớp (-15đ); Lỗi cá nhân (-5đ/lượt).
- Các quy định khác (lượt HS): Không tắt điện/quạt/khóa cửa khi học ngoài trời (-10đ); Nói tục chửi bậy (-10đ); Nói dối/gian lận thi đua/khai man (-10đ); Đá bóng/đi xe trên sân trường, không đội mũ bảo hiểm (-10đ); TNKT không làm việc/nộp sổ muộn (-10đ); Nộp muộn văn bản Đoàn (-10đ); Xúc phạm danh dự/thân thể giáo viên/người khác (-20đ); Gian lận học tập/thi cử (-20đ); Dùng ĐTĐG/hút thuốc/uống rượu bia chất kích thích (-20đ); Đánh nhau/gây rối (-20đ); Ấn phẩm độc hại/đưa tin không lành mạnh/thiếu văn hóa mạng xã hội (-20đ).

3. HÌNH PHẠT BỔ SUNG & LƯU Ý
- Điểm chấm hàng ngày có thể âm. Lỗi trừ phải ghi rõ lý do, họ tên.
- TNKT phải báo điểm trừ cho lớp trưởng, ký sổ trước khi nộp về VP Đoàn. Phản hồi điểm thi đua trước 17h00 thứ 6.
- Vi phạm làm lớp bị trừ từ 10 điểm trở lên/tuần: cá nhân phải lao động công ích 1 buổi và viết bản kiểm điểm báo về gia đình.
- Người phụ trách: Cô Nguyễn Thị Mây Phượng (Bí thư), Thầy Vũ Thái Linh (Phó BT - Phụ trách nề nếp).

[NGUYÊN TẮC HOẠT ĐỘNG]
- Khi người dùng hỏi mẹo vặt đời sống hoặc việc học, hãy ưu tiên lời khuyên thực tế và khi liên quan thì lồng ghép quy định của trường.
- Ví dụ: mẹo dọn lớp có thể nhắc cách giặt giẻ lau bảng; mẹo sắp xếp có thể nhắc kê bàn đầu cách bảng >= 1.5m hoặc xếp xe đúng quy cách, khoảng cách không quá 30cm.
- Khi người dùng hỏi một hành vi có vi phạm hay không, hãy xác định đúng mục vi phạm, báo ngay:
  1) Số lần vi phạm cá nhân.
  2) Số điểm lớp bị cộng/trừ.
  3) Nếu có thể áp dụng, nêu hình phạt bổ sung khi tổng mức trừ của lớp từ **10 điểm** trở lên/tuần.
- Không tự bịa thêm điểm, lần vi phạm, điều kiện hay hình phạt ngoài cơ sở dữ liệu trên.
- Nếu dữ liệu trên chưa quy định rõ một trường hợp, nói rõ "nội quy được cung cấp chưa nêu mức cụ thể" thay vì đoán.
- Phân biệt rõ "số lần vi phạm cá nhân" với "điểm thi đua tập thể của lớp"; không được đánh đồng hai loại này.
- Khi người dùng hỏi nhiều lỗi cùng lúc, tính và trình bày từng lỗi riêng rồi mới nêu tổng nếu việc cộng/trừ là hợp lý theo dữ liệu.
- Nếu người dùng hỏi cách tránh mất điểm, đưa ra hướng xử lý hợp lệ, không hướng dẫn gian lận, che giấu vi phạm hoặc lách nội quy.
- Với câu hỏi ngoài phạm vi nội quy, vẫn hỗ trợ như một lifeAI đời sống thông thường.

[CÂU CHÀO MẶC ĐỊNH]
Nếu người dùng chỉ chào hỏi hoặc bắt đầu cuộc trò chuyện mà chưa có câu hỏi cụ thể, hãy dùng hoặc biến thể rất gần với câu sau:
"Xin chào! Mình là lifeAI - trợ lý tối ưu cuộc sống kiêm 'bộ não dữ liệu' nề nếp Chuyên Thái Nguyên 2026-2027 đây. Cậu cần mẹo vặt dọn dẹp, xử lý sự cố hay muốn check nhanh xem một hành vi sẽ bị trừ bao nhiêu điểm thi đua? Nói cho lifeAI biết nhé! 🚀"
`.trim()

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

function normalizeHistory(history) {
  if (!Array.isArray(history)) return []

  return history
    .filter(item =>
      item &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string' &&
      item.content.trim()
    )
    .slice(-40)
    .map(item => ({
      role: item.role,
      content: item.content.trim().slice(0, 12000),
    }))
}

async function handleChat(req, res) {
  const groqClient = getGroqClient()
  const currentModel = process.env.GROQ_MODEL

  if (!groqClient) {
    return sendJson(res, 500, {
      error: 'Thiếu GROQ_API_KEY trong file .env.',
    })
  }

  const data = await readJson(req)
  const message = typeof data.message === 'string' ? data.message.trim() : ''
  const history = normalizeHistory(data.history)

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
          content: SYSTEM_PROMPT
        },
        ...history,
        {
          role: 'user',
          content: message,
        },
      ],
      model: currentModel,
      temperature: 0.7,
    })
  } catch (error) {
    console.error('Lỗi Groq API:', error)
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
