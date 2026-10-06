import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './share-link.css'

function generateDraftCoupon() {
  const bytes = new Uint8Array(4)
  window.crypto.getRandomValues(bytes)
  return `LUCKY-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

const DEFAULT_CARD = { senderName: 'Impact Vibes', headline: 'A little surprise for you', offerTitle: '25% OFF', description: 'On your next order', couponCode: generateDraftCoupon(), claimUrl: '', accentColor: '#ffb33f', pageColor: '#0b0c1c', textColor: '#ffffff' }

async function requestJson(url, options) {
  let response
  try {
    response = await fetch(url, options)
  } catch {
    throw new Error('The scratch-card server is not running. Stop the old preview and run npm run dev again.')
  }

  const body = await response.text()
  let data = null
  if (body) {
    try { data = JSON.parse(body) }
    catch {
      throw new Error(import.meta.env.PROD
        ? 'The deployed API is not configured correctly. Check the Netlify function and MongoDB Atlas settings, then redeploy.'
        : 'The page is connected to the wrong local server. Restart this project with npm run dev.')
    }
  }

  if (!response.ok) {
    const apiMessage = data?.message
      || data?.errorMessage
      || (typeof data?.error === 'string' ? data.error : data?.error?.message)
    let fallbackMessage = `The scratch-card API returned error ${response.status}.`
    if (import.meta.env.PROD && response.status === 404) {
      fallbackMessage = 'The Netlify backend function was not deployed. Redeploy the complete project instead of uploading only the dist folder.'
    } else if (import.meta.env.PROD && response.status >= 500) {
      fallbackMessage = `The Netlify backend function failed (${response.status}). Check that MONGODB_URI is set in Netlify, then redeploy.`
    }
    const error = new Error(apiMessage || fallbackMessage)
    error.status = response.status
    error.data = data
    throw error
  }
  if (!data) throw new Error('The scratch-card server returned an empty response. Restart this project with npm run dev.')
  return data
}

const GiftIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12v8H4v-8M2 7h20v5H2zM12 7v13M12 7H7.5a2.5 2.5 0 1 1 2.2-3.7L12 7Zm0 0h4.5a2.5 2.5 0 1 0-2.2-3.7L12 7Z" /></svg>
const WhatsAppIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L.2 24l6.5-1.7a11.8 11.8 0 0 0 5.4 1.4c6.5 0 11.8-5.3 11.8-11.8 0-3.2-1.2-6.1-3.4-8.4Zm-8.4 18.2c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 1 1 8.5 4.7Zm5.4-7.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.6l-.9-2.1c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.3 1.4 3.5c.1.2 2.5 3.8 6 5.3 2.2.9 3.1 1 4.2.8.7-.1 1.7-.7 1.9-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3Z" /></svg>

function ScratchCard({ card, onReveal = () => {}, preview = false }) {
  const canvasRef = useRef(null), cardRef = useRef(null), drawing = useRef(false), revealed = useRef(false)
  const [progress, setProgress] = useState(preview ? 100 : 0)
  const prepare = useCallback(() => {
    if (preview || !canvasRef.current || !cardRef.current) return
    const canvas = canvasRef.current, rect = cardRef.current.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2), ctx = canvas.getContext('2d')
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio); canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.globalCompositeOperation = 'source-over'
    const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height)
    gradient.addColorStop(0, '#eef0f5'); gradient.addColorStop(.48, '#a7adbd'); gradient.addColorStop(1, '#f7f8fa')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, rect.width, rect.height); ctx.fillStyle = 'rgba(255,255,255,.24)'
    for (let x = -rect.height; x < rect.width + rect.height; x += 28) { ctx.save(); ctx.translate(x, 0); ctx.rotate(Math.PI / 4); ctx.fillRect(0, -rect.height, 8, rect.height * 3); ctx.restore() }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#42485b'; ctx.font = '700 15px DM Sans, system-ui'; ctx.fillText('✦  SCRATCH HERE  ✦', rect.width / 2, rect.height / 2 - 7)
    ctx.fillStyle = '#62697d'; ctx.font = '500 12px DM Sans, system-ui'; ctx.fillText('Swipe with your finger', rect.width / 2, rect.height / 2 + 18)
    revealed.current = false; setProgress(0)
  }, [preview])
  useEffect(() => { prepare(); if (preview) return; const observer = new ResizeObserver(prepare); observer.observe(cardRef.current); return () => observer.disconnect() }, [prepare, preview])
  const scratch = (event) => {
    if (!drawing.current || revealed.current || preview) return
    event.preventDefault(); const canvas = canvasRef.current, rect = canvas.getBoundingClientRect(), ratio = canvas.width / rect.width, ctx = canvas.getContext('2d')
    ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc((event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio, 29 * ratio, 0, Math.PI * 2); ctx.fill()
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let cleared = 0
    for (let i = 3; i < pixels.length; i += 160) if (pixels[i] === 0) cleared++
    const percent = Math.min(100, Math.round(cleared / (pixels.length / 160) * 100)); setProgress(percent)
    if (percent >= 42) {
      revealed.current = true
      setProgress(100)
      Promise.resolve(onReveal()).then((canReveal) => {
        if (canReveal === false) {
          revealed.current = false
          prepare()
          return
        }
        canvas.classList.add('canvas-revealed')
      }).catch(() => {
        revealed.current = false
        prepare()
      })
    }
  }
  return <div className={`scratch-shell ${preview ? 'is-preview' : ''}`} style={{ '--accent': card.accentColor || DEFAULT_CARD.accentColor }}>
    <i className="ticket-edge left" /><i className="ticket-edge right" />
    <div className="scratch-card" ref={cardRef}><div className="offer-content"><span>YOUR REWARD</span><strong>{card.offerTitle}</strong><p>{card.description}</p>{card.couponCode && <b>USE CODE · {card.couponCode}</b>}</div>
      {!preview && <canvas ref={canvasRef} onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); scratch(e) }} onPointerMove={scratch} onPointerUp={() => drawing.current = false} onPointerCancel={() => drawing.current = false} aria-label="Scratch to reveal your offer" />}
    </div>
    {!preview && <><div className="progress"><span style={{ width: `${progress}%` }} /></div><small>{progress === 100 ? 'Offer unlocked!' : `${progress}% revealed`}</small></>}
  </div>
}

function Creator() {
  const [form, setForm] = useState(DEFAULT_CARD), [result, setResult] = useState(null), [status, setStatus] = useState('idle'), [message, setMessage] = useState('')
  const [usedOpen, setUsedOpen] = useState(false)
  const [coupons, setCoupons] = useState([])
  const [usedStatus, setUsedStatus] = useState('idle')
  const [usedSearch, setUsedSearch] = useState('')
  const [couponFilter, setCouponFilter] = useState('all')
  const update = (e) => setForm(v => ({ ...v, [e.target.name]: e.target.value })), shareUrl = result ? `${location.origin}/card/${result.slug}` : ''
  const createCard = async (e) => { e.preventDefault(); setStatus('saving'); setMessage(''); try { const data = await requestJson('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); setResult(data); setForm(current => ({ ...current, couponCode: generateDraftCoupon() })); setStatus('done') } catch (error) { setMessage(error.message || 'Could not create the card.'); setStatus('error') } }
  const copy = async () => { await navigator.clipboard.writeText(shareUrl); setMessage('Link copied to your clipboard.') }
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(`A surprise is waiting for you! Scratch your card here: ${shareUrl}`)}`, '_blank', 'noopener,noreferrer')
  const loadUsedCoupons = async () => {
    setUsedOpen(true)
    setUsedStatus('loading')
    try {
      const data = await requestJson('/api/admin/coupons')
      setCoupons(data.coupons)
      setUsedStatus('ready')
    } catch (error) {
      setMessage(error.message)
      setUsedStatus('error')
    }
  }
  const filteredCoupons = coupons.filter(item => {
    const matchesStatus = couponFilter === 'all' || (couponFilter === 'used' ? item.used : !item.used)
    return matchesStatus && `${item.couponCode} ${item.offerTitle} ${item.senderName}`.toLowerCase().includes(usedSearch.toLowerCase())
  })
  const usedCount = coupons.filter(item => item.used).length
  return <main className="creator-page"><header><a className="logo" href="/"><span>✦</span> Lucky Drop</a><small>Scratch-card link creator</small></header>
    <div className="creator-layout"><section className="builder"><div className="kicker">CREATE A CARD</div><h1>Turn any offer into a little moment of delight.</h1><p className="lead">Choose what appears under the scratch layer. We’ll create one link you can send anywhere.</p>
      <form onSubmit={createCard}><div className="fields">
        <label><span>From</span><input name="senderName" value={form.senderName} onChange={update} maxLength="50" required /></label>
        <label><span>Message above card</span><input name="headline" value={form.headline} onChange={update} maxLength="80" required /></label>
        <label><span>Main offer</span><input name="offerTitle" value={form.offerTitle} onChange={update} maxLength="30" required /></label>
        <label><span>Offer details</span><input name="description" value={form.description} onChange={update} maxLength="80" required /></label>
        <label><span>Coupon code <em>unique code generated automatically</em></span><div className="coupon-input"><input name="couponCode" value={form.couponCode} onChange={update} maxLength="24" /><button type="button" onClick={() => setForm(current => ({ ...current, couponCode: generateDraftCoupon() }))}>New</button></div></label>
        <label><span>Claim link <em>optional</em></span><input name="claimUrl" value={form.claimUrl} onChange={update} type="url" placeholder="https://yourwebsite.com" /></label>
      </div><fieldset className="theme-panel"><legend>Card theme</legend><div className="theme-controls"><label><span>Page background</span><div><input name="pageColor" value={form.pageColor} onChange={update} type="color" /><b>{form.pageColor}</b></div></label><label><span>Message text</span><div><input name="textColor" value={form.textColor} onChange={update} type="color" /><b>{form.textColor}</b></div></label><label><span>Scratch card</span><div><input name="accentColor" value={form.accentColor} onChange={update} type="color" /><b>{form.accentColor}</b></div></label></div></fieldset>
      <button className="primary" disabled={status === 'saving'}>{status === 'saving' ? 'Creating your link…' : 'Create scratch-card link'}</button>{status === 'error' && <p className="error">{message}</p>}</form>
      <section className="used-coupons-panel"><div className="used-coupons-heading"><div><span>COUPON ACTIVITY</span><h2>All coupon codes</h2></div><button type="button" onClick={loadUsedCoupons}>{usedOpen ? 'Refresh list' : 'View coupons'}</button></div>
        {usedOpen && <div className="used-coupons-content">{usedStatus === 'loading' && <p className="used-empty">Loading coupons…</p>}{usedStatus === 'error' && <p className="used-empty">Could not load the coupon history.</p>}{usedStatus === 'ready' && <><div className="coupon-stats"><div><strong>{coupons.length}</strong><span>Created</span></div><div><strong>{usedCount}</strong><span>Used</span></div><div><strong>{coupons.length - usedCount}</strong><span>Waiting</span></div></div><div className="coupon-filters"><button className={couponFilter === 'all' ? 'active' : ''} onClick={() => setCouponFilter('all')}>All</button><button className={couponFilter === 'used' ? 'active' : ''} onClick={() => setCouponFilter('used')}>Used</button><button className={couponFilter === 'waiting' ? 'active' : ''} onClick={() => setCouponFilter('waiting')}>Waiting</button></div>{coupons.length > 0 && <input className="coupon-search" value={usedSearch} onChange={event => setUsedSearch(event.target.value)} placeholder="Search coupon, offer or sender" aria-label="Search coupon activity" />}{filteredCoupons.length === 0 ? <p className="used-empty">No matching coupons found.</p> : <div className="coupon-list">{filteredCoupons.map(item => <article className="coupon-row" key={item.slug}><div><strong>{item.couponCode}</strong><span>{item.offerTitle} · {item.senderName}</span></div><div className="coupon-row-status"><span className={`status-pill ${item.used ? 'is-used' : 'is-waiting'}`}>{item.used ? 'Used' : 'Waiting'}</span>{!item.used && <a className="use-coupon-link" href={`/card/${item.slug}`} target="_blank" rel="noreferrer">Use this coupon</a>}<time dateTime={item.redeemedAt || item.createdAt}>{new Date(item.redeemedAt || item.createdAt).toLocaleString()}</time></div></article>)}</div>}</>}</div>}
      </section>
    </section><aside className="preview"><div className="preview-title"><span>LIVE PREVIEW</span><span>Recipient view</span></div><div className="phone" style={{ '--page-color': form.pageColor, '--text-color': form.textColor, '--accent': form.accentColor }}><div className="phone-brand">✦ {form.senderName || 'Your brand'}</div><div className="mini"><GiftIcon /> SURPRISE</div><h2>{form.headline || 'A little surprise for you'}</h2><ScratchCard card={form} preview /><small>Silver scratch layer appears on the shared card</small></div></aside></div>
    {result && <div className="backdrop" role="dialog" aria-modal="true"><div className="modal"><div className="success">✓</div><div className="kicker">READY TO SHARE</div><h2>Your scratch card is live.</h2><p>Anyone with this link can open and scratch the card.</p><div className="created-code"><span>Unique coupon</span><strong>{result.couponCode}</strong></div><div className="link-box"><span>{shareUrl}</span><button onClick={copy}>Copy</button></div>{message && <p className="copied">{message}</p>}<div className="modal-actions"><button className="wa" onClick={whatsapp}><WhatsAppIcon /> Share on WhatsApp</button><a href={`/card/${result.slug}`} target="_blank" rel="noreferrer">Open card</a></div><button className="again" onClick={() => { setResult(null); setMessage('') }}>Create another card</button></div></div>}
  </main>
}

