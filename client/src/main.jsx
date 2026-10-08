import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./favicon.js";
import Portal, { PortalLogin, portalApi } from "./Portal.jsx";
import { workspaceTranslator } from "./workspace-i18n.js";
import { normalizeWhatsAppNumber, whatsAppCardUrl } from "../../shared/whatsapp.js";
import { scratchCardUrl, scratchShareUrl } from "../../shared/urls.js";
import { pendingBulk, completedBulk, savedBulkDraft, useBulkGeneration, BranchQuantities, BulkResults } from "./BulkGenerate.jsx";
import "./bulk.css";
import "./styles.css";
import "./share-link.css";
import "./card-typography.css";
import "./responsive.css";
import "./brand.css";

const TRANSLATIONS = {
  en: {
    branch: "Branch",
    allBranches: "All branches",
    language: "Language",
    creatorTagline: "Scratch-card link creator",
    createKicker: "CREATE A CARD",
    heroTitle: "Turn any offer into a little moment of delight.",
    heroLead:
      "Choose what appears under the scratch layer. We’ll create one link you can send anywhere.",
    from: "From",
    messageAbove: "Message above card",
    mainOffer: "Main offer",
    offerDetails: "Offer details",
    couponCode: "Coupon code",
    uniqueAuto: "unique code generated automatically",
    newCode: "New",
    claimLink: "Claim link",
    optional: "optional",
    cardTheme: "Card theme",
    pageBackground: "Page background",
    messageText: "Message text",
    scratchCard: "Scratch card",
    creating: "Creating your link…",
    createLink: "Create scratch-card link",
    couponActivity: "COUPON ACTIVITY",
    allCouponCodes: "All coupon codes",
    refresh: "Refresh list",
    viewCoupons: "View coupons",
    exportExcel: "Export Excel",
    exporting: "Exporting…",
    loadingCoupons: "Loading coupons…",
    couponLoadError: "Could not load the coupon history.",
    created: "Created",
    used: "Used",
    waiting: "Waiting",
    all: "All",
    searchCoupons: "Search coupon, offer or sender",
    noMatches: "No matching coupons found.",
    useCoupon: "Use this coupon",
    livePreview: "LIVE PREVIEW",
    recipientView: "Recipient view",
    yourBrand: "Your brand",
    surprise: "SURPRISE",
    previewHeadline: "A little surprise for you",
    scratchLayer: "Silver scratch layer appears on the shared card",
    readyShare: "READY TO SHARE",
    cardLive: "Your scratch card is live.",
    anyoneCanOpen: "Anyone with this link can open and scratch the card.",
    uniqueCoupon: "Unique coupon",
    copy: "Copy",
    linkCopied: "Link copied to your clipboard.",
    shareWhatsApp: "Open WhatsApp Web",
    openCard: "Open card",
    createAnother: "Create another card",
    reward: "YOUR REWARD",
    useCode: "USE CODE",
    scratchHere: "SCRATCH HERE",
    swipeFinger: "Swipe with your finger",
    unlocked: "Offer unlocked!",
    revealed: "revealed",
    scratchLabel: "Scratch to reveal your offer",
    gettingReady: "Getting your surprise ready…",
    notFound: "This card could not be found.",
    checkLink: "Check that the shared link is complete.",
    createCard: "Create a scratch card",
    alreadyUsed: "This coupon has already been used.",
    oneReveal: "Each scratch-card link can reveal its reward only once.",
    createNew: "Create a new scratch card",
    sentToYou: "A surprise was sent to you",
    scratchInstruction:
      "Scratch the silver surface with your finger or mouse to reveal it.",
    securing: "Securing your one-time coupon…",
    scratchAgain: "Please scratch again.",
    claimOn: "Claim offer on",
    revealToShare: "Reveal to share",
    copied: "Copied!",
    copyLink: "Copy link",
    privacy: "Created with JustConnect · One-time reward",
    exportError: "Could not create the Excel file.",
    noCouponsExport: "There are no coupon codes to export.",
    excelSheet: "Coupons",
    excelHeaders: [
      "Coupon code",
      "Offer",
      "Sender",
      "Status",
      "Created at",
      "Redeemed at",
      "Card link",
    ],
  },
  hi: {
    branch: "शाखा",
    allBranches: "सभी शाखाएँ",
    language: "भाषा",
    creatorTagline: "स्क्रैच-कार्ड लिंक निर्माता",
    createKicker: "कार्ड बनाएँ",
    heroTitle: "किसी भी ऑफर को एक खास खुशी में बदलें।",
    heroLead:
      "स्क्रैच परत के नीचे क्या दिखेगा चुनें। हम साझा करने के लिए एक लिंक बनाएँगे।",
    from: "भेजने वाला",
    messageAbove: "कार्ड के ऊपर संदेश",
    mainOffer: "मुख्य ऑफर",
    offerDetails: "ऑफर विवरण",
    couponCode: "कूपन कोड",
    uniqueAuto: "अलग कोड अपने आप बनेगा",
    newCode: "नया",
    claimLink: "क्लेम लिंक",
    optional: "वैकल्पिक",
    cardTheme: "कार्ड थीम",
    pageBackground: "पेज का रंग",
    messageText: "संदेश का रंग",
    scratchCard: "स्क्रैच कार्ड",
    creating: "लिंक बन रहा है…",
    createLink: "स्क्रैच-कार्ड लिंक बनाएँ",
    couponActivity: "कूपन गतिविधि",
    allCouponCodes: "सभी कूपन कोड",
    refresh: "सूची रीफ़्रेश करें",
    viewCoupons: "कूपन देखें",
    exportExcel: "Excel डाउनलोड करें",
    exporting: "डाउनलोड बन रहा है…",
    loadingCoupons: "कूपन लोड हो रहे हैं…",
    couponLoadError: "कूपन इतिहास लोड नहीं हुआ।",
    created: "बनाए गए",
    used: "उपयोग किए गए",
    waiting: "उपलब्ध",
    all: "सभी",
    searchCoupons: "कूपन, ऑफर या भेजने वाला खोजें",
    noMatches: "कोई मेल खाता कूपन नहीं मिला।",
    useCoupon: "यह कूपन उपयोग करें",
    livePreview: "लाइव पूर्वावलोकन",
    recipientView: "प्राप्तकर्ता दृश्य",
    yourBrand: "आपका ब्रांड",
    surprise: "सरप्राइज़",
    previewHeadline: "आपके लिए एक छोटा सा सरप्राइज़",
    scratchLayer: "साझा कार्ड पर सिल्वर स्क्रैच परत दिखाई देगी",
    readyShare: "साझा करने के लिए तैयार",
    cardLive: "आपका स्क्रैच कार्ड तैयार है।",
    anyoneCanOpen:
      "इस लिंक वाला कोई भी व्यक्ति कार्ड खोलकर स्क्रैच कर सकता है।",
    uniqueCoupon: "विशिष्ट कूपन",
    copy: "कॉपी करें",
    linkCopied: "लिंक क्लिपबोर्ड पर कॉपी हो गया।",
    shareWhatsApp: "WhatsApp Web खोलें",
    openCard: "कार्ड खोलें",
    createAnother: "दूसरा कार्ड बनाएँ",
    reward: "आपका इनाम",
    useCode: "कोड इस्तेमाल करें",
    scratchHere: "यहाँ स्क्रैच करें",
    swipeFinger: "अपनी उंगली से स्वाइप करें",
    unlocked: "ऑफर खुल गया!",
    revealed: "खुला",
    scratchLabel: "ऑफर देखने के लिए स्क्रैच करें",
    gettingReady: "आपका सरप्राइज़ तैयार हो रहा है…",
    notFound: "यह कार्ड नहीं मिला।",
    checkLink: "जाँचें कि साझा लिंक पूरा है।",
    createCard: "स्क्रैच कार्ड बनाएँ",
    alreadyUsed: "यह कूपन पहले ही उपयोग किया जा चुका है।",
    oneReveal: "हर स्क्रैच-कार्ड लिंक केवल एक बार इनाम दिखाता है।",
    createNew: "नया स्क्रैच कार्ड बनाएँ",
    sentToYou: "आपके लिए एक सरप्राइज़ भेजा गया है",
    scratchInstruction:
      "इनाम देखने के लिए उंगली या माउस से सिल्वर सतह स्क्रैच करें।",
    securing: "आपका एक-बार उपयोग वाला कूपन सुरक्षित किया जा रहा है…",
    scratchAgain: "कृपया फिर से स्क्रैच करें।",
    claimOn: "ऑफर क्लेम करें",
    revealToShare: "साझा करने के लिए खोलें",
    copied: "कॉपी हो गया!",
    copyLink: "लिंक कॉपी करें",
    privacy: "JustConnect से बनाया गया · एक बार का इनाम",
    exportError: "Excel फ़ाइल नहीं बन सकी।",
    noCouponsExport: "निर्यात के लिए कोई कूपन नहीं है।",
    excelSheet: "कूपन",
    excelHeaders: [
      "कूपन कोड",
      "ऑफर",
      "भेजने वाला",
      "स्थिति",
      "बनाने की तारीख",
      "उपयोग की तारीख",
      "कार्ड लिंक",
    ],
  },
  te: {
    branch: "శాఖ",
    allBranches: "అన్ని శాఖలు",
    language: "భాష",
    creatorTagline: "స్క్రాచ్-కార్డ్ లింక్ క్రియేటర్",
    createKicker: "కార్డ్ సృష్టించండి",
    heroTitle: "ఇ\u00A0ఆఫర్ ఒక చిన్న ఆనంద క్షణంగా మార్చండి.",
    heroLead:
      "స్క్రాచ్ పొర కింద ఏమి కనిపించాలో ఎంచుకోండి. ఎక్కడైనా పంపగల లింక్‌ను మేము సృష్టిస్తాము.",
    from: "పంపినవారు",
    messageAbove: "కార్డ్ పైన సందేశం",
    mainOffer: "ప్రధాన ఆఫర్",
    offerDetails: "ఆఫర్ వివరాలు",
    couponCode: "కూపన్ కోడ్",
    uniqueAuto: "ప్రత్యేక కోడ్ స్వయంచాలకంగా సృష్టించబడుతుంది",
    newCode: "కొత్తది",
    claimLink: "క్లెయిమ్ లింక్",
    optional: "ఐచ్ఛికం",
    cardTheme: "కార్డ్ థీమ్",
    pageBackground: "పేజీ రంగు",
    messageText: "సందేశం రంగు",
    scratchCard: "స్క్రాచ్ కార్డ్",
    creating: "లింక్ సృష్టిస్తోంది…",
    createLink: "స్క్రాచ్-కార్డ్ లింక్ సృష్టించండి",
    couponActivity: "కూపన్ కార్యకలాపం",
    allCouponCodes: "అన్ని కూపన్ కోడ్‌లు",
    refresh: "జాబితాను రిఫ్రెష్ చేయండి",
    viewCoupons: "కూపన్‌లు చూడండి",
    exportExcel: "Excel డౌన్‌లోడ్",
    exporting: "ఎక్స్‌పోర్ట్ అవుతోంది…",
    loadingCoupons: "కూపన్‌లు లోడ్ అవుతున్నాయి…",
    couponLoadError: "కూపన్ చరిత్ర లోడ్ కాలేదు.",
    created: "సృష్టించినవి",
    used: "వాడినవి",
    waiting: "అందుబాటులో",
    all: "అన్నీ",
    searchCoupons: "కూపన్, ఆఫర్ లేదా పంపినవారిని వెతకండి",
    noMatches: "సరిపోలే కూపన్‌లు లేవు.",
    useCoupon: "ఈ కూపన్ ఉపయోగించండి",
    livePreview: "లైవ్ ప్రివ్యూ",
    recipientView: "గ్రహీత వీక్షణ",
    yourBrand: "మీ బ్రాండ్",
    surprise: "సర్‌ప్రైజ్",
    previewHeadline: "మీ కోసం ఒక చిన్న సర్‌ప్రైజ్",
    scratchLayer: "షేర్ చేసిన కార్డ్‌పై సిల్వర్ స్క్రాచ్ పొర కనిపిస్తుంది",
    readyShare: "షేర్ చేయడానికి సిద్ధం",
    cardLive: "మీ స్క్రాచ్ కార్డ్ సిద్ధంగా ఉంది.",
    anyoneCanOpen: "ఈ లింక్ ఉన్న ఎవరైనా కార్డ్‌ను తెరిచి స్క్రాచ్ చేయవచ్చు.",
    uniqueCoupon: "ప్రత్యేక కూపన్",
    copy: "కాపీ",
    linkCopied: "లింక్ క్లిప్‌బోర్డ్‌కు కాపీ అయింది.",
    shareWhatsApp: "WhatsApp Web తెరవండి",
    openCard: "కార్డ్ తెరవండి",
    createAnother: "మరొక కార్డ్ సృష్టించండి",
    reward: "మీ బహుమతి",
    useCode: "కోడ్ ఉపయోగించండి",
    scratchHere: "ఇక్కడ స్క్రాచ్ చేయండి",
    swipeFinger: "వేలితో స్వైప్ చేయండి",
    unlocked: "ఆఫర్ తెరుచుకుంది!",
    revealed: "తెరచింది",
    scratchLabel: "ఆఫర్ చూడటానికి స్క్రాచ్ చేయండి",
    gettingReady: "మీ సర్‌ప్రైజ్ సిద్ధమవుతోంది…",
    notFound: "ఈ కార్డ్ కనబడలేదు.",
    checkLink: "షేర్ చేసిన లింక్ పూర్తిగా ఉందో చూడండి.",
    createCard: "స్క్రాచ్ కార్డ్ సృష్టించండి",
    alreadyUsed: "ఈ కూపన్ ఇప్పటికే ఉపయోగించబడింది.",
    oneReveal:
      "ప్రతి స్క్రాచ్-కార్డ్ లింక్ బహుమతిని ఒక్కసారి మాత్రమే చూపిస్తుంది.",
    createNew: "కొత్త స్క్రాచ్ కార్డ్ సృష్టించండి",
    sentToYou: "మీకు ఒక సర్‌ప్రైజ్ పంపబడింది",
    scratchInstruction:
      "బహుమతిని చూడటానికి వెండి ఉపరితలాన్ని వేలితో లేదా మౌస్‌తో స్క్రాచ్ చేయండి.",
    securing: "మీ ఒక్కసారి ఉపయోగించే కూపన్‌ను భద్రపరుస్తోంది…",
    scratchAgain: "దయచేసి మళ్లీ స్క్రాచ్ చేయండి.",
    claimOn: "ఆఫర్‌ను క్లెయిమ్ చేయండి",
    revealToShare: "షేర్ చేయడానికి తెరవండి",
    copied: "కాపీ అయింది!",
    copyLink: "లింక్ కాపీ",
    privacy: "JustConnectతో రూపొందించబడింది · ఒక్కసారి బహుమతి",
    exportError: "Excel ఫైల్ సృష్టించలేకపోయాం.",
    noCouponsExport: "ఎక్స్‌పోర్ట్ చేయడానికి కూపన్‌లు లేవు.",
    excelSheet: "కూపన్లు",
    excelHeaders: [
      "కూపన్ కోడ్",
      "ఆఫర్",
      "పంపినవారు",
      "స్థితి",
      "సృష్టించిన తేదీ",
      "ఉపయోగించిన తేదీ",
      "కార్డ్ లింక్",
    ],
  },
};

