import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './share-link.css'

const TRANSLATIONS = {
  en: {
    language: 'Language', creatorTagline: 'Scratch-card link creator', createKicker: 'CREATE A CARD',
    heroTitle: 'Turn any offer into a little moment of delight.', heroLead: 'Choose what appears under the scratch layer. We’ll create one link you can send anywhere.',
    from: 'From', messageAbove: 'Message above card', mainOffer: 'Main offer', offerDetails: 'Offer details', couponCode: 'Coupon code', uniqueAuto: 'unique code generated automatically', newCode: 'New', claimLink: 'Claim link', optional: 'optional',
    cardTheme: 'Card theme', pageBackground: 'Page background', messageText: 'Message text', scratchCard: 'Scratch card', creating: 'Creating your link…', createLink: 'Create scratch-card link',
    couponActivity: 'COUPON ACTIVITY', allCouponCodes: 'All coupon codes', refresh: 'Refresh list', viewCoupons: 'View coupons', exportExcel: 'Export Excel', exporting: 'Exporting…',
    loadingCoupons: 'Loading coupons…', couponLoadError: 'Could not load the coupon history.', created: 'Created', used: 'Used', waiting: 'Waiting', all: 'All', searchCoupons: 'Search coupon, offer or sender', noMatches: 'No matching coupons found.', useCoupon: 'Use this coupon',
    livePreview: 'LIVE PREVIEW', recipientView: 'Recipient view', yourBrand: 'Your brand', surprise: 'SURPRISE', previewHeadline: 'A little surprise for you', scratchLayer: 'Silver scratch layer appears on the shared card',
    readyShare: 'READY TO SHARE', cardLive: 'Your scratch card is live.', anyoneCanOpen: 'Anyone with this link can open and scratch the card.', uniqueCoupon: 'Unique coupon', copy: 'Copy', linkCopied: 'Link copied to your clipboard.', shareWhatsApp: 'Share on WhatsApp', openCard: 'Open card', createAnother: 'Create another card',
    reward: 'YOUR REWARD', useCode: 'USE CODE', scratchHere: 'SCRATCH HERE', swipeFinger: 'Swipe with your finger', unlocked: 'Offer unlocked!', revealed: 'revealed', scratchLabel: 'Scratch to reveal your offer',
    gettingReady: 'Getting your surprise ready…', notFound: 'This card could not be found.', checkLink: 'Check that the shared link is complete.', createCard: 'Create a scratch card', alreadyUsed: 'This coupon has already been used.', oneReveal: 'Each scratch-card link can reveal its reward only once.', createNew: 'Create a new scratch card',
    sentToYou: 'A surprise was sent to you', scratchInstruction: 'Scratch the silver surface with your finger or mouse to reveal it.', securing: 'Securing your one-time coupon…', scratchAgain: 'Please scratch again.', claimOn: 'Claim offer on', revealToShare: 'Reveal to share', copied: 'Copied!', copyLink: 'Copy link', privacy: 'Created with Lucky Drop · One-time reward', exportError: 'Could not create the Excel file.', noCouponsExport: 'There are no coupon codes to export.', excelSheet: 'Coupons', excelHeaders: ['Coupon code', 'Offer', 'Sender', 'Status', 'Created at', 'Redeemed at', 'Card link'],
  },
  hi: {
    language: 'भाषा', creatorTagline: 'स्क्रैच-कार्ड लिंक निर्माता', createKicker: 'कार्ड बनाएँ',
    heroTitle: 'किसी भी ऑफर को एक खास खुशी में बदलें।', heroLead: 'स्क्रैच परत के नीचे क्या दिखेगा चुनें। हम साझा करने के लिए एक लिंक बनाएँगे।',
    from: 'भेजने वाला', messageAbove: 'कार्ड के ऊपर संदेश', mainOffer: 'मुख्य ऑफर', offerDetails: 'ऑफर विवरण', couponCode: 'कूपन कोड', uniqueAuto: 'अलग कोड अपने आप बनेगा', newCode: 'नया', claimLink: 'क्लेम लिंक', optional: 'वैकल्पिक',
    cardTheme: 'कार्ड थीम', pageBackground: 'पेज का रंग', messageText: 'संदेश का रंग', scratchCard: 'स्क्रैच कार्ड', creating: 'लिंक बन रहा है…', createLink: 'स्क्रैच-कार्ड लिंक बनाएँ',
    couponActivity: 'कूपन गतिविधि', allCouponCodes: 'सभी कूपन कोड', refresh: 'सूची रीफ़्रेश करें', viewCoupons: 'कूपन देखें', exportExcel: 'Excel डाउनलोड करें', exporting: 'डाउनलोड बन रहा है…',
    loadingCoupons: 'कूपन लोड हो रहे हैं…', couponLoadError: 'कूपन इतिहास लोड नहीं हुआ।', created: 'बनाए गए', used: 'उपयोग किए गए', waiting: 'उपलब्ध', all: 'सभी', searchCoupons: 'कूपन, ऑफर या भेजने वाला खोजें', noMatches: 'कोई मेल खाता कूपन नहीं मिला।', useCoupon: 'यह कूपन उपयोग करें',
    livePreview: 'लाइव पूर्वावलोकन', recipientView: 'प्राप्तकर्ता दृश्य', yourBrand: 'आपका ब्रांड', surprise: 'सरप्राइज़', previewHeadline: 'आपके लिए एक छोटा सा सरप्राइज़', scratchLayer: 'साझा कार्ड पर सिल्वर स्क्रैच परत दिखाई देगी',
    readyShare: 'साझा करने के लिए तैयार', cardLive: 'आपका स्क्रैच कार्ड तैयार है।', anyoneCanOpen: 'इस लिंक वाला कोई भी व्यक्ति कार्ड खोलकर स्क्रैच कर सकता है।', uniqueCoupon: 'विशिष्ट कूपन', copy: 'कॉपी करें', linkCopied: 'लिंक क्लिपबोर्ड पर कॉपी हो गया।', shareWhatsApp: 'WhatsApp पर साझा करें', openCard: 'कार्ड खोलें', createAnother: 'दूसरा कार्ड बनाएँ',
    reward: 'आपका इनाम', useCode: 'कोड इस्तेमाल करें', scratchHere: 'यहाँ स्क्रैच करें', swipeFinger: 'अपनी उंगली से स्वाइप करें', unlocked: 'ऑफर खुल गया!', revealed: 'खुला', scratchLabel: 'ऑफर देखने के लिए स्क्रैच करें',
    gettingReady: 'आपका सरप्राइज़ तैयार हो रहा है…', notFound: 'यह कार्ड नहीं मिला।', checkLink: 'जाँचें कि साझा लिंक पूरा है।', createCard: 'स्क्रैच कार्ड बनाएँ', alreadyUsed: 'यह कूपन पहले ही उपयोग किया जा चुका है।', oneReveal: 'हर स्क्रैच-कार्ड लिंक केवल एक बार इनाम दिखाता है।', createNew: 'नया स्क्रैच कार्ड बनाएँ',
    sentToYou: 'आपके लिए एक सरप्राइज़ भेजा गया है', scratchInstruction: 'इनाम देखने के लिए उंगली या माउस से सिल्वर सतह स्क्रैच करें।', securing: 'आपका एक-बार उपयोग वाला कूपन सुरक्षित किया जा रहा है…', scratchAgain: 'कृपया फिर से स्क्रैच करें।', claimOn: 'ऑफर क्लेम करें', revealToShare: 'साझा करने के लिए खोलें', copied: 'कॉपी हो गया!', copyLink: 'लिंक कॉपी करें', privacy: 'Lucky Drop से बनाया गया · एक बार का इनाम', exportError: 'Excel फ़ाइल नहीं बन सकी।', noCouponsExport: 'निर्यात के लिए कोई कूपन नहीं है।', excelSheet: 'कूपन', excelHeaders: ['कूपन कोड', 'ऑफर', 'भेजने वाला', 'स्थिति', 'बनाने की तारीख', 'उपयोग की तारीख', 'कार्ड लिंक'],
  },
  te: {
    language: 'భాష', creatorTagline: 'స్క్రాచ్-కార్డ్ లింక్ క్రియేటర్', createKicker: 'కార్డ్ సృష్టించండి',
    heroTitle: 'ఇ\u00A0ఆఫర్ ఒక చిన్న ఆనంద క్షణంగా మార్చండి.', heroLead: 'స్క్రాచ్ పొర కింద ఏమి కనిపించాలో ఎంచుకోండి. ఎక్కడైనా పంపగల లింక్‌ను మేము సృష్టిస్తాము.',
    from: 'పంపినవారు', messageAbove: 'కార్డ్ పైన సందేశం', mainOffer: 'ప్రధాన ఆఫర్', offerDetails: 'ఆఫర్ వివరాలు', couponCode: 'కూపన్ కోడ్', uniqueAuto: 'ప్రత్యేక కోడ్ స్వయంచాలకంగా సృష్టించబడుతుంది', newCode: 'కొత్తది', claimLink: 'క్లెయిమ్ లింక్', optional: 'ఐచ్ఛికం',
    cardTheme: 'కార్డ్ థీమ్', pageBackground: 'పేజీ రంగు', messageText: 'సందేశం రంగు', scratchCard: 'స్క్రాచ్ కార్డ్', creating: 'లింక్ సృష్టిస్తోంది…', createLink: 'స్క్రాచ్-కార్డ్ లింక్ సృష్టించండి',
    couponActivity: 'కూపన్ కార్యకలాపం', allCouponCodes: 'అన్ని కూపన్ కోడ్‌లు', refresh: 'జాబితాను రిఫ్రెష్ చేయండి', viewCoupons: 'కూపన్‌లు చూడండి', exportExcel: 'Excel డౌన్‌లోడ్', exporting: 'ఎక్స్‌పోర్ట్ అవుతోంది…',
    loadingCoupons: 'కూపన్‌లు లోడ్ అవుతున్నాయి…', couponLoadError: 'కూపన్ చరిత్ర లోడ్ కాలేదు.', created: 'సృష్టించినవి', used: 'వాడినవి', waiting: 'అందుబాటులో', all: 'అన్నీ', searchCoupons: 'కూపన్, ఆఫర్ లేదా పంపినవారిని వెతకండి', noMatches: 'సరిపోలే కూపన్‌లు లేవు.', useCoupon: 'ఈ కూపన్ ఉపయోగించండి',
    livePreview: 'లైవ్ ప్రివ్యూ', recipientView: 'గ్రహీత వీక్షణ', yourBrand: 'మీ బ్రాండ్', surprise: 'సర్‌ప్రైజ్', previewHeadline: 'మీ కోసం ఒక చిన్న సర్‌ప్రైజ్', scratchLayer: 'షేర్ చేసిన కార్డ్‌పై సిల్వర్ స్క్రాచ్ పొర కనిపిస్తుంది',
    readyShare: 'షేర్ చేయడానికి సిద్ధం', cardLive: 'మీ స్క్రాచ్ కార్డ్ సిద్ధంగా ఉంది.', anyoneCanOpen: 'ఈ లింక్ ఉన్న ఎవరైనా కార్డ్‌ను తెరిచి స్క్రాచ్ చేయవచ్చు.', uniqueCoupon: 'ప్రత్యేక కూపన్', copy: 'కాపీ', linkCopied: 'లింక్ క్లిప్‌బోర్డ్‌కు కాపీ అయింది.', shareWhatsApp: 'WhatsAppలో షేర్ చేయండి', openCard: 'కార్డ్ తెరవండి', createAnother: 'మరొక కార్డ్ సృష్టించండి',
    reward: 'మీ బహుమతి', useCode: 'కోడ్ ఉపయోగించండి', scratchHere: 'ఇక్కడ స్క్రాచ్ చేయండి', swipeFinger: 'వేలితో స్వైప్ చేయండి', unlocked: 'ఆఫర్ తెరుచుకుంది!', revealed: 'తెరచింది', scratchLabel: 'ఆఫర్ చూడటానికి స్క్రాచ్ చేయండి',
    gettingReady: 'మీ సర్‌ప్రైజ్ సిద్ధమవుతోంది…', notFound: 'ఈ కార్డ్ కనబడలేదు.', checkLink: 'షేర్ చేసిన లింక్ పూర్తిగా ఉందో చూడండి.', createCard: 'స్క్రాచ్ కార్డ్ సృష్టించండి', alreadyUsed: 'ఈ కూపన్ ఇప్పటికే ఉపయోగించబడింది.', oneReveal: 'ప్రతి స్క్రాచ్-కార్డ్ లింక్ బహుమతిని ఒక్కసారి మాత్రమే చూపిస్తుంది.', createNew: 'కొత్త స్క్రాచ్ కార్డ్ సృష్టించండి',
    sentToYou: 'మీకు ఒక సర్‌ప్రైజ్ పంపబడింది', scratchInstruction: 'బహుమతిని చూడటానికి వెండి ఉపరితలాన్ని వేలితో లేదా మౌస్‌తో స్క్రాచ్ చేయండి.', securing: 'మీ ఒక్కసారి ఉపయోగించే కూపన్‌ను భద్రపరుస్తోంది…', scratchAgain: 'దయచేసి మళ్లీ స్క్రాచ్ చేయండి.', claimOn: 'ఆఫర్‌ను క్లెయిమ్ చేయండి', revealToShare: 'షేర్ చేయడానికి తెరవండి', copied: 'కాపీ అయింది!', copyLink: 'లింక్ కాపీ', privacy: 'Lucky Dropతో రూపొందించబడింది · ఒక్కసారి బహుమతి', exportError: 'Excel ఫైల్ సృష్టించలేకపోయాం.', noCouponsExport: 'ఎక్స్‌పోర్ట్ చేయడానికి కూపన్‌లు లేవు.', excelSheet: 'కూపన్లు', excelHeaders: ['కూపన్ కోడ్', 'ఆఫర్', 'పంపినవారు', 'స్థితి', 'సృష్టించిన తేదీ', 'ఉపయోగించిన తేదీ', 'కార్డ్ లింక్'],
  },
}

