import serverless from 'serverless-http'
import { app, connectDatabase } from '../../server/index.js'

const handleExpressRequest = serverless(app)

export const handler = async (event, context) => {
  try {
    await connectDatabase()
    return await handleExpressRequest(event, context)
  } catch (error) {
    console.error('Netlify API error:', error.message)
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: error.message || 'The deployed API could not start.' }),
    }
  }
}
