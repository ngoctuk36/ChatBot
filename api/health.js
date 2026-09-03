export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(200).json({
    ok: true,
    model: process.env.GROQ_MODEL || null,
    configured: Boolean(process.env.GROQ_API_KEY),
  })
}