function LanguageSelect({ language, setLanguage, floating = false }) {
  return <label className={`language-select ${floating ? 'is-floating' : ''}`}>
    <span>{TRANSLATIONS[language].language}</span>
    <select value={language} onChange={event => setLanguage(event.target.value)} aria-label={TRANSLATIONS[language].language}>
      <option value="en">English</option>
      <option value="hi">हिन्दी</option>
      <option value="te">తెలుగు</option>
    </select>
  </label>
}

const CELEBRATION_COLORS = ['#6c63ff', '#ff745f', '#ffc34d', '#53d990', '#52acef', '#cc58ef']
const CONFETTI_PIECES = Array.from({ length: 46 }, (_, index) => ({
  id: index,
  color: CELEBRATION_COLORS[index % CELEBRATION_COLORS.length],
  left: `${(index * 37 + 5) % 96}%`,
  delay: `${(index % 10) * 0.07}s`,
  duration: `${2.2 + (index % 6) * 0.18}s`,
  drift: `${((index * 19) % 90) - 45}px`,
  rotation: `${(index * 47) % 270}deg`,
}))
const CELEBRATION_TICKETS = [
  { color: '#6669f6', left: '10%', delay: '.08s', rotation: '-14deg' },
  { color: '#f8b93e', left: '28%', delay: '.22s', rotation: '9deg' },
  { color: '#c454e7', left: '47%', delay: '.04s', rotation: '-8deg' },
  { color: '#5aa7ec', left: '68%', delay: '.18s', rotation: '13deg' },
  { color: '#fa7568', left: '84%', delay: '.12s', rotation: '-11deg' },
]

