const setupInputContainer = document.getElementById('setup-input-container')
const setupTextarea = document.getElementById('setup-textarea')
const sendButton = document.getElementById('send-btn')
const movieBossText = document.getElementById('movie-boss-text')
const chatHistory = document.getElementById('chat-history')
const memoryCount = document.getElementById('memory-count')

const MAX_TURNS = 20
const STORAGE_KEY = 'lifeai-chat-history-v1'

let isSending = false
let conversation = loadConversation()

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value)

  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  return text
}

function markdownToHtml(markdown) {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n').trim()
  if (!source) return ''

  const lines = source.split('\n')
  const html = []
  let inCode = false
  let codeBuffer = []
  let codeLanguage = ''
  let paragraph = []
  let listType = null

  const closeList = () => {
    if (!listType) return
    html.push(`</${listType}>`)
    listType = null
  }

  const closeParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`)
    paragraph = []
  }

  const closeCode = () => {
    if (!inCode) return
    html.push(
      `<pre><code${codeLanguage ? ` data-language="${escapeHtml(codeLanguage)}"` : ''}>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`
    )
    inCode = false
    codeBuffer = []
    codeLanguage = ''
  }

  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([\w+-]+)?\s*$/)

    if (fence) {
      closeParagraph()
      closeList()

      if (!inCode) {
        inCode = true
        codeLanguage = fence[1] || ''
      } else {
        closeCode()
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (/^\s*$/.test(line)) {
      closeParagraph()
      closeList()
      continue
    }

    const heading = line.match(/^\s*(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      closeParagraph()
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    if (/^\s*>/.test(line)) {
      closeParagraph()
      closeList()
      html.push(`<blockquote>${renderInlineMarkdown(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    if (unordered) {
      closeParagraph()
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`)
      continue
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (ordered) {
      closeParagraph()
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`)
      continue
    }

    closeList()
    paragraph.push(line)
  }

  closeParagraph()
  closeList()
  closeCode()

  return html.join('')
}

function loadConversation() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item.question === 'string' && typeof item.answer === 'string')
      .slice(-MAX_TURNS)
  } catch {
    return []
  }
}

function saveConversation() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation.slice(-MAX_TURNS)))
  } catch (error) {
    console.warn('Không thể lưu lịch sử chat:', error)
  }
}

function updateMemoryCount() {
  memoryCount.textContent = `${conversation.length}/${MAX_TURNS} lượt`
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    chatHistory.scrollTop = chatHistory.scrollHeight
  })
}

function createMessageElement(role, text) {
  const row = document.createElement('div')
  row.className = `message-row ${role}`

  const bubble = document.createElement('div')
  bubble.className = 'message-bubble'

  const roleLabel = document.createElement('div')
  roleLabel.className = 'message-role'
  roleLabel.textContent = role === 'user' ? 'Bạn' : 'AI Assistant'

  const content = document.createElement('div')
  content.className = 'message-content'

  if (role === 'assistant') {
    content.innerHTML = markdownToHtml(text)
  } else {
    content.textContent = text
  }

  bubble.append(roleLabel, content)
  row.appendChild(bubble)
  return row
}

function renderConversation() {
  chatHistory.innerHTML = ''

  if (!conversation.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-chat'
    empty.id = 'empty-chat'
    empty.textContent = 'Các câu hỏi và câu trả lời sẽ xuất hiện ở đây.'
    chatHistory.appendChild(empty)
  } else {
    for (const turn of conversation) {
      chatHistory.append(
        createMessageElement('user', turn.question),
        createMessageElement('assistant', turn.answer)
      )
    }
  }

  updateMemoryCount()
  scrollChatToBottom()
}

function appendTypingIndicator() {
  const row = document.createElement('div')
  row.className = 'message-row assistant'
  row.id = 'typing-indicator'

  const bubble = document.createElement('div')
  bubble.className = 'message-bubble typing-bubble'
  bubble.setAttribute('aria-label', 'AI đang suy nghĩ')

  for (let i = 0; i < 3; i += 1) {
    bubble.appendChild(document.createElement('span'))
  }

  row.appendChild(bubble)
  chatHistory.appendChild(row)
  scrollChatToBottom()
}

function removeTypingIndicator() {
  document.getElementById('typing-indicator')?.remove()
}

function setLoading(loading) {
  isSending = loading
  sendButton.disabled = loading
  setupTextarea.disabled = loading
  sendButton.classList.toggle('is-loading', loading)

  if (loading) {
    sendButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>'
    movieBossText.textContent = 'Mình đang suy nghĩ một chút...'
    appendTypingIndicator()
  } else {
    sendButton.innerHTML = '<img src="/images/send-btn-icon.png" alt="Gửi">'
    removeTypingIndicator()
  }
}

function addTurn(question, answer) {
  conversation.push({ question, answer })
  if (conversation.length > MAX_TURNS) {
    conversation = conversation.slice(-MAX_TURNS)
  }
  saveConversation()
  renderConversation()
}

function showError(message) {
  removeTypingIndicator()
  chatHistory.appendChild(createMessageElement('assistant', `**Có lỗi:** ${message}`))
  scrollChatToBottom()
  movieBossText.textContent = 'Có vẻ mình vừa gặp lỗi. Bạn thử gửi lại nhé.'
}

async function sendMessage() {
  if (isSending) return

  const message = setupTextarea.value.trim()
  if (!message) {
    setupTextarea.focus()
    return
  }

  const historyForApi = conversation.slice(-MAX_TURNS).flatMap(turn => ([
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer },
  ]))

  setLoading(true)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: historyForApi,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.error || `Yêu cầu thất bại (${response.status}).`)
    }

    if (!data.reply) {
      throw new Error('API không trả về nội dung trả lời.')
    }

    addTurn(message, data.reply)
    setupTextarea.value = ''
    movieBossText.textContent = 'Mình trả lời xong rồi. Bạn còn câu hỏi nào khác không?'
  } catch (error) {
    console.error(error)
    showError(error.message || 'Không thể kết nối tới máy chủ.')
  } finally {
    setLoading(false)
    setupTextarea.focus()
  }
}

sendButton.addEventListener('click', sendMessage)

setupTextarea.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
})

renderConversation()
setupTextarea.focus()
