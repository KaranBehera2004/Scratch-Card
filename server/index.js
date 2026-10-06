import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'

const rootDir = process.cwd()
const dataDir = path.join(rootDir, 'server', 'data')
const dataFile = path.join(dataDir, 'cards.json')
export const app = express()
const port = Number(process.env.PORT) || 5050

app.disable('x-powered-by')
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }))
app.use(express.json({ limit: '20kb' }))

const schema = new mongoose.Schema({
  slug: { type: String, unique: true, index: true, required: true },
  senderName: { type: String, required: true, maxlength: 50 },
  headline: { type: String, required: true, maxlength: 80 },
  offerTitle: { type: String, required: true, maxlength: 30 },
  description: { type: String, required: true, maxlength: 80 },
  couponCode: { type: String, required: true, maxlength: 24 },
  claimUrl: { type: String, maxlength: 500, default: '' },
  accentColor: { type: String, default: '#ffb33f' },
  pageColor: { type: String, default: '#0b0c1c' },
  textColor: { type: String, default: '#ffffff' },
  redeemedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false, autoIndex: false })
const Card = mongoose.model('Card', schema)
let atlasConnected = false
let databasePromise = null
let localClaimQueue = Promise.resolve()
let localCreateQueue = Promise.resolve()

const generateCouponCode = () => `LUCKY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`

export function connectDatabase() {
  if (atlasConnected) return Promise.resolve()
  if (databasePromise) return databasePromise

  databasePromise = initializeDatabase().catch((error) => {
    databasePromise = null
    throw error
  })
  return databasePromise
}

async function initializeDatabase() {
  if (!process.env.MONGODB_URI && (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
    throw new Error('MongoDB Atlas is not configured. Add MONGODB_URI in Netlify environment variables and redeploy.')
  }
  if (!process.env.MONGODB_URI) {
    await fs.mkdir(dataDir, { recursive: true })
    await normalizeLocalCoupons()
    console.log('Storage: local JSON (add MONGODB_URI to use MongoDB Atlas)')
    return
  }
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'scratch_cards' })
  await normalizeMongoCoupons()
  await Card.collection.createIndex({ couponCode: 1 }, { unique: true, name: 'unique_coupon_code' })
  atlasConnected = true
  console.log('Storage: MongoDB Atlas')
}