const cardTranslator = (language) => (key) =>
  TRANSLATIONS[language]?.[key] || TRANSLATIONS.en[key] || key;

const CARD_DEFAULT_TEXT = {
  en: { headline: "A little surprise for you", description: "On your next order", discount: "OFF" },
  hi: { headline: "आपके लिए एक छोटा सा सरप्राइज़", description: "आपके अगले ऑर्डर पर", discount: "छूट" },
  te: { headline: "మీ కోసం ఒక చిన్న సర్‌ప్రైజ్", description: "మీ తదుపరి ఆర్డర్‌పై", discount: "తగ్గింపు" },
};

// Translate built-in copy only; never overwrite a business's custom wording.
function changeCardLanguage(card, language) {
  const next = { ...card, language };
  for (const field of ["headline", "description"]) {
    if (Object.values(CARD_DEFAULT_TEXT).some((text) => text[field] === card[field]))
      next[field] = CARD_DEFAULT_TEXT[language][field];
  }
  const discount = card.offerTitle.match(/^(\d+(?:\.\d+)?%)\s*(?:OFF|छूट|తగ్గింపు)$/i);
  if (discount) next.offerTitle = `${discount[1]} ${CARD_DEFAULT_TEXT[language].discount}`;
  return next;
}

const CELEBRATION_COLORS = [
  "#6c63ff",
  "#ff745f",
  "#ffc34d",
  "#53d990",
  "#52acef",
  "#cc58ef",
];
const CONFETTI_PIECES = Array.from({ length: 46 }, (_, index) => ({
  id: index,
  color: CELEBRATION_COLORS[index % CELEBRATION_COLORS.length],
  left: `${(index * 37 + 5) % 96}%`,
  delay: `${(index % 10) * 0.07}s`,
  duration: `${2.2 + (index % 6) * 0.18}s`,
  drift: `${((index * 19) % 90) - 45}px`,
  rotation: `${(index * 47) % 270}deg`,
}));
const CELEBRATION_TICKETS = [
  { color: "#6669f6", left: "10%", delay: ".08s", rotation: "-14deg" },
  { color: "#f8b93e", left: "28%", delay: ".22s", rotation: "9deg" },
  { color: "#c454e7", left: "47%", delay: ".04s", rotation: "-8deg" },
  { color: "#5aa7ec", left: "68%", delay: ".18s", rotation: "13deg" },
  { color: "#fa7568", left: "84%", delay: ".12s", rotation: "-11deg" },
];

