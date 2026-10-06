import { app, connectDatabase } from '../server/index.js'

export default async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, 'http://localhost')
    const forwardedPath = requestUrl.searchParams.get('path')

    if (forwardedPath) {
      requestUrl.searchParams.delete('path')
      const remainingQuery = requestUrl.searchParams.toString()
      req.url = `/api/${forwardedPath}${remainingQuery ? `?${remainingQuery}` : ''}`
    }

    await connectDatabase()
    return app(req, res)
  } catch (error) {
    console.error('Vercel API error:', error.message)
    return res.status(500).json({ message: error.message || 'The deployed API could not start.' })
  }
}
