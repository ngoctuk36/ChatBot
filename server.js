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

const SCHOOL_WEBSITE = 'https://thptchuyenthainguyen.edu.vn/?tab=home&lang=vi&pid=101&cid=101'
const SCHOOL_ORIGIN = new URL(SCHOOL_WEBSITE).origin
const WEB_TIMEOUT_MS = 7000
const MAX_WEBSITE_CONTEXT_CHARS = 5500
const MAX_PAGE_EXCERPT_CHARS = 3000
const MAX_LINKS_TO_FETCH = 3
const MAX_HISTORY_CHARS = 5000
const MAX_HISTORY_MESSAGES = 20

const WEB_TRIGGER_RE = /(trường|thpt chuyên thái nguyên|chuyên thái nguyên|ctn|thầy|cô|giáo viên|học sinh|lớp|thi đua|nề nếp|đồng phục|chào cờ|sinh hoạt|lịch công tác|thời khóa biểu|tkb|thông báo|văn bản|quy định|stem|phong trào|hoạt động|sự kiện|ngày hội|cuộc thi|tuyển sinh|nghỉ học|nghỉ lễ|hôm nay|tuần này|tuần sau|mới nhất|cập nhật|2026|2027)/i

const WEBSITE_HELP_RE = /(bạn|cậu|lifeai).{0,40}(tra cứu|tìm|xem).{0,40}(website|web|thông tin|được gì|gì)|tra cứu.{0,40}(website|web).{0,40}(gì|được gì)|website.{0,40}(tra cứu|xem).{0,40}(gì|được gì)|có thể.{0,40}(tra cứu|xem).{0,40}(website|web)/iu

const VAGUE_WEBSITE_RE = /^(thông tin về trường|về trường|thông tin trường|trường có gì|tra cứu về trường|xem thông tin trường|cho tôi thông tin về trường)[?.!\s]*$/iu

const WEBSITE_HELP_ANSWER = `## lifeAI có thể tra cứu gì trên website trường? 🚀

Mình có thể tra cứu các thông tin được đăng trên website THPT Chuyên Thái Nguyên, ví dụ:

- 📢 **Thông báo** mới của trường.
- 📅 **Lịch công tác, lịch học** và các thông tin theo tuần.
- 🏆 **Cuộc thi, HSG, STEM, phong trào và hoạt động** của trường.
- 👨‍🎓 **Thông tin/danh sách liên quan đến học sinh** khi được đăng công khai.
- 📋 **Quy định, hướng dẫn, văn bản** của nhà trường.
- 🏫 Các **tin tức và sự kiện** được đăng trên website.

Cậu cứ hỏi cụ thể như: **“Lịch công tác tuần này có gì?”**, **“Có thông báo STEM nào mới không?”** hoặc **“Quy định thi đua nói gì về lỗi dùng điện thoại?”** là mình có thể tra cứu đúng phần cần tìm.`

const WEBSITE_VAGUE_ANSWER = `Mình tra cứu được nhé 😄 Nhưng câu hỏi này hơi rộng. Cậu muốn mình tìm **thông báo**, **lịch công tác/lịch học**, **thi đua - nề nếp**, **HSG/STEM/cuộc thi**, **tuyển sinh**, hay **một văn bản/sự kiện cụ thể**? Nêu chủ đề hoặc tên thông tin cần tìm, mình sẽ tra đúng phần đó.`

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(?:8211|8212);/gi, '-')
    .replace(/&#(?:8220|8221);/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPageTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  return cleanText(title || h1 || '').slice(0, 220)
}

function extractLinks(html) {
  const links = []
  const seen = new Set()
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match

  while ((match = re.exec(html))) {
    const href = match[1].trim()
    const label = cleanText(match[2]).slice(0, 180)
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue

    try {
      const url = new URL(href, SCHOOL_WEBSITE)
      if (url.origin !== SCHOOL_ORIGIN) continue
      url.hash = ''
      const key = url.toString()
      if (seen.has(key) || key === SCHOOL_WEBSITE) continue
      seen.add(key)
      links.push({
        url: key,
        label,
        text: `${label} ${url.pathname} ${url.search}`.toLowerCase(),
      })
    } catch {
      // Bỏ qua liên kết lỗi.
    }
  }

  return links
}