function Celebration() {
  return (
    <div className="arrival-celebration" aria-hidden="true">
      {CONFETTI_PIECES.map((piece) => (
        <i
          className="confetti-piece"
          key={piece.id}
          style={{
            "--piece-color": piece.color,
            "--piece-left": piece.left,
            "--piece-delay": piece.delay,
            "--piece-duration": piece.duration,
            "--piece-drift": piece.drift,
            "--piece-rotation": piece.rotation,
          }}
        />
      ))}
      {CELEBRATION_TICKETS.map((ticket, index) => (
        <i
          className="celebration-ticket"
          key={ticket.left}
          style={{
            "--ticket-color": ticket.color,
            "--ticket-left": ticket.left,
            "--ticket-delay": ticket.delay,
            "--ticket-rotation": ticket.rotation,
          }}
        >
          <span />
        </i>
      ))}
    </div>
  );
}

function RecipientTopbar({ brand }) {
  return (
    <header className="recipient-topbar">
      <a className="recipient-brand" href="/">
        <span>✦</span> {brand}
      </a>
    </header>
  );
}

function generateDraftCoupon() {
  const bytes = new Uint8Array(4);
  window.crypto.getRandomValues(bytes);
  return `LUCKY-${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase()}`;
}

const DEFAULT_CARD = {
  senderName: "Impact Vibes",
  shareTitle: "Congratulation you got an offer",
  headline: "A little surprise for you",
  offerTitle: "25% OFF",
  description: "On your next order",
  couponCode: generateDraftCoupon(),
  claimUrl: "",
  accentColor: "#f6a800",
  pageColor: "#002b5c",
  textColor: "#ffffff",
};