function Celebration() {
  return <div className="arrival-celebration" aria-hidden="true">
    {CONFETTI_PIECES.map(piece => <i className="confetti-piece" key={piece.id} style={{ '--piece-color': piece.color, '--piece-left': piece.left, '--piece-delay': piece.delay, '--piece-duration': piece.duration, '--piece-drift': piece.drift, '--piece-rotation': piece.rotation }} />)}
    {CELEBRATION_TICKETS.map((ticket, index) => <i className="celebration-ticket" key={ticket.left} style={{ '--ticket-color': ticket.color, '--ticket-left': ticket.left, '--ticket-delay': ticket.delay, '--ticket-rotation': ticket.rotation }}><span /></i>)}
  </div>
}

function RecipientTopbar({ brand, language, setLanguage }) {
  return <header className="recipient-topbar">
    <a className="recipient-brand" href="/"><span>✦</span> {brand}</a>
    <LanguageSelect language={language} setLanguage={setLanguage} />
  </header>
}

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
        ? 'The deployed API is not configured correctly. Check the backend function and MongoDB Atlas settings, then redeploy.'
        : 'The page is connected to the wrong local server. Restart this project with npm run dev.')
    }
  }

  if (!response.ok) {
    const apiMessage = data?.message
      || data?.errorMessage
      || (typeof data?.error === 'string' ? data.error : data?.error?.message)
    let fallbackMessage = `The scratch-card API returned error ${response.status}.`
    if (import.meta.env.PROD && response.status === 404) {
      fallbackMessage = 'The backend function was not deployed. Redeploy the complete project instead of uploading only the dist folder.'
    } else if (import.meta.env.PROD && response.status >= 500) {
      fallbackMessage = `The deployed backend function failed (${response.status}). Check that MONGODB_URI is configured in your hosting environment, then redeploy.`
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

function ScratchCard({ card, onReveal = () => {}, preview = false, t }) {
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
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#42485b'; ctx.font = '700 15px DM Sans, system-ui'; ctx.fillText(`✦  ${t('scratchHere')}  ✦`, rect.width / 2, rect.height / 2 - 7)
    ctx.fillStyle = '#62697d'; ctx.font = '500 12px DM Sans, system-ui'; ctx.fillText(t('swipeFinger'), rect.width / 2, rect.height / 2 + 18)
    revealed.current = false; setProgress(0)
  }, [preview, t])
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
    <div className="scratch-card" ref={cardRef}><div className="offer-content"><span>{t('reward')}</span><strong>{card.offerTitle}</strong><p>{card.description}</p>{card.couponCode && <b>{t('useCode')} · {card.couponCode}</b>}</div>
      {!preview && <canvas ref={canvasRef} onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); scratch(e) }} onPointerMove={scratch} onPointerUp={() => drawing.current = false} onPointerCancel={() => drawing.current = false} aria-label={t('scratchLabel')} />}
    </div>
    {!preview && <><div className="progress"><span style={{ width: `${progress}%` }} /></div><small>{progress === 100 ? t('unlocked') : `${progress}% ${t('revealed')}`}</small></>}
  </div>
}