async function fetchText(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'lifeAI-school-bot/2.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return null

    const html = await response.text()
    return { html, text: cleanText(html), title: extractPageTitle(html) }
  } catch (error) {
    console.warn('Không thể đọc website trường:', url, error?.message || error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function tokenizeQuestion(question) {
  return question
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3 && !['của', 'cho', 'với', 'nào', 'như', 'được', 'mình', 'bạn', 'cậu'].includes(word))
}

function scoreLink(link, question) {
  const words = tokenizeQuestion(question)
  let score = 0
  for (const word of words) {
    if (link.text.includes(word)) score += word.length >= 6 ? 4 : 1
  }
  if (/(lịch công tác|tuần này|tuần sau|lịch)/iu.test(question) && /lich|lịch|cong-tac|công-tác|ke-hoach|kế-hoạch|tuan|tuần/iu.test(link.text)) score += 7
  if (/(thông báo|mới nhất|cập nhật)/iu.test(question) && /news|tin|thong-bao|thông-báo/iu.test(link.text)) score += 7
  if (/(thi đua|nề nếp|quy định)/iu.test(question) && /quy-dinh|quy-định|thi-dua|thi-đua|ne-nep|nề-nếp/iu.test(link.text)) score += 8
  return score
}

function excerptText(text, question, maxChars = MAX_PAGE_EXCERPT_CHARS) {
  if (!text) return ''
  if (text.length <= maxChars) return text

  const words = tokenizeQuestion(question).slice(0, 8)
  const lower = text.toLowerCase()
  const positions = words
    .map(word => lower.indexOf(word))
    .filter(position => position >= 0)
    .sort((a, b) => a - b)

  if (!positions.length) return text.slice(0, maxChars)

  const center = positions[0]
  const start = Math.max(0, center - Math.floor(maxChars * 0.28))
  return `${start > 0 ? '... ' : ''}${text.slice(start, start + maxChars)}${start + maxChars < text.length ? ' ...' : ''}`
}

async function getWebsiteContext(question) {
  if (!WEB_TRIGGER_RE.test(question) || WEBSITE_HELP_RE.test(question)) return ''

  const homepage = await fetchText(SCHOOL_WEBSITE)
  if (!homepage) return ''

  const links = extractLinks(homepage.html)
    .map(link => ({ ...link, score: scoreLink(link, question) }))
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LINKS_TO_FETCH)

  const chunks = []
  let remaining = MAX_WEBSITE_CONTEXT_CHARS

  const addChunk = (value) => {
    if (!value || remaining <= 0) return
    const clipped = value.slice(0, remaining)
    chunks.push(clipped)
    remaining -= clipped.length
  }

  addChunk(`NGUỒN: ${SCHOOL_WEBSITE}\nTIÊU ĐỀ TRANG: ${homepage.title || 'Trang chủ'}\n${excerptText(homepage.text, question, 1800)}`)

  const pages = await Promise.all(links.map(async link => {
    const page = await fetchText(link.url)
    if (!page) return null
    return `NGUỒN: ${link.url}\nTIÊU ĐỀ: ${link.label || page.title || '(không rõ)'}\n${excerptText(page.text, question)}`
  }))

  for (const page of pages) {
    if (!page || remaining <= 0) break
    addChunk(`\n---\n${page}`)
  }

  return chunks.join('').slice(0, MAX_WEBSITE_CONTEXT_CHARS)
}