const SHARE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SHARE_IMAGE_BYTES = 5 * 1024 * 1024;

function imageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The selected image could not be read. Choose it again."));
    reader.readAsDataURL(file);
  });
}

async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error(
      import.meta.env.PROD
        ? "The scratch-card service could not be reached. Please try again shortly."
        : "The scratch-card server is not running. Stop the old preview and run npm run dev again.",
    );
  }

  const body = await response.text();
  let data = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(
        import.meta.env.PROD
          ? "The scratch-card service returned an unexpected response. Please try again shortly."
          : "The page is connected to the wrong local server. Restart this project with npm run dev.",
      );
    }
  }

  if (!response.ok) {
    const apiMessage =
      data?.message ||
      data?.errorMessage ||
      (typeof data?.error === "string" ? data.error : data?.error?.message);
    let fallbackMessage = `The scratch-card API returned error ${response.status}.`;
    if (import.meta.env.PROD && response.status === 404) {
      fallbackMessage =
        "The scratch-card service could not find this page. Please check your link or contact your administrator.";
    } else if (import.meta.env.PROD && response.status >= 500) {
      fallbackMessage = `The scratch-card service is temporarily unavailable (${response.status}). Please try again shortly.`;
    }
    const error = new Error(apiMessage || fallbackMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (!data)
    throw new Error(
      "The scratch-card server returned an empty response. Restart this project with npm run dev.",
    );
  return data;
}

const GiftIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 12v8H4v-8M2 7h20v5H2zM12 7v13M12 7H7.5a2.5 2.5 0 1 1 2.2-3.7L12 7Zm0 0h4.5a2.5 2.5 0 1 0-2.2-3.7L12 7Z" />
  </svg>
);
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L.2 24l6.5-1.7a11.8 11.8 0 0 0 5.4 1.4c6.5 0 11.8-5.3 11.8-11.8 0-3.2-1.2-6.1-3.4-8.4Zm-8.4 18.2c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 1 1 8.5 4.7Zm5.4-7.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.6l-.9-2.1c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.3 1.4 3.5c.1.2 2.5 3.8 6 5.3 2.2.9 3.1 1 4.2.8.7-.1 1.7-.7 1.9-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3Z" />
  </svg>
);

function ScratchCard({ card, onReveal = () => {}, preview = false, t }) {
  const alreadyScratched = Boolean(card.scratchedAt);
  const canvasRef = useRef(null),
    cardRef = useRef(null),
    drawing = useRef(false),
    revealed = useRef(false);
  const [progress, setProgress] = useState(preview || alreadyScratched ? 100 : 0);
  const prepare = useCallback(() => {
    // Revealing the coupon can grow the card with larger translated text.
    // A resize must not cover an already-revealed reward again.
    if (preview || alreadyScratched || revealed.current || !canvasRef.current || !cardRef.current) return;
    const canvas = canvasRef.current,
      rect = cardRef.current.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 2),
      ctx = canvas.getContext("2d");
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    gradient.addColorStop(0, "#eef0f5");
    gradient.addColorStop(0.48, "#a7adbd");
    gradient.addColorStop(1, "#f7f8fa");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(255,255,255,.24)";
    for (let x = -rect.height; x < rect.width + rect.height; x += 28) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(0, -rect.height, 8, rect.height * 3);
      ctx.restore();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#42485b";
    ctx.font = "700 16px DM Sans, system-ui";
    ctx.fillText(
      `✦  ${t("scratchHere")}  ✦`,
      rect.width / 2,
      rect.height / 2 - 7,
    );
    ctx.fillStyle = "#62697d";
    ctx.font = "500 12px DM Sans, system-ui";
    ctx.fillText(t("swipeFinger"), rect.width / 2, rect.height / 2 + 18);
    revealed.current = false;
    setProgress(0);
  }, [preview, alreadyScratched, t]);
  useEffect(() => {
    prepare();
    if (preview) return;
    const observer = new ResizeObserver(prepare);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [prepare, preview]);
  const scratch = (event) => {
    if (!drawing.current || revealed.current || preview) return;
    event.preventDefault();
    const canvas = canvasRef.current,
      rect = canvas.getBoundingClientRect(),
      ratio = canvas.width / rect.width,
      ctx = canvas.getContext("2d");
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(
      (event.clientX - rect.left) * ratio,
      (event.clientY - rect.top) * ratio,
      29 * ratio,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let cleared = 0;
    for (let i = 3; i < pixels.length; i += 160) if (pixels[i] === 0) cleared++;
    const percent = Math.min(
      100,
      Math.round((cleared / (pixels.length / 160)) * 100),
    );
    setProgress(percent);
    if (percent >= 42) {
      revealed.current = true;
      setProgress(100);
      Promise.resolve(onReveal())
        .then((canReveal) => {
          if (canReveal === false) {
            revealed.current = false;
            prepare();
            return;
          }
          canvas.classList.add("canvas-revealed");
        })
        .catch(() => {
          revealed.current = false;
          prepare();
        });
    }
  };
  return (
    <div
      className={`scratch-shell ${preview ? "is-preview" : ""}`}
      style={{ "--accent": card.accentColor || DEFAULT_CARD.accentColor }}
    >
      <i className="ticket-edge left" />
      <i className="ticket-edge right" />
      <div className={`scratch-card${card.branchName ? " has-branch" : ""}`} ref={cardRef}>
        <div className="offer-content">
          {card.branchName && <div className="offer-branch">{card.branchId ? card.branchName : t("allBranches")}</div>}
          <span>{t("reward")}</span>
          <strong>{card.offerTitle}</strong>
          <p>{card.description}</p>
          {card.couponCode && (
            <b>
              {t("useCode")} · {card.couponCode}
            </b>
          )}
        </div>
        {!preview && !alreadyScratched && (
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              drawing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              scratch(e);
            }}
            onPointerMove={scratch}
            onPointerUp={() => (drawing.current = false)}
            onPointerCancel={() => (drawing.current = false)}
            aria-label={t("scratchLabel")}
          />
        )}
      </div>
      {!preview && (
        <>
          <div className="progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            {progress === 100 ? t("unlocked") : `${progress}% ${t("revealed")}`}
          </small>
        </>
      )}
    </div>
  );
}

