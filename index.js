const setupInputContainer = document.getElementById('setup-input-container')
const setupTextarea = document.getElementById('setup-textarea')
const sendButton = document.getElementById('send-btn')
const movieBossText = document.getElementById('movie-boss-text')
const outputContainer = document.getElementById('output-container')
const outputTitle = document.getElementById('output-title')
const outputStars = document.getElementById('output-stars')
const outputText = document.getElementById('output-text')
const outputImageContainer = document.getElementById('output-img-container')

let isSending = false

function setLoading(loading) {
  isSending = loading
  sendButton.disabled = loading
  setupTextarea.disabled = loading
  sendButton.classList.toggle('is-loading', loading)

  if (loading) {
    setupInputContainer.classList.add('loading-state')
    sendButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>'
    movieBossText.textContent = 'Mình đang suy nghĩ một chút...'
  } else {
    setupInputContainer.classList.remove('loading-state')
    sendButton.innerHTML = '<img src="/images/send-btn-icon.png" alt="Gửi">'
  }
}

function showAnswer(reply) {
  outputContainer.classList.add('has-answer')
  outputTitle.textContent = 'Trả lời'
  outputStars.textContent = 'AI Assistant'
  outputText.textContent = reply
  outputImageContainer.innerHTML = ''
  movieBossText.textContent = 'Mình trả lời xong rồi. Bạn còn câu hỏi nào khác không?'
}

function showError(message) {
  outputContainer.classList.add('has-answer')
  outputTitle.textContent = 'Có lỗi'
  outputStars.textContent = 'Không thể nhận phản hồi'
  outputText.textContent = message
  outputImageContainer.innerHTML = ''
  movieBossText.textContent = 'Có vẻ mình vừa gặp lỗi. Bạn thử gửi lại nhé.'
}

async function sendMessage() {
  if (isSending) return

  const message = setupTextarea.value.trim()
  if (!message) {
    setupTextarea.focus()
    return
  }

  setLoading(true)
  outputContainer.classList.remove('has-answer')

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.error || `Yêu cầu thất bại (${response.status}).`)
    }

    if (!data.reply) {
      throw new Error('API không trả về nội dung trả lời.')
    }

    showAnswer(data.reply)
    setupTextarea.value = ''
  } catch (error) {
    console.error(error)
    showError(error.message || 'Không thể kết nối tới máy chủ.')
  } finally {
    setLoading(false)
  }
}

sendButton.addEventListener('click', sendMessage)

setupTextarea.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
})

setupTextarea.focus()