function normalizeHistory(history, maxChars = MAX_HISTORY_CHARS) {
  if (!Array.isArray(history)) return []

  const valid = history
    .filter(item =>
      item &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string' &&
      item.content.trim()
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => ({
      role: item.role,
      content: item.content.trim(),
    }))

  const selected = []
  let total = 0

  for (let i = valid.length - 1; i >= 0; i--) {
    const item = valid[i]
    const remaining = maxChars - total
    if (remaining <= 0) break
    const content = item.content.slice(0, Math.min(item.content.length, remaining - 40))
    if (!content) break
    selected.push({ role: item.role, content })
    total += content.length
  }

  return selected.reverse()
}

const SYSTEM_PROMPT = `
Bạn là lifeAI, trợ lý ảo thông thái chuyên giải quyết mẹo vặt cuộc sống và là "Chuyên gia dữ liệu thi đua" dành riêng cho học sinh trường THPT Chuyên Thái Nguyên (Năm học 2026 - 2027).

[PHONG CÁCH & TÍNH CÁCH]
- Là một trợ lý ảo thân thiện, năng động, thực tế và hơi hài hước theo kiểu học sinh; ưu tiên cảm giác tự nhiên như đang nói chuyện với một người bạn thông minh.
- Xưng hô tự nhiên: gọi người dùng là "bạn" hoặc "cậu"; xưng là "lifeAI" hoặc "mình". Không gọi người dùng bằng cách quá trang trọng, xa cách hoặc kiểu máy móc.
- Luôn trả lời bằng tiếng Việt, trừ khi người dùng yêu cầu ngôn ngữ khác.
- Giao tiếp phù hợp với học sinh THPT: dễ hiểu, gần gũi, tích cực, không lên giọng dạy đời. Có thể dùng emoji vừa phải khi hợp ngữ cảnh.
- Khi người dùng đang lo lắng, bối rối hoặc gặp sự cố, ưu tiên trấn an ngắn gọn rồi đưa cách xử lý thực tế.
- Tránh văn phong cứng nhắc, sáo rỗng hoặc quá dài. Không cần lúc nào cũng mở đầu bằng lời chào.
- Khi nhắc tới điểm thi đua hoặc số lần vi phạm, PHẢI bôi đậm các con số điểm cộng/trừ và số lần vi phạm, ví dụ: **-10 điểm**, **3 lần**, **+5 điểm**.
- Dùng gạch đầu dòng khi giúp thông tin dễ quét; không ép mọi câu trả lời phải thành danh sách nếu một câu trả lời tự nhiên sẽ dễ hiểu hơn.
- Có thể dùng Markdown: ## tiêu đề, **chữ đậm**, danh sách -, bảng khi phù hợp và khối code bằng \`\`\`.
- KHÔNG được dùng hoặc hiển thị HTML trong câu trả lời, đặc biệt là <br>, </br>, <p>, </p>, <div>, <span>.
- Khi cần xuống dòng, hãy dùng xuống dòng thông thường hoặc Markdown, không dùng <br>.
- Không bao giờ trả về chuỗi HTML chỉ để tạo khoảng cách hoặc xuống dòng.
- Chỉ nhớ và sử dụng tối đa **20 câu hỏi gần nhất** trong ngữ cảnh hội thoại.
- Website chính thức để tra cứu thông tin trường: https://thptchuyenthainguyen.edu.vn/?tab=home&lang=vi&pid=101&cid=101 . Khi hệ thống cung cấp WEBSITE_CONTEXT, hãy coi đó là dữ liệu tra cứu hiện tại và ưu tiên nó cho thông tin có thể thay đổi. Khi đã vượt quá giới hạn này, các câu hỏi cũ hơn không còn được dùng để suy luận câu trả lời.
- Khi người dùng hỏi kiểu “bạn có thể tra cứu gì trên website?”, hãy giới thiệu ngắn gọn các nhóm thông tin lifeAI có thể tra cứu; không cần bịa thông tin mới và không cần gọi website chỉ để trả lời khả năng của chính mình.
- Khi người dùng hỏi về trường nhưng câu hỏi quá chung (ví dụ “cho tôi thông tin về trường”), hãy hỏi họ muốn tra cứu nhóm nào cụ thể hơn như thông báo, lịch công tác, thi đua - nề nếp, HSG/STEM, tuyển sinh hoặc văn bản/sự kiện.
- Nếu website không cung cấp đủ dữ liệu cho câu hỏi, nói rõ là chưa tìm thấy hoặc dữ liệu chưa đủ và đề nghị người dùng hỏi cụ thể hơn; không đoán.
- Không tuyên bố mình nhớ được các cuộc trò chuyện đã bị xóa hoặc các câu hỏi nằm ngoài 20 câu gần nhất.

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

function cleanAiReply(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(ul|ol|p|div|span|strong|b|em|i|table|thead|tbody|tr|th|td)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function handleChat(req, res) {
  const currentModel = process.env.GROQ_MODEL

  const data = await readJson(req)
  const message = typeof data.message === 'string' ? data.message.trim() : ''

  if (!message) {
    return sendJson(res, 400, { error: 'Vui lòng nhập câu hỏi.' })
  }

  if (message.length > 5000) {
    return sendJson(res, 400, { error: 'Câu hỏi quá dài. Vui lòng rút ngắn dưới 5000 ký tự.' })
  }

  if (WEBSITE_HELP_RE.test(message)) {
    return sendJson(res, 200, { reply: WEBSITE_HELP_ANSWER })
  }

  if (VAGUE_WEBSITE_RE.test(message)) {
    return sendJson(res, 200, { reply: WEBSITE_VAGUE_ANSWER })
  }

  const groqClient = getGroqClient()

  if (!groqClient) {
    return sendJson(res, 500, { error: 'Thiếu GROQ_API_KEY trong file .env.' })
  }

  if (!currentModel) {
    return sendJson(res, 500, { error: 'Thiếu GROQ_MODEL trong file .env.' })
  }

  const history = normalizeHistory(data.history)
  const websiteContext = await getWebsiteContext(message)

  const buildMessages = (historyItems, website) => [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    ...historyItems,
    ...(website ? [{
      role: 'system',
      content: `WEBSITE_CONTEXT - DỮ LIỆU TRA CỨU TỪ WEBSITE TRƯỜNG:\n${website}\n\nChỉ sử dụng dữ liệu website này khi nó liên quan trực tiếp đến câu hỏi hiện tại. Nếu dữ liệu không đủ hoặc không rõ, nói rõ và không tự bịa. Nếu câu hỏi còn quá chung, hãy hỏi người dùng muốn tra cứu phần nào cụ thể hơn.`,
    }] : []),
    {
      role: 'user',
      content: message,
    },
  ]

  let chatCompletion
  try {
    chatCompletion = await groqClient.chat.completions.create({
      messages: buildMessages(history, websiteContext),
      model: currentModel,
      temperature: 0.7,
      max_tokens: 800,
    })
  } catch (error) {
    const apiMessage = String(error?.message || '')
    const status = Number(error?.status) || 502
    const tooLarge = status === 413 || /requested .*tokens|tokens per minute|request too large|ratelimitexceeded/i.test(apiMessage)

    if (!tooLarge) {
      console.error('Lỗi Groq API:', error)
      const wrapped = new Error(apiMessage || 'Không thể kết nối tới Groq API.')
      wrapped.statusCode = status
      throw wrapped
    }

    try {
      chatCompletion = await groqClient.chat.completions.create({
        messages: buildMessages(normalizeHistory(data.history, 2200), websiteContext.slice(0, 2200)),
        model: currentModel,
        temperature: 0.7,
        max_tokens: 1000,
      })
    } catch (retryError) {
      console.error('Lỗi Groq API sau khi giảm context:', retryError)
      const retryStatus = Number(retryError?.status) || 502
      const wrapped = new Error(retryError?.message || 'Không thể kết nối tới Groq API.')
      wrapped.statusCode = retryStatus
      throw wrapped
    }
  }

  const rawReply = chatCompletion?.choices?.[0]?.message?.content || ''
  const reply = cleanAiReply(rawReply)

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