function Creator({
  language,
  setLanguage,
  t,
  token,
  user,
  business,
  onCreated,
  onCreateBranch,
  onManageBranches,
  ui = workspaceTranslator(),
}) {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_CARD,
    ...business?.brand,
    senderName: business?.name || user.name,
    claimUrl: business?.website || "",
    couponCode: generateDraftCoupon(),
    branchId: "",
    campaignName: "",
    customerPhone: "",
    expiresAt: "",
    language: "en",
    ...Object.fromEntries(Object.entries(savedBulkDraft(business.businessId)?.form || {}).filter(([key]) =>
      [...Object.keys(DEFAULT_CARD), "campaignName", "customerPhone", "language", "expiresAt"].includes(key) && key !== "senderName")),
    // Restore shared form fields only, never request-only recipients, branch rows or retry keys.
    ...Object.fromEntries(Object.entries(pendingBulk(business.businessId) || {}).filter(([key]) =>
      [...Object.keys(DEFAULT_CARD), "campaignName", "customerPhone", "language"].includes(key))),
    expiresAt: pendingBulk(business.businessId)?.expiresAt
      ? (() => { const date = new Date(pendingBulk(business.businessId).expiresAt); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })()
      : pendingBulk(business.businessId) ? "" : savedBulkDraft(business.businessId)?.form?.expiresAt || "",
  }));
  const [mode, setMode] = useState(() => pendingBulk(business.businessId) || completedBulk(business.businessId) || savedBulkDraft(business.businessId) ? "bulk" : "single");
  const bulk = useBulkGeneration({ form, setForm, business, token, user, onCreated, enabled: mode === "bulk" });
  const isBulk = mode === "bulk";
  const cardT = useMemo(() => cardTranslator(form.language), [form.language]);
  const [result, setResult] = useState(null),
    [status, setStatus] = useState("idle"),
    [message, setMessage] = useState(""),
    [shareImage, setShareImage] = useState(null),
    [shareImagePreview, setShareImagePreview] = useState("");
  const shareImageInputRef = useRef(null);
  useEffect(() => () => {
    if (shareImagePreview) URL.revokeObjectURL(shareImagePreview);
  }, [shareImagePreview]);
  const saving = isBulk ? bulk.status === "saving" : status === "saving";
  const branchName = (business?.branches || []).find(
    (branch) => branch.branchId === (isBulk ? bulk.previewId : form.branchId),
  )?.name || cardT("allBranches");
  const update = (event) => {
    if (event.target.name !== "senderName")
      setForm((value) => ({
        ...value,
        [event.target.name]: event.target.value,
      }));
  };
  const chooseShareImage = (event) => {
    const file = event.target.files?.[0];
    setMessage("");
    if (!file) {
      setShareImage(null);
      setShareImagePreview("");
      return;
    }
    if (!SHARE_IMAGE_TYPES.has(file.type)) {
      event.target.value = "";
      setShareImage(null);
      setShareImagePreview("");
      setStatus("error");
      setMessage("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_SHARE_IMAGE_BYTES) {
      event.target.value = "";
      setShareImage(null);
      setShareImagePreview("");
      setStatus("error");
      setMessage("Choose an image smaller than 5 MB.");
      return;
    }
    setShareImage(file);
    setShareImagePreview(URL.createObjectURL(file));
    setStatus("idle");
  };
  const clearShareImage = () => {
    setShareImage(null);
    setShareImagePreview("");
    if (shareImageInputRef.current) shareImageInputRef.current.value = "";
  };
  const shareUrl = result ? result.shareUrl || scratchCardUrl(result.slug) : "";
  const creatingRef = useRef(false);
  const createCard = async (event) => {
    event.preventDefault();
    if (creatingRef.current) return;
    const directSend = event.nativeEvent.submitter?.value === "direct-send";
    let customerPhone;
    try {
      customerPhone = normalizeWhatsAppNumber(form.customerPhone);
    } catch (error) {
      setMessage(error.message);
      setStatus("error");
      event.currentTarget.elements.customerPhone.focus();
      return;
    }
    creatingRef.current = true;
    // Open synchronously during the click so the async API call does not trigger popup blocking.
    let whatsappWindow = null;
    if (directSend) {
      try { whatsappWindow = window.open("about:blank", "_blank"); } catch { /* The result popup provides a retry link. */ }
    }
    if (whatsappWindow) whatsappWindow.opener = null;
    setStatus("saving");
    setMessage("");
    try {
      const encodedShareImage = shareImage ? await imageDataUrl(shareImage) : "";
      const data = await portalApi("/api/cards", token, "POST", {
        ...form,
        customerPhone,
        shareImage: encodedShareImage,
        expiresAt: form.expiresAt
          ? new Date(form.expiresAt).toISOString()
          : null,
        businessId: user.businessId,
      });
      const cardUrl = scratchShareUrl(data.slug);
      const whatsappUrl = whatsAppCardUrl(customerPhone, cardUrl);
      const hasShareImage = Boolean(shareImage);
      setResult({ ...data, whatsappUrl, shareUrl: cardUrl, hasShareImage });
      if (directSend) {
        if (whatsappWindow && !whatsappWindow.closed) {
          try {
            whatsappWindow.location.replace(whatsappUrl);
            if (hasShareImage) setMessage("WhatsApp Web opened with the scratch-card message and preview-enabled link. Review the image preview, then click Send.");
          }
          catch {
            whatsappWindow.close();
            setMessage("WhatsApp Web could not open. Use Open WhatsApp Web below to retry.");
          }
        } else {
          setMessage(hasShareImage
            ? "WhatsApp Web could not open. Use Open WhatsApp Web below; the shared link contains the image preview."
            : "WhatsApp Web could not open. Use Open WhatsApp Web below to retry.");
        }
      }
      setForm((current) => ({ ...current, couponCode: generateDraftCoupon(), customerPhone: "" }));
      setShareImage(null);
      setShareImagePreview("");
      if (shareImageInputRef.current) shareImageInputRef.current.value = "";
      setStatus("done");
      onCreated?.();
    } catch (error) {
      whatsappWindow?.close();
      setMessage(error.message);
      setStatus("error");
    } finally {
      creatingRef.current = false;
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage(t("linkCopied"));
    } catch {
      setMessage("Select the share link and copy it manually.");
    }
  };
  const whatsapp = () => {
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer");
    if (result.hasShareImage)
      setMessage("WhatsApp Web opened with the preview-enabled scratch-card link. Review the image preview, then click Send.");
  };
  return (
    <main className="creator-page">
      <div className="bulk-mode-switch" role="group" aria-label="Card creation mode">
        <button type="button" className={`p-button ${!isBulk ? "primary" : ""}`} aria-pressed={!isBulk} disabled={saving || bulk.pending} onClick={() => setMode("single")}>{ui("Single Card")}</button>
        <button type="button" className={`p-button ${isBulk ? "primary" : ""}`} aria-pressed={isBulk} disabled={saving} onClick={() => setMode("bulk")}>{ui("Bulk Generate")}</button>
      </div>
      {isBulk && bulk.pending && <p className="p-alert" role="status">A batch request is awaiting confirmation. Retry the stored request to recover its saved coupons. Fields are locked to prevent duplicate batches.</p>}
      {isBulk && bulk.result && !bulk.pending && !bulk.restoring && <div className="p-alert bulk-state-notice" role="status">
        <span>{ui("Keep this draft open: add another branch or increase a quantity to generate only the remaining coupons. Existing coupons are not generated again.")}</span>
      </div>}
      {isBulk && bulk.restoring && <div className="p-alert" role="status">{ui(bulk.status === "restoring" ? "Restoring saved batch results…" : "Saved batch results could not be loaded.")}
        {bulk.status === "error" && <div className="bulk-row-actions"><button type="button" className="p-button" onClick={bulk.restore}>{ui("Retry loading batch")}</button>
          {!bulk.pending && <button type="button" className="p-button" onClick={bulk.reset}>{ui("Start new draft")}</button>}</div>}</div>}
      <div className="creator-layout">
        <section className="builder">
          <form onSubmit={isBulk ? bulk.submit : createCard}>
            <fieldset className="creator-form-fields" disabled={saving || (isBulk && (bulk.restoring || bulk.pending))}>
            <div className="fields">
              <label>
                <span>{ui("Card language")}</span>
                <select name="language" value={form.language}
                  onChange={(event) => setForm((current) => changeCardLanguage(current, event.target.value))}>
                  <option value="en">English</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="te">తెలుగు (Telugu)</option>
                </select>
              </label>
              <span className="p-builder-note">
                {ui("Changes only the card, not the dashboard. Default text is translated; enter custom messages in your chosen language.")}
              </span>
              {!isBulk && <label>
                <span>{t("branch")}</span>
                <select name="branchId" value={form.branchId} onChange={update}>
                  <option value="">{t("allBranches")}</option>
                  {(() => {
                    const active = (business?.branches || []).filter((branch) => branch.status === "active");
                    const groups = (business?.departments || []).map((department) => ({
                      ...department, branches: active.filter((branch) => branch.departmentId === department.departmentId),
                    })).filter((department) => department.branches.length);
                    const unassigned = active.filter((branch) => !branch.departmentId
                      || !(business?.departments || []).some((department) => department.departmentId === branch.departmentId));
                    return <>{groups.map((department) => <optgroup key={department.departmentId} label={department.name}>
                      {department.branches.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>)}
                    </optgroup>)}{unassigned.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>)}</>;
                  })()}
                </select>
              </label>}
              <label>
                <span>{ui("WhatsApp preview title")}</span>
                <input name="shareTitle" value={form.shareTitle} onChange={update} maxLength="100"
                  required placeholder="Congratulation you got an offer" />
                <small>{ui("Shown as the bold title when WhatsApp creates a link preview.")}</small>
              </label>
              <label>
                <span>{t("messageAbove")}</span>
                <input
                  name="headline"
                  value={form.headline}
                  onChange={update}
                  maxLength="80"
                  required
                />
              </label>
              <label>
                <span>{t("mainOffer")}</span>
                <input
                  name="offerTitle"
                  value={form.offerTitle}
                  onChange={update}
                  maxLength="30"
                  required
                />
              </label>
              <label>
                <span>{t("offerDetails")}</span>
                <input
                  name="description"
                  value={form.description}
                  onChange={update}
                  maxLength="80"
                  required
                />
              </label>
              {!isBulk && <label>
                <span>
                  {t("couponCode")} <em>{t("uniqueAuto")}</em>
                </span>
                <div className="coupon-input">
                  <input
                    name="couponCode"
                    value={form.couponCode}
                    onChange={update}
                    maxLength="24"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        couponCode: generateDraftCoupon(),
                      }))
                    }
                  >
                    {t("newCode")}
                  </button>
                </div>
              </label>}
              <label>
                <span>
                  {t("claimLink")} <em>{t("optional")}</em>
                </span>
                <input
                  name="claimUrl"
                  value={form.claimUrl}
                  onChange={update}
                  type="url"
                  placeholder="https://yourwebsite.com"
                />
              </label>
              <label>
                {ui("Campaign name")}
                <input
                  name="campaignName"
                  value={form.campaignName}
                  onChange={update}
                  maxLength="80"
                  placeholder={ui("e.g. Diwali rewards")}
                />
              </label>
              <label>
                {ui("Expiry date (optional)")}
                <input
                  name="expiresAt"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={update}
                />
              </label>
              <label>
                <span>{ui("WhatsApp number")}{isBulk ? " (optional, shared across this batch)" : ""}</span>
                <input
                  name="customerPhone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={form.customerPhone}
                  onChange={update}
                  maxLength="40"
                  placeholder="+91 98765 43210"
                  required={!isBulk}
                  aria-label={ui("WhatsApp number")}
                  aria-describedby="customer-phone-note"
                />
                <small id="customer-phone-note">{ui("Enter a 10-digit Indian mobile number or include the country code (e.g. +91). Never shown on the shared card.")}</small>
              </label>
              {!isBulk && <div className="share-image-field">
                <label htmlFor="share-image">WhatsApp image <em>{t("optional")}</em></label>
                <input ref={shareImageInputRef} id="share-image" name="shareImage" type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={chooseShareImage} />
                {shareImagePreview && <div className="share-image-preview">
                  <img src={shareImagePreview} alt="WhatsApp share preview" />
                  <div>
                    <b>{shareImage.name}</b>
                    <small>{(shareImage.size / 1024 / 1024).toFixed(2)} MB</small>
                    <button type="button" className="p-button small" onClick={clearShareImage}>Remove image</button>
                  </div>
                </div>}
                <small>JPG, PNG or WebP, up to 5 MB. The image is stored with this coupon and publicly available to anyone with its unguessable link so WhatsApp can show it as a preview. It is never shown on the scratch card itself.</small>
              </div>}
              <span className="p-builder-note">
                {ui("Each link can reveal its reward once. Campaigns and branches help you track your results.")}
              </span>
            </div>
            {isBulk && <BranchQuantities bulk={bulk} business={business} onCreateBranch={onCreateBranch} onManageBranches={onManageBranches} />}
            <fieldset className="theme-panel">
              <legend>{t("cardTheme")}</legend>
              <div className="theme-controls">
                {[
                  ["pageColor", "pageBackground"],
                  ["textColor", "messageText"],
                  ["accentColor", "scratchCard"],
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{t(label)}</span>
                    <div>
                      <input
                        name={key}
                        value={form[key]}
                        onChange={update}
                        type="color"
                      />
                      <b>{form[key]}</b>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
            </fieldset>
            <div className="creator-actions">
              <button type="submit" className="primary" value="create-link" disabled={saving || (isBulk && (bulk.restoring || (!bulk.pending && !bulk.total)))}>
                {saving ? t("creating") : isBulk ? bulk.pending ? ui("Retry saved batch") : !bulk.total && bulk.result ? ui("All requested coupons generated") : ui("Generate {count} Coupons", { count: bulk.total }) : t("createLink")}
              </button>
              {!isBulk &&
              <button type="submit" className="direct-send wa" value="direct-send" disabled={status === "saving"}>
                <WhatsAppIcon /> {ui("Direct send")}
              </button>}
            </div>
            {!isBulk && <p className="p-builder-note">{shareImage
              ? "Direct send uploads the image, then opens the entered customer's chat in WhatsApp Web with the message and preview-enabled scratch-card link. Review the preview, then click Send."
              : "Direct send creates the card and opens the entered customer's chat in WhatsApp Web. Review the message and click Send."}</p>}
            {isBulk && bulk.message && <p className={bulk.status === "error" ? "error" : "p-alert"} role={bulk.status === "error" ? "alert" : "status"}>{bulk.message}</p>}
            {!isBulk && status === "error" && (
              <p className="error" role="alert">
                {ui(message)}
              </p>
            )}
          </form>
        </section>
        <aside className="preview">
          <div className="preview-title">
            <span>{t("livePreview")}</span>
            <span>{t("recipientView")}</span>
          </div>
          <div
            className="phone"
            lang={form.language}
            style={{
              "--page-color": form.pageColor,
              "--text-color": form.textColor,
              "--accent": form.accentColor,
            }}
          >
            <div className="phone-brand">✦ {form.senderName}</div>
            <div className="mini">
              <GiftIcon /> {cardT("surprise")}
            </div>
            <h2>{form.headline || cardT("previewHeadline")}</h2>
            <ScratchCard card={{ ...form, branchId: isBulk ? bulk.previewId : form.branchId, couponCode: isBulk ? "AUTO-GENERATED" : form.couponCode, branchName }} preview t={cardT} />
            <small>{cardT("scratchLayer")}</small>
          </div>
        </aside>
      </div>
      {isBulk && bulk.result && <BulkResults key={bulk.result.batchId} result={bulk.result} onReset={bulk.reset} locked={saving || bulk.pending || bulk.restoring} token={token} businessId={business.businessId} />}
      {result && (
        <div
          className="backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("cardLive")}
        >
          <div className="modal">
            <div className="success">✓</div>
            <div className="kicker">{t("readyShare")}</div>
            <h2>{t("cardLive")}</h2>
            <p>{t("anyoneCanOpen")}</p>
            <div className="created-code">
              <span>{t("uniqueCoupon")}</span>
              <strong>{result.couponCode}</strong>
            </div>
            <div className="link-box">
              <input
                aria-label={ui("Share link")}
                value={shareUrl}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button onClick={copy}>{t("copy")}</button>
            </div>
            {message && <p className="copied">{ui(message)}</p>}
            <div className="modal-actions">
              <button className="wa" onClick={whatsapp}>
                <WhatsAppIcon /> {t("shareWhatsApp")}
              </button>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                {t("openCard")}
              </a>
            </div>
            <button
              className="again"
              onClick={() => {
                setResult(null);
                setMessage("");
              }}
            >
              {t("createAnother")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function PublicCard({ slug, language: dashboardLanguage }) {
  const [card, setCard] = useState(null);
  const language = card?.language || dashboardLanguage;
  const t = useMemo(() => cardTranslator(language), [language]);
  const [state, setState] = useState("loading");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [claimError, setClaimError] = useState("");
  useEffect(() => {
    requestJson(`/api/cards/${encodeURIComponent(slug)}`)
      .then((data) => {
        setCard(data);
        setRevealed(Boolean(data.scratchedAt));
        setState(data.used ? "used" : "ready");
      })
      .catch(() => setState("error"));
  }, [slug]);
  if (state === "loading")
    return (
      <main className="recipient status">
        <RecipientTopbar
          brand="JustConnect"
        />
        <div className="loader" />
        <p>{t("gettingReady")}</p>
      </main>
    );
  if (state === "error")
    return (
      <main className="recipient status">
        <RecipientTopbar
          brand="JustConnect"
        />
        <div className="broken">?</div>
        <h1>{t("notFound")}</h1>
        <p>{t("checkLink")}</p>
        <a href="/">{t("createCard")}</a>
      </main>
    );
  if (state === "used")
    return (
      <main
        className="recipient status used-card"
        style={{ "--accent": card?.accentColor }}
      >
        <RecipientTopbar
          brand={card?.senderName || "JustConnect"}
        />
        <div className="used-icon">✓</div>
        <h1>{t("alreadyUsed")}</h1>
        <p>{t("oneReveal")}</p>
        <a href="/">{t("createNew")}</a>
      </main>
    );
  const share = () =>
    window.open(
      `https://web.whatsapp.com/send?text=${encodeURIComponent(`I found ${card.offerTitle}! Try this scratch card: ${location.href}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  const claimHost = card.claimUrl
    ? new URL(card.claimUrl).hostname.replace(/^www\./, "")
    : "";
  const openClaimLink = () => window.location.assign(card.claimUrl);
  const claimCoupon = async () => {
    setState("claiming");
    setClaimError("");
    try {
      const result = await requestJson(
        `/api/cards/${encodeURIComponent(slug)}/claim`,
        { method: "POST" },
      );
      setCard((current) => ({ ...current, couponCode: result.couponCode,
        scratchedAt: result.scratchedAt, redeemedAt: result.redeemedAt }));
      setRevealed(true);
      setState("ready");
      return true;
    } catch (error) {
      if (error.status === 409) setState("used");
      else {
        setClaimError(error.message);
        setState("ready");
      }
      return false;
    }
  };
  const copyShareLink = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };
  return (
    <main
      className="recipient"
      lang={language}
      style={{
        "--accent": card.accentColor || DEFAULT_CARD.accentColor,
        "--page-color": card.pageColor || DEFAULT_CARD.pageColor,
        "--text-color": card.textColor || DEFAULT_CARD.textColor,
      }}
    >
      <RecipientTopbar
        brand={card.senderName}
      />
      <div className="glow one" />
      <div className="glow two" />
      <section className="experience">
        <div className="eyebrow">
          <GiftIcon /> {t("sentToYou")}
        </div>
        <h1>{card.headline}</h1>
        <p className="intro">{t("scratchInstruction")}</p>
        <ScratchCard card={card} onReveal={claimCoupon} t={t} />
        {state === "claiming" && (
          <p className="claim-status">{t("securing")}</p>
        )}
        {claimError && (
          <p className="claim-error" role="alert">
            {claimError} {t("scratchAgain")}
          </p>
        )}
        <div className="recipient-actions">
          {revealed && card.claimUrl && (
            <button className="claim" onClick={openClaimLink}>
              {t("claimOn")} {claimHost}
            </button>
          )}
          <button className="share" onClick={share} disabled={!revealed}>
            <WhatsAppIcon />{" "}
            {revealed ? t("shareWhatsApp") : t("revealToShare")}
          </button>
          {revealed && (
            <div className="public-share-link">
              <span title={location.href}>{location.href}</span>
              <button onClick={copyShareLink}>
                {copied ? t("copied") : t("copyLink")}
              </button>
            </div>
          )}
        </div>
        <p className="privacy">{t("privacy")}</p>
      </section>
    </main>
  );
}

function App() {
  const slug = useMemo(
    () => location.pathname.match(/^\/card\/([\w-]+)\/?$/)?.[1],
    [],
  );
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("lucky-drop-session") || "null");
    } catch {
      return null;
    }
  });
  const [checking, setChecking] = useState(Boolean(session?.token) && !slug);
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem("lucky-drop-language");
    return TRANSLATIONS[saved] ? saved : "en";
  });
  const interfaceLanguage = session && !slug && session.user.role !== "super-admin" ? language : "en";
  const t = useCallback(
    (key) => TRANSLATIONS[interfaceLanguage][key] || TRANSLATIONS.en[key] || key,
    [interfaceLanguage],
  );
  const clearSession = useCallback(() => {
    sessionStorage.removeItem("lucky-drop-session");
    setSession(null);
    setChecking(false);
  }, []);
  useEffect(() => {
    localStorage.setItem("lucky-drop-language", language);
    // Signed-in pages set their own locale based on the active workspace,
    // not the account role. Login remains English.
    if (!session?.token) document.documentElement.lang = "en";
  }, [language, session?.token]);
  useEffect(() => {
    window.addEventListener("scratch:expired", clearSession);
    return () => window.removeEventListener("scratch:expired", clearSession);
  }, [clearSession]);
  useEffect(() => {
    if (!session?.token || slug) return;
    let cancelled = false;
    portalApi("/api/auth/me", session.token)
      .then(({ user }) => {
        if (!cancelled) {
          const restored = { token: session.token, user };
          sessionStorage.setItem(
            "lucky-drop-session",
            JSON.stringify(restored),
          );
          setSession(restored);
        }
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.token, slug, clearSession]);
  const logout = async () => {
    try {
      await portalApi("/api/auth/logout", session.token, "POST", {});
    } catch {
      /* Local sign-out remains available when offline. */
    } finally {
      clearSession();
      history.replaceState({}, "", "/");
    }
  };
  if (slug)
    return (
      <>
        <Celebration />
        <PublicCard
          slug={slug}
          language={language}
          setLanguage={setLanguage}
          t={t}
        />
      </>
    );
  if (checking)
    return (
      <main className="p-shell">
        <div className="p-loading">
          <span />
          {workspaceTranslator(interfaceLanguage)("Restoring your workspace…")}
        </div>
      </main>
    );
  if (!session?.token)
    return (
      <PortalLogin
        onLogin={(data) => {
          sessionStorage.setItem("lucky-drop-session", JSON.stringify(data));
          setSession(data);
        }}
      />
    );
  return (
    <Portal
      session={session}
      language={language}
      setLanguage={setLanguage}
      t={t}
      Creator={Creator}
      ScratchCard={ScratchCard}
      cardTranslator={cardTranslator}
      onLogout={logout}
    />
  );
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