async function readLocalCards() {
  try { return JSON.parse(await fs.readFile(dataFile, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function normalizeLocalCoupons() {
  const cards = await readLocalCards()
  const usedCodes = new Set()
  let changed = false
  for (const card of cards) {
    let code = clean(card.couponCode, 24).toUpperCase()
    while (!code || usedCodes.has(code)) { code = generateCouponCode(); changed = true }
    if (card.couponCode !== code) { card.couponCode = code; changed = true }
    usedCodes.add(code)
  }
  if (changed) await fs.writeFile(dataFile, JSON.stringify(cards, null, 2))
}
async function normalizeMongoCoupons() {
  const cards = await Card.find().sort({ createdAt: 1, _id: 1 }).lean()
  const usedCodes = new Set()
  for (const card of cards) {
    let code = clean(card.couponCode, 24).toUpperCase()
    while (!code || usedCodes.has(code)) code = generateCouponCode()
    if (card.couponCode !== code) await Card.updateOne({ _id: card._id }, { $set: { couponCode: code } })
    usedCodes.add(code)
  }
}
async function saveCard(card, requestedCode) {
  if (atlasConnected) {
    const candidate = { ...card, couponCode: requestedCode || generateCouponCode() }
    try { return await Card.create(candidate) }
    catch (error) {
      if (error.code === 11000) {
        if (requestedCode) { const duplicate = new Error('This coupon code already exists. Choose another code or leave it blank.'); duplicate.code = 'DUPLICATE_COUPON'; throw duplicate }
        return saveCard(card, '')
      }
      throw error
    }
  }
  const save = localCreateQueue.then(async () => {
    const cards = await readLocalCards()
    const usedCodes = new Set(cards.map(item => clean(item.couponCode, 24).toUpperCase()))
    if (requestedCode && usedCodes.has(requestedCode)) { const duplicate = new Error('This coupon code already exists. Choose another code or leave it blank.'); duplicate.code = 'DUPLICATE_COUPON'; throw duplicate }
    let couponCode = requestedCode || generateCouponCode()
    while (usedCodes.has(couponCode)) couponCode = generateCouponCode()
    const savedCard = { ...card, couponCode, createdAt: new Date().toISOString() }
    cards.push(savedCard)
    await fs.writeFile(dataFile, JSON.stringify(cards, null, 2))
    return savedCard
  })
  localCreateQueue = save.catch(() => {})
  return save
}
async function findCard(slug) { return atlasConnected ? Card.findOne({ slug }).lean() : (await readLocalCards()).find(card => card.slug === slug) }
async function findRedeemedCoupons() {
  if (atlasConnected) {
    return Card.find({ redeemedAt: { $ne: null } })
      .select('slug couponCode offerTitle senderName redeemedAt')
      .sort({ redeemedAt: -1 })
      .lean()
  }
  return (await readLocalCards())
    .filter(card => card.redeemedAt)
    .sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt))
    .map(({ slug, couponCode, offerTitle, senderName, redeemedAt }) => ({ slug, couponCode, offerTitle, senderName, redeemedAt }))
}
async function findAllCoupons() {
  const cards = atlasConnected
    ? await Card.find().select('slug couponCode offerTitle senderName createdAt redeemedAt').sort({ createdAt: -1 }).lean()
    : (await readLocalCards()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return cards.map(({ slug, couponCode, offerTitle, senderName, createdAt, redeemedAt }) => ({
    slug, couponCode, offerTitle, senderName, createdAt, redeemedAt: redeemedAt || null, used: Boolean(redeemedAt),
  }))
}
async function claimLocalCard(slug) {
  const claim = localClaimQueue.then(async () => {
    const cards = await readLocalCards()
    const index = cards.findIndex(card => card.slug === slug)
    if (index === -1) return { status: 'missing' }
    if (cards[index].redeemedAt) return { status: 'used' }
    cards[index].redeemedAt = new Date().toISOString()
    await fs.writeFile(dataFile, JSON.stringify(cards, null, 2))
    return { status: 'claimed', card: cards[index] }
  })
  localClaimQueue = claim.catch(() => {})
  return claim
}
async function claimCard(slug) {
  if (!atlasConnected) return claimLocalCard(slug)
  const card = await Card.findOneAndUpdate(
    { slug, $or: [{ redeemedAt: null }, { redeemedAt: { $exists: false } }] },
    { $set: { redeemedAt: new Date() } },
    { new: true },
  ).lean()
  if (card) return { status: 'claimed', card }
  return { status: await Card.exists({ slug }) ? 'used' : 'missing' }
}
function publicCard(card) {
  const { _id, couponCode, ...safeCard } = card
  return { ...safeCard, used: Boolean(card.redeemedAt), redeemedAt: undefined }
}
const clean = (value, max) => String(value ?? '').trim().slice(0, max)
const safeUrl = (value) => {
  const raw = clean(value, 500); if (!raw) return ''
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Claim link must use http or https.')
  return parsed.toString()
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: atlasConnected ? 'mongodb-atlas' : 'local-json' }))
app.get('/api/admin/redeemed-coupons', async (_req, res, next) => {
  try {
    const coupons = await findRedeemedCoupons()
    res.json({ coupons, count: coupons.length })
  } catch (error) { next(error) }
})
app.get('/api/admin/coupons', async (_req, res, next) => {
  try {
    const coupons = await findAllCoupons()
    const usedCount = coupons.filter(coupon => coupon.used).length
    res.json({ coupons, count: coupons.length, usedCount, waitingCount: coupons.length - usedCount })
  } catch (error) { next(error) }
})
app.post('/api/cards', async (req, res, next) => {
  try {
    const requestedCouponCode = clean(req.body.couponCode, 24).toUpperCase()
    const card = {
      slug: crypto.randomBytes(6).toString('base64url'),
      senderName: clean(req.body.senderName, 50), headline: clean(req.body.headline, 80),
      offerTitle: clean(req.body.offerTitle, 30), description: clean(req.body.description, 80),
      claimUrl: safeUrl(req.body.claimUrl),
      accentColor: /^#[0-9a-f]{6}$/i.test(req.body.accentColor) ? req.body.accentColor : '#ffb33f',
      pageColor: /^#[0-9a-f]{6}$/i.test(req.body.pageColor) ? req.body.pageColor : '#0b0c1c',
      textColor: /^#[0-9a-f]{6}$/i.test(req.body.textColor) ? req.body.textColor : '#ffffff',
    }
    if (!card.senderName || !card.headline || !card.offerTitle || !card.description) return res.status(400).json({ message: 'Please complete all required fields.' })
    const savedCard = await saveCard(card, requestedCouponCode)
    res.status(201).json({ slug: savedCard.slug, couponCode: savedCard.couponCode })
  } catch (error) { next(error) }
})
app.get('/api/cards/:slug', async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug)) return res.status(404).json({ message: 'Card not found.' })
    const card = await findCard(req.params.slug); if (!card) return res.status(404).json({ message: 'Card not found.' })
    res.json(publicCard(card))
  } catch (error) { next(error) }
})
app.post('/api/cards/:slug/claim', async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug)) return res.status(404).json({ message: 'Card not found.' })
    const result = await claimCard(req.params.slug)
    if (result.status === 'missing') return res.status(404).json({ message: 'Card not found.' })
    if (result.status === 'used') return res.status(409).json({ message: 'This coupon has already been revealed and used.', used: true })
    res.json({ couponCode: result.card.couponCode, redeemedAt: result.card.redeemedAt })
  } catch (error) { next(error) }
})

const isLocalServer = !process.env.NETLIFY
  && !process.env.AWS_LAMBDA_FUNCTION_NAME
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.join(rootDir, 'server', 'index.js')
if (isLocalServer) {
  app.use(express.static(path.join(rootDir, 'dist')))
  app.get('/*splat', (_req, res) => res.sendFile(path.join(rootDir, 'dist', 'index.html')))
}
app.use((error, _req, res, _next) => {
  console.error(error.message)
  if (error.code === 'DUPLICATE_COUPON' || error.code === 11000) return res.status(409).json({ message: 'This coupon code already exists. Choose another code or leave it blank.' })
  res.status(400).json({ message: error.message || 'Something went wrong.' })
})

if (isLocalServer) {
  connectDatabase().then(() => app.listen(port, () => console.log(`Lucky Drop API: http://localhost:${port}`))).catch(error => { console.error('Database connection failed:', error.message); process.exit(1) })
}