function Creator({ language, setLanguage, t }) {
  const [form, setForm] = useState(DEFAULT_CARD), [result, setResult] = useState(null), [status, setStatus] = useState('idle'), [message, setMessage] = useState('')
  const [usedOpen, setUsedOpen] = useState(false)
  const [coupons, setCoupons] = useState([])
  const [usedStatus, setUsedStatus] = useState('idle')
  const [usedSearch, setUsedSearch] = useState('')
  const [couponFilter, setCouponFilter] = useState('all')
  const [exporting, setExporting] = useState(false)
  const update = (e) => setForm(v => ({ ...v, [e.target.name]: e.target.value })), shareUrl = result ? `${location.origin}/card/${result.slug}` : ''
  const createCard = async (e) => { e.preventDefault(); setStatus('saving'); setMessage(''); try { const data = await requestJson('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); setResult(data); setForm(current => ({ ...current, couponCode: generateDraftCoupon() })); setStatus('done') } catch (error) { setMessage(error.message || 'Could not create the card.'); setStatus('error') } }
  const copy = async () => { await navigator.clipboard.writeText(shareUrl); setMessage(t('linkCopied')) }
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
  const exportCoupons = async () => {
    if (!coupons.length) { setMessage(t('noCouponsExport')); return }
    setExporting(true)
    setMessage('')
    try {
      const { default: writeExcelFile } = await import('write-excel-file/universal')
      const headerStyle = { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#17142D', height: 26, alignVertical: 'center' }
      const headers = t('excelHeaders').map(value => ({ value, ...headerStyle }))
      const rows = coupons.map((item, index) => {
        const cardLink = `${location.origin}/card/${item.slug}`
        const rowStyle = { backgroundColor: index % 2 ? '#F7F6FA' : '#FFFFFF', height: 23, alignVertical: 'center' }
        return [
          { value: item.couponCode, format: '@', ...rowStyle },
          { value: item.offerTitle, ...rowStyle },
          { value: item.senderName, ...rowStyle },
          { value: item.used ? t('used') : t('waiting'), fontWeight: 'bold', textColor: item.used ? '#167542' : '#8A5C00', ...rowStyle },
          item.createdAt ? { value: new Date(item.createdAt), type: Date, format: 'dd-mm-yyyy hh:mm', ...rowStyle } : { value: '', ...rowStyle },
          item.redeemedAt ? { value: new Date(item.redeemedAt), type: Date, format: 'dd-mm-yyyy hh:mm', ...rowStyle } : { value: '', ...rowStyle },
          { value: cardLink, textColor: '#5E43DF', textDecoration: { underline: true }, ...rowStyle },
        ]
      })
      const workbookBlob = await writeExcelFile([headers, ...rows], {
        sheet: t('excelSheet'),
        columns: [{ width: 24 }, { width: 24 }, { width: 22 }, { width: 14 }, { width: 22 }, { width: 22 }, { width: 52 }],
        stickyRowsCount: 1,
        showGridLines: false,
      }, { fontFamily: 'Arial', fontSize: 10 }).toBlob()
      const blobUrl = URL.createObjectURL(workbookBlob)
      const download = document.createElement('a')
      download.href = blobUrl
      download.download = `lucky-drop-coupons-${language}-${new Date().toISOString().slice(0, 10)}.xlsx`
      download.style.display = 'none'
      document.body.appendChild(download)
      download.click()
      download.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (error) {
      console.error(error)
      setMessage(t('exportError'))
    } finally {
      setExporting(false)
    }
  }
  const filteredCoupons = coupons.filter(item => {
    const matchesStatus = couponFilter === 'all' || (couponFilter === 'used' ? item.used : !item.used)
    return matchesStatus && `${item.couponCode} ${item.offerTitle} ${item.senderName}`.toLowerCase().includes(usedSearch.toLowerCase())
  })
  const usedCount = coupons.filter(item => item.used).length
  return <main className="creator-page"><header><a className="logo" href="/"><span>✦</span> Lucky Drop</a><div className="header-tools"><small>{t('creatorTagline')}</small><LanguageSelect language={language} setLanguage={setLanguage} /></div></header>
    <div className="creator-layout"><section className="builder"><div className="kicker">{t('createKicker')}</div><h1>{t('heroTitle')}</h1><p className="lead">{t('heroLead')}</p>
      <form onSubmit={createCard}><div className="fields">
        <label><span>{t('from')}</span><input name="senderName" value={form.senderName} onChange={update} maxLength="50" required /></label>
        <label><span>{t('messageAbove')}</span><input name="headline" value={form.headline} onChange={update} maxLength="80" required /></label>
        <label><span>{t('mainOffer')}</span><input name="offerTitle" value={form.offerTitle} onChange={update} maxLength="30" required /></label>
        <label><span>{t('offerDetails')}</span><input name="description" value={form.description} onChange={update} maxLength="80" required /></label>
        <label><span>{t('couponCode')} <em>{t('uniqueAuto')}</em></span><div className="coupon-input"><input name="couponCode" value={form.couponCode} onChange={update} maxLength="24" /><button type="button" onClick={() => setForm(current => ({ ...current, couponCode: generateDraftCoupon() }))}>{t('newCode')}</button></div></label>
        <label><span>{t('claimLink')} <em>{t('optional')}</em></span><input name="claimUrl" value={form.claimUrl} onChange={update} type="url" placeholder="https://yourwebsite.com" /></label>
      </div><fieldset className="theme-panel"><legend>{t('cardTheme')}</legend><div className="theme-controls"><label><span>{t('pageBackground')}</span><div><input name="pageColor" value={form.pageColor} onChange={update} type="color" /><b>{form.pageColor}</b></div></label><label><span>{t('messageText')}</span><div><input name="textColor" value={form.textColor} onChange={update} type="color" /><b>{form.textColor}</b></div></label><label><span>{t('scratchCard')}</span><div><input name="accentColor" value={form.accentColor} onChange={update} type="color" /><b>{form.accentColor}</b></div></label></div></fieldset>
      <button className="primary" disabled={status === 'saving'}>{status === 'saving' ? t('creating') : t('createLink')}</button>{status === 'error' && <p className="error">{message}</p>}</form>
      <section className="used-coupons-panel"><div className="used-coupons-heading"><div><span>{t('couponActivity')}</span><h2>{t('allCouponCodes')}</h2></div><div className="coupon-heading-actions">{usedStatus === 'ready' && coupons.length > 0 && <button className="export-coupons" type="button" onClick={exportCoupons} disabled={exporting}>{exporting ? t('exporting') : t('exportExcel')}</button>}<button type="button" onClick={loadUsedCoupons}>{usedOpen ? t('refresh') : t('viewCoupons')}</button></div></div>
        {usedOpen && <div className="used-coupons-content">{usedStatus === 'loading' && <p className="used-empty">{t('loadingCoupons')}</p>}{usedStatus === 'error' && <p className="used-empty">{t('couponLoadError')}</p>}{usedStatus === 'ready' && <><div className="coupon-stats"><div><strong>{coupons.length}</strong><span>{t('created')}</span></div><div><strong>{usedCount}</strong><span>{t('used')}</span></div><div><strong>{coupons.length - usedCount}</strong><span>{t('waiting')}</span></div></div><div className="coupon-filters"><button className={couponFilter === 'all' ? 'active' : ''} onClick={() => setCouponFilter('all')}>{t('all')}</button><button className={couponFilter === 'used' ? 'active' : ''} onClick={() => setCouponFilter('used')}>{t('used')}</button><button className={couponFilter === 'waiting' ? 'active' : ''} onClick={() => setCouponFilter('waiting')}>{t('waiting')}</button></div>{coupons.length > 0 && <input className="coupon-search" value={usedSearch} onChange={event => setUsedSearch(event.target.value)} placeholder={t('searchCoupons')} aria-label={t('searchCoupons')} />}{filteredCoupons.length === 0 ? <p className="used-empty">{t('noMatches')}</p> : <div className="coupon-list">{filteredCoupons.map(item => <article className="coupon-row" key={item.slug}><div><strong>{item.couponCode}</strong><span>{item.offerTitle} · {item.senderName}</span></div><div className="coupon-row-status"><span className={`status-pill ${item.used ? 'is-used' : 'is-waiting'}`}>{item.used ? t('used') : t('waiting')}</span>{!item.used && <a className="use-coupon-link" href={`/card/${item.slug}`} target="_blank" rel="noreferrer">{t('useCoupon')}</a>}<time dateTime={item.redeemedAt || item.createdAt}>{new Date(item.redeemedAt || item.createdAt).toLocaleString(language === 'hi' ? 'hi-IN' : language === 'te' ? 'te-IN' : undefined)}</time></div></article>)}</div>}</>}</div>}
      </section>
    </section><aside className="preview"><div className="preview-title"><span>{t('livePreview')}</span><span>{t('recipientView')}</span></div><div className="phone" style={{ '--page-color': form.pageColor, '--text-color': form.textColor, '--accent': form.accentColor }}><div className="phone-brand">✦ {form.senderName || t('yourBrand')}</div><div className="mini"><GiftIcon /> {t('surprise')}</div><h2>{form.headline || t('previewHeadline')}</h2><ScratchCard card={form} preview t={t} /><small>{t('scratchLayer')}</small></div></aside></div>
    {result && <div className="backdrop" role="dialog" aria-modal="true"><div className="modal"><div className="success">✓</div><div className="kicker">{t('readyShare')}</div><h2>{t('cardLive')}</h2><p>{t('anyoneCanOpen')}</p><div className="created-code"><span>{t('uniqueCoupon')}</span><strong>{result.couponCode}</strong></div><div className="link-box"><span>{shareUrl}</span><button onClick={copy}>{t('copy')}</button></div>{message && <p className="copied">{message}</p>}<div className="modal-actions"><button className="wa" onClick={whatsapp}><WhatsAppIcon /> {t('shareWhatsApp')}</button><a href={`/card/${result.slug}`} target="_blank" rel="noreferrer">{t('openCard')}</a></div><button className="again" onClick={() => { setResult(null); setMessage('') }}>{t('createAnother')}</button></div></div>}
  </main>
}

function PublicCard({ slug, language, setLanguage, t }) {
  const [card, setCard] = useState(null)
  const [state, setState] = useState('loading')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [claimError, setClaimError] = useState('')
  useEffect(() => { requestJson(`/api/cards/${encodeURIComponent(slug)}`).then(data => { setCard(data); setState(data.used ? 'used' : 'ready') }).catch(() => setState('error')) }, [slug])
  if (state === 'loading') return <main className="recipient status"><RecipientTopbar brand="Lucky Drop" language={language} setLanguage={setLanguage} /><div className="loader" /><p>{t('gettingReady')}</p></main>
  if (state === 'error') return <main className="recipient status"><RecipientTopbar brand="Lucky Drop" language={language} setLanguage={setLanguage} /><div className="broken">?</div><h1>{t('notFound')}</h1><p>{t('checkLink')}</p><a href="/">{t('createCard')}</a></main>
  if (state === 'used') return <main className="recipient status used-card" style={{ '--accent': card?.accentColor }}><RecipientTopbar brand={card?.senderName || 'Lucky Drop'} language={language} setLanguage={setLanguage} /><div className="used-icon">✓</div><h1>{t('alreadyUsed')}</h1><p>{t('oneReveal')}</p><a href="/">{t('createNew')}</a></main>
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
  return <main className="recipient" style={{ '--accent': card.accentColor || DEFAULT_CARD.accentColor, '--page-color': card.pageColor || DEFAULT_CARD.pageColor, '--text-color': card.textColor || DEFAULT_CARD.textColor }}><RecipientTopbar brand={card.senderName} language={language} setLanguage={setLanguage} /><div className="glow one" /><div className="glow two" /><section className="experience"><div className="eyebrow"><GiftIcon /> {t('sentToYou')}</div><h1>{card.headline}</h1><p className="intro">{t('scratchInstruction')}</p><ScratchCard card={card} onReveal={claimCoupon} t={t} />{state === 'claiming' && <p className="claim-status">{t('securing')}</p>}{claimError && <p className="claim-error" role="alert">{claimError} {t('scratchAgain')}</p>}<div className="recipient-actions">{revealed && card.claimUrl && <button className="claim" onClick={openClaimLink}>{t('claimOn')} {claimHost}</button>}<button className="share" onClick={share} disabled={!revealed}><WhatsAppIcon /> {revealed ? t('shareWhatsApp') : t('revealToShare')}</button>{revealed && <div className="public-share-link"><span title={location.href}>{location.href}</span><button onClick={copyShareLink}>{copied ? t('copied') : t('copyLink')}</button></div>}</div><p className="privacy">{t('privacy')}</p></section></main>
}

function App() {
  const slug = useMemo(() => location.pathname.match(/^\/card\/([\w-]+)\/?$/)?.[1], [])
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('lucky-drop-language')
    return TRANSLATIONS[saved] ? saved : 'en'
  })
  const t = useCallback(key => TRANSLATIONS[language][key] || TRANSLATIONS.en[key] || key, [language])
  useEffect(() => {
    localStorage.setItem('lucky-drop-language', language)
    document.documentElement.lang = language === 'hi' ? 'hi' : language === 'te' ? 'te' : 'en'
  }, [language])
  return slug
    ? <><Celebration /><PublicCard slug={slug} language={language} setLanguage={setLanguage} t={t} /></>
    : <Creator language={language} setLanguage={setLanguage} t={t} />
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