function PublicCard({ slug }) {
  const [card, setCard] = useState(null)
  const [state, setState] = useState('loading')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [claimError, setClaimError] = useState('')
  useEffect(() => { requestJson(`/api/cards/${encodeURIComponent(slug)}`).then(data => { setCard(data); setState(data.used ? 'used' : 'ready') }).catch(() => setState('error')) }, [slug])
  if (state === 'loading') return <main className="recipient status"><div className="loader" /><p>Getting your surprise ready…</p></main>
  if (state === 'error') return <main className="recipient status"><div className="broken">?</div><h1>This card could not be found.</h1><p>Check that the shared link is complete.</p><a href="/">Create a scratch card</a></main>
  if (state === 'used') return <main className="recipient status used-card" style={{ '--accent': card?.accentColor }}><div className="used-icon">✓</div><h1>This coupon has already been used.</h1><p>Each scratch-card link can reveal its reward only once.</p><a href="/">Create a new scratch card</a></main>
  const share = () => window.open(`https://wa.me/?text=${encodeURIComponent(`I found ${card.offerTitle}! Try this scratch card: ${location.href}`)}`, '_blank', 'noopener,noreferrer')
  const claimHost = card.claimUrl ? new URL(card.claimUrl).hostname.replace(/^www\./, '') : ''
  const openClaimLink = () => window.location.assign(card.claimUrl)
  const claimCoupon = async () => {
    setState('claiming')
    setClaimError('')
    try {
      const result = await requestJson(`/api/cards/${encodeURIComponent(slug)}/claim`, { method: 'POST' })
      setCard(current => ({ ...current, couponCode: result.couponCode }))
      setRevealed(true)
      setState('ready')
      return true
    } catch (error) {
      if (error.status === 409) setState('used')
      else {
        setClaimError(error.message)
        setState('ready')
      }
      return false
    }
  }
  const copyShareLink = async () => {
    await navigator.clipboard.writeText(location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2500)
  }
  return <main className="recipient" style={{ '--accent': card.accentColor || DEFAULT_CARD.accentColor, '--page-color': card.pageColor || DEFAULT_CARD.pageColor, '--text-color': card.textColor || DEFAULT_CARD.textColor }}><div className="glow one" /><div className="glow two" /><section className="experience"><a className="recipient-brand" href="/"><span>✦</span> {card.senderName}</a><div className="eyebrow"><GiftIcon /> A surprise was sent to you</div><h1>{card.headline}</h1><p className="intro">Scratch the silver surface with your finger or mouse to reveal it.</p><ScratchCard card={card} onReveal={claimCoupon} />{state === 'claiming' && <p className="claim-status">Securing your one-time coupon…</p>}{claimError && <p className="claim-error" role="alert">{claimError} Please scratch again.</p>}<div className="recipient-actions">{revealed && card.claimUrl && <button className="claim" onClick={openClaimLink}>Claim offer on {claimHost}</button>}<button className="share" onClick={share} disabled={!revealed}><WhatsAppIcon /> {revealed ? 'Share on WhatsApp' : 'Reveal to share'}</button>{revealed && <div className="public-share-link"><span title={location.href}>{location.href}</span><button onClick={copyShareLink}>{copied ? 'Copied!' : 'Copy link'}</button></div>}</div><p className="privacy">Created with Lucky Drop · One-time reward</p></section></main>
}

function App() { const slug = useMemo(() => location.pathname.match(/^\/card\/([\w-]+)\/?$/)?.[1], []); return slug ? <PublicCard slug={slug} /> : <Creator /> }
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
