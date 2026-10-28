import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "../assets/favicon.js";
import Portal, { PortalLogin, portalApi } from "../features/portal/Portal.jsx";
import { workspaceTranslator } from "../i18n/workspace-i18n.js";
import { normalizeWhatsAppNumber, whatsAppCardUrl } from "../../../server/shared/whatsapp.js";
import { scratchApiUrl, scratchCardUrl, scratchShareUrl } from "../../../server/shared/urls.js";
import { publicCardProblem } from "../../../server/shared/public-card-errors.js";
import { createScratchSurface } from "../features/scratch/scratch-surface.js";
import CardBrandHeader from "../features/branding/CardBrandHeader.jsx";
import { pendingBulk, savedBulkDraft, useBulkGeneration, BranchQuantities, BulkResults } from "../features/bulk/BulkGenerate.jsx";
import "../styles/bulk.css";
import "../styles/styles.css";
import "../styles/share-link.css";
import "../styles/card-typography.css";
import "../styles/responsive.css";
import "../styles/public-card-errors.css";
import "../styles/brand.css";
import "../styles/card-design.css";

// Some in-app browsers and privacy modes block web storage, and touching it
// throws. Sign-in, language and shared cards must keep working in memory.
const storage = {
  get(area, key) {
    try { return window[area].getItem(key); } catch { return null; }
  },
  set(area, key, value) {
    try { window[area].setItem(key, value); } catch { /* Kept in memory for this page only. */ }
  },
  remove(area, key) {
    try { window[area].removeItem(key); } catch { /* Nothing was stored. */ }
  },
};

// After a deploy, an open tab can request code-split files that the new build
// no longer has. Reload once to pick up the current build instead of failing.
window.addEventListener("vite:preloadError", () => {
  const lastReload = Number(storage.get("sessionStorage", "scratch-card-chunk-reload") || 0);
  if (Date.now() - lastReload < 60000) return;
  storage.set("sessionStorage", "scratch-card-chunk-reload", String(Date.now()));
  window.location.reload();
});

const TRANSLATIONS = {
  en: {
    branch: "Department",
    allBranches: "All departments",
    allBrands: "All brands",
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
    rewardCardColor: "Reward card color",
    rewardCardText: "Reward card text",
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
    copyCode: "Copy code",
    codeCopied: "Coupon code copied.",
    showQr: "QR Code",
    qrTitle: "Scan to redeem",
    qrHelp: "A department staff member can scan this code from their dashboard.",
    linkCopied: "Link copied to your clipboard.",
    shareWhatsApp: "Open WhatsApp Web",
    openCard: "Open card",
    createAnother: "Create another card",
    close: "Close",
    goBack: "Go back",
    reward: "YOUR REWARD",
    useCode: "USE CODE",
    scratchHere: "SCRATCH HERE",
    swipeFinger: "Swipe with your finger",
    unlocked: "Offer unlocked!",
    couponRedeemed: "COUPON REDEEMED",
    couponAlreadyRedeemed: "Coupon is already redeemed",
    couponAlreadyExpired: "Coupon is already expired",
    couponExpired: "COUPON IS EXPIRED",
    expiredMessage: "This coupon has expired and can no longer be redeemed.",
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
    couponAlreadyRedeemed: "कूपन पहले ही उपयोग किया जा चुका है",
    couponAlreadyExpired: "कूपन की अवधि पहले ही समाप्त हो चुकी है",
    branch: "विभाग",
    allBranches: "सभी विभाग",
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
    close: "बंद करें",
    goBack: "वापस जाएँ",
    reward: "आपका इनाम",
    useCode: "कोड इस्तेमाल करें",
    scratchHere: "यहाँ स्क्रैच करें",
    swipeFinger: "अपनी उंगली से स्वाइप करें",
    unlocked: "ऑफर खुल गया!",
    couponExpired: "कूपन की अवधि समाप्त हो गई",
    expiredMessage: "इस कूपन की अवधि समाप्त हो गई है और अब इसका उपयोग नहीं किया जा सकता।",
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
    couponAlreadyRedeemed: "కూపన్ ఇప్పటికే ఉపయోగించబడింది",
    couponAlreadyExpired: "కూపన్ గడువు ఇప్పటికే ముగిసింది",
    branch: "విభాగం",
    allBranches: "అన్ని విభాగాలు",
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
    close: "మూసివేయండి",
    goBack: "వెనక్కి వెళ్లండి",
    reward: "మీ బహుమతి",
    useCode: "కోడ్ ఉపయోగించండి",
    scratchHere: "ఇక్కడ స్క్రాచ్ చేయండి",
    swipeFinger: "వేలితో స్వైప్ చేయండి",
    unlocked: "ఆఫర్ తెరుచుకుంది!",
    couponExpired: "కూపన్ గడువు ముగిసింది",
    expiredMessage: "ఈ కూపన్ గడువు ముగిసింది మరియు ఇకపై ఉపయోగించలేరు.",
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

const CARD_THEME_FIELDS = ["pageColor", "textColor", "accentColor", "ticketColor", "ticketTextColor"];
const CARD_LOGO_SCALE_FIELDS = ["normalLogoScale", "fixedLogoScale"];
const cardThemeKey = (businessId) => `scratch-card-theme:${businessId}`;
function readCardTheme(businessId) {
  try {
    const saved = JSON.parse(storage.get("localStorage", cardThemeKey(businessId)) || "{}");
    const colors = {
      ...Object.fromEntries(CARD_THEME_FIELDS.filter(key => /^#[\da-f]{6}$/i.test(saved[key] || ""))
        .map(key => [key, saved[key]])),
      ...Object.fromEntries(CARD_LOGO_SCALE_FIELDS.filter(key => Number.isFinite(saved[key]) && saved[key] >= 60 && saved[key] <= 140)
        .map(key => [key, saved[key]])),
    };
    if (!colors.ticketColor || !colors.ticketTextColor) {
      const priorPreset = CARD_THEMES.find(theme => ["pageColor", "textColor", "accentColor"]
        .every(key => colors[key]?.toLowerCase() === theme[key].toLowerCase()));
      if (!colors.ticketColor && priorPreset) colors.ticketColor = priorPreset.ticketColor;
      if (!colors.ticketTextColor)
        colors.ticketTextColor = priorPreset?.ticketTextColor || contrastColor(colors.ticketColor || "#ffd5bd");
    }
    return colors;
  } catch { return {}; }
}
function saveCardTheme(businessId, colors) {
  const saved = { ...readCardTheme(businessId) };
  for (const key of CARD_THEME_FIELDS)
    if (/^#[\da-f]{6}$/i.test(colors[key] || "")) saved[key] = colors[key];
  for (const key of CARD_LOGO_SCALE_FIELDS)
    if (Number.isFinite(colors[key]) && colors[key] >= 60 && colors[key] <= 140) saved[key] = colors[key];
  storage.set("localStorage", cardThemeKey(businessId), JSON.stringify(saved));
}
function contrastColor(hex) {
  const rgb = hex?.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!rgb) return "#231622";
  const channels = rgb.slice(1).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance < .36 ? "#fff8f5" : "#231622";
}

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

function RecipientTopbar({ brand, normalBrand, fixedBrand }) {
  return (
    <header className="recipient-topbar">
      <a className="recipient-brand" href="/">
        <CardBrandHeader businessName={brand} normalBrand={normalBrand} fixedBrand={fixedBrand} />
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
  accentColor: "#ff9b72",
  ticketColor: "#ffd5bd",
  ticketTextColor: "#4b0024",
  pageColor: "#4b0024",
  textColor: "#fff8f5",
  normalLogoScale: 100,
  fixedLogoScale: 100,
};

const CARD_THEMES = [
  { name: "Plum", pageColor: "#4b0024", textColor: "#fff8f5", accentColor: "#ff9b72", ticketColor: "#ffd5bd", ticketTextColor: "#4b0024" },
  { name: "Navy", pageColor: "#002b5c", textColor: "#ffffff", accentColor: "#f6a800", ticketColor: "#ffe0b0", ticketTextColor: "#002b5c" },
  { name: "Emerald", pageColor: "#073d35", textColor: "#f4fff9", accentColor: "#e6b85c", ticketColor: "#e8eac6", ticketTextColor: "#073d35" },
  { name: "Midnight", pageColor: "#17152f", textColor: "#f8f4ff", accentColor: "#bd8cff", ticketColor: "#ead8f5", ticketTextColor: "#17152f" },
];

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

async function prepareWhatsAppPreview(shareUrl, hasImage) {
  let share;
  try {
    share = new URL(shareUrl, window.location.origin);
  } catch {
    return;
  }
  // Only production share routes contain server-rendered Open Graph metadata.
  // Fetch them before opening WhatsApp so a sleeping API and the image
  // conversion cannot make WhatsApp cache a title-only fallback preview.
  if (!/^\/share\/[A-Za-z0-9_-]+\/?$/.test(share.pathname)) return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  const warm = async (url) => {
    const response = await fetch(url, {
      cache: "reload",
      credentials: "omit",
      mode: url.origin === window.location.origin ? "same-origin" : "no-cors",
      signal: controller.signal,
    });
    if (response.type !== "opaque" && !response.ok)
      throw new Error("The WhatsApp preview is not ready yet.");
    await response.arrayBuffer();
  };
  try {
    const requests = [warm(share)];
    if (hasImage) {
      const image = new URL(`${share.pathname.replace(/\/$/, "")}/image`, share.origin);
      image.search = share.search;
      requests.push(warm(image));
    }
    await Promise.allSettled(requests);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(scratchApiUrl(url), { cache: "no-store", ...options });
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

function ScratchCard({ card, onReveal = () => {}, preview = false, t, onCopyCoupon, onShowQr }) {
  const alreadyScratched = Boolean(card.scratchedAt || card.used || card.expired);
  const canvasRef = useRef(null),
    cardRef = useRef(null),
    surfaceRef = useRef(null),
    revealCallback = useRef(onReveal);
  useEffect(() => { revealCallback.current = onReveal; }, [onReveal]);
  const [progress, setProgress] = useState(preview || alreadyScratched ? 100 : 0);
  const paint = useCallback((ctx, width, height) => {
    ctx.globalCompositeOperation = "source-over";
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#b8c0ce");
    gradient.addColorStop(0.2, "#f8fafc");
    gradient.addColorStop(0.48, "#a4adbc");
    gradient.addColorStop(0.76, "#eef1f6");
    gradient.addColorStop(1, "#929cab");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,.3)";
    for (let x = -height; x < width + height; x += 34) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(0, -height, 10, height * 3);
      ctx.restore();
    }
    const badgeWidth = Math.min(230, width - 40), badgeHeight = 72;
    const badgeX = (width - badgeWidth) / 2, badgeY = (height - badgeHeight) / 2;
    ctx.fillStyle = "rgba(255,255,255,.48)";
    ctx.strokeStyle = "rgba(61,70,88,.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 18);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#30394b";
    ctx.font = "800 15px DM Sans, system-ui";
    ctx.fillText(
      `✦  ${t("scratchHere")}  ✦`,
      width / 2,
      height / 2 - 10,
    );
    ctx.fillStyle = "#657084";
    ctx.font = "500 12px DM Sans, system-ui";
    ctx.fillText(t("swipeFinger"), width / 2, height / 2 + 16);
  }, [t]);
  useEffect(() => {
    if (preview || alreadyScratched || !canvasRef.current) return;
    const surface = createScratchSurface(canvasRef.current, {
      paint, onProgress: setProgress, onComplete: () => revealCallback.current(),
    });
    surfaceRef.current = surface;
    const observer = new ResizeObserver(surface.resize);
    observer.observe(cardRef.current);
    return () => { observer.disconnect(); surface.dispose(); surfaceRef.current = null; };
  }, [paint, preview, alreadyScratched]);
  return (
    <div
      className={`scratch-shell ${preview ? "is-preview" : ""}${card.expired ? " is-expired" : ""}${card.redeemed ? " is-redeemed" : ""}`}
      style={{ "--accent": card.accentColor || DEFAULT_CARD.accentColor,
        "--ticket-color": card.ticketColor || DEFAULT_CARD.ticketColor,
        "--ticket-ink": card.ticketTextColor || DEFAULT_CARD.ticketTextColor }}
    >
      <i className="ticket-edge left" />
      <i className="ticket-edge right" />
      <div className={`scratch-card${card.branchName ? " has-branch" : ""}`} ref={cardRef}>
        <div className="offer-content">
          <div className="offer-branch">{card.brandName || card.normalBrand?.name || (card.branchId ? card.branchName : t("allBrands"))}</div>
          <span>{t("reward")}</span>
          <strong>{card.offerTitle}</strong>
          <p>{card.description}</p>
          {card.redeemed ? null : card.expired ? (
            <b className="expired-coupon-label">{t("couponExpired")}</b>
          ) : card.couponCode ? (
            <div className="coupon-code-row">
              <b>{t("useCode")} · {card.couponCode}</b>
              {(onCopyCoupon || onShowQr) && <div className="coupon-code-actions">
                {onCopyCoupon && <button type="button" onClick={onCopyCoupon}>{t("copyCode")}</button>}
                {onShowQr && <button type="button" onClick={onShowQr}>{t("showQr")}</button>}
              </div>}
            </div>
          ) : null}
        </div>
        {!preview && !alreadyScratched && (
          <canvas
            ref={canvasRef}
            onPointerDown={(event) => surfaceRef.current?.start(event)}
            onPointerMove={(event) => surfaceRef.current?.move(event)}
            onPointerUp={(event) => surfaceRef.current?.end(event)}
            onPointerCancel={(event) => surfaceRef.current?.end(event)}
            onLostPointerCapture={(event) => surfaceRef.current?.end(event)}
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
            {card.redeemed
              ? t("couponRedeemed")
              : card.expired
              ? t("couponExpired")
              : progress === 100 ? t("unlocked") : `${progress}% ${t("revealed")}`}
          </small>
        </>
      )}
    </div>
  );
}

function CouponQrDialog({ couponCode, t, onClose }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(couponCode, {
        width: 300,
        margin: 2,
        color: { dark: "#071f3f", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }))
      .then((value) => {
        if (active) setImage(value);
      });
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      active = false;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [couponCode, onClose]);
  return <div className="coupon-qr-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="coupon-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="coupon-qr-title">
      <button type="button" className="coupon-qr-close" onClick={onClose} aria-label={t("close")}>×</button>
      <span className="coupon-qr-kicker">{t("showQr")}</span>
      <h2 id="coupon-qr-title">{t("qrTitle")}</h2>
      <p>{t("qrHelp")}</p>
      {image ? <img src={image} alt={`QR code for coupon ${couponCode}`} /> : <div className="coupon-qr-loading" />}
      <strong>{couponCode}</strong>
      <button type="button" className="coupon-qr-done" onClick={onClose}>{t("close")}</button>
    </section>
  </div>;
}

function Creator({
  language,
  setLanguage,
  t,
  token,
  user,
  business,
  onCreated,
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
    displayBrandId: "",
    campaignName: "",
    customerPhone: "",
    expiresAt: "",
    language: "en",
    ...Object.fromEntries(Object.entries(savedBulkDraft(business.businessId)?.form || {}).filter(([key]) =>
      [...Object.keys(DEFAULT_CARD), "displayBrandId", "campaignName", "customerPhone", "language", "expiresAt"].includes(key)
        && !["senderName", "couponCode"].includes(key))),
    // Restore shared form fields only, never request-only recipients, branch rows or retry keys.
    ...Object.fromEntries(Object.entries(pendingBulk(business.businessId) || {}).filter(([key]) =>
      [...Object.keys(DEFAULT_CARD), "displayBrandId", "campaignName", "customerPhone", "language"].includes(key)
        && key !== "couponCode")),
    ...readCardTheme(business.businessId),
    expiresAt: pendingBulk(business.businessId)?.expiresAt
      ? (() => { const date = new Date(pendingBulk(business.businessId).expiresAt); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })()
      : pendingBulk(business.businessId) ? "" : savedBulkDraft(business.businessId)?.form?.expiresAt || "",
  }));
  // Creation always opens on Single Card. Saved bulk work remains available
  // when the user deliberately selects Bulk Generate.
  const [mode, setMode] = useState("single");
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
  const previewBranch = business?.branches?.find(item => item.branchId === (isBulk ? bulk.previewId : form.branchId));
  const normalBrand = business?.departments?.find(item => item.departmentId === previewBranch?.departmentId && item.status === "active");
  const fixedBrand = business?.brandSettings?.fixed;
  const cardImagesEnabled = business?.cardImagesEnabled !== false;
  const structureMode = business?.structureMode === "branch" ? "branch-department"
    : business?.structureMode === "brand" || !business?.structureMode ? "brand-department" : business.structureMode;
  const onlyStructure = structureMode.endsWith("-only");
  const brandStructure = structureMode.startsWith("brand");
  const update = (event) => {
    if (event.target.name !== "senderName") {
      if (CARD_THEME_FIELDS.includes(event.target.name))
        saveCardTheme(business.businessId, { [event.target.name]: event.target.value });
      setForm((value) => ({
        ...value,
        [event.target.name]: event.target.value,
      }));
    }
  };
  const applyCardTheme = (theme) => {
    const colors = { pageColor: theme.pageColor, textColor: theme.textColor,
      accentColor: theme.accentColor, ticketColor: theme.ticketColor, ticketTextColor: theme.ticketTextColor };
    saveCardTheme(business.businessId, colors);
    setForm(value => ({ ...value, ...colors }));
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
        ...(({ displayBrandId: _displayBrandId, ...automaticBrandForm }) => automaticBrandForm)(form),
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
      await prepareWhatsAppPreview(cardUrl, hasShareImage);
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
                <span>Brand &amp; Department</span>
                <select name="branchId" value={form.branchId} required={onlyStructure} onChange={update}>
                  <option value="">{onlyStructure ? ui("Select branch") : ui("All branches")}</option>
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
            {isBulk && <BranchQuantities bulk={bulk} business={business} onManageBranches={onManageBranches} />}
            <fieldset className="theme-panel">
              <legend>{t("cardTheme")}</legend>
              <div className="theme-presets" aria-label="Card theme presets">
                {CARD_THEMES.map(theme => {
                  const selected = ["pageColor", "textColor", "accentColor", "ticketColor", "ticketTextColor"].every(key => form[key].toLowerCase() === theme[key].toLowerCase());
                  return <button key={theme.name} type="button" className={selected ? "is-selected" : ""}
                    aria-pressed={selected} onClick={() => applyCardTheme(theme)}>
                    <i style={{ "--theme-page": theme.pageColor, "--theme-accent": theme.accentColor, "--theme-ticket": theme.ticketColor }} />
                    {theme.name}
                  </button>;
                })}
              </div>
              <div className="theme-controls">
                {[
                  ["pageColor", "pageBackground"],
                  ["textColor", "messageText"],
                  ["accentColor", "scratchCard"],
                  ["ticketColor", "rewardCardColor"],
                  ["ticketTextColor", "rewardCardText"],
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
              {cardImagesEnabled && <div className="logo-size-controls">
                <label>
                  <span>{ui("Selected brand logo size")}</span>
                  <div className="logo-size-control-row">
                    <input type="range" name="normalLogoScale" min="60" max="140" step="5"
                      value={form.normalLogoScale} disabled={!normalBrand?.image}
                      aria-label={ui("Selected brand logo size")}
                      onChange={(event) => {
                        const normalLogoScale = Number(event.target.value);
                        saveCardTheme(business.businessId, { normalLogoScale });
                        setForm(value => ({ ...value, normalLogoScale }));
                      }} />
                    <output>{form.normalLogoScale}%</output>
                  </div>
                </label>
                <label>
                  <span>{ui("Fixed brand logo size")}</span>
                  <div className="logo-size-control-row">
                    <input type="range" name="fixedLogoScale" min="60" max="140" step="5"
                      value={form.fixedLogoScale} disabled={!fixedBrand?.image}
                      aria-label={ui("Fixed brand logo size")}
                      onChange={(event) => {
                        const fixedLogoScale = Number(event.target.value);
                        saveCardTheme(business.businessId, { fixedLogoScale });
                        setForm(value => ({ ...value, fixedLogoScale }));
                      }} />
                    <output>{form.fixedLogoScale}%</output>
                  </div>
                </label>
              </div>}
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
              "--ticket-color": form.ticketColor,
              "--ticket-ink": form.ticketTextColor,
            }}
          >
            <div className="phone-brand"><CardBrandHeader businessName={form.senderName}
              normalBrand={normalBrand ? { ...normalBrand, image: cardImagesEnabled ? normalBrand.image : "", logoScale: form.normalLogoScale } : null}
              fixedBrand={fixedBrand ? { ...fixedBrand, image: cardImagesEnabled ? fixedBrand.image : "", logoScale: form.fixedLogoScale } : null} /></div>
            <div className="mini">
              <GiftIcon /> {cardT("surprise")}
            </div>
            <h2>{form.headline || cardT("previewHeadline")}</h2>
            <ScratchCard card={{ ...form, normalBrand, brandName: brandStructure
              ? normalBrand?.name || (previewBranch?.name || cardT("allBrands"))
              : branchName,
            branchId: isBulk ? bulk.previewId : form.branchId, couponCode: isBulk ? "AUTO-GENERATED" : form.couponCode, branchName }} preview t={cardT} />
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
            <button
              type="button"
              className="modal-close"
              aria-label={t("close")}
              title={t("close")}
              onClick={() => {
                setResult(null);
                setMessage("");
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
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
  const [problem, setProblem] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [couponCopied, setCouponCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const goBack = () => {
    try {
      const saved = sessionStorage.getItem("scratch-card-dashboard-return");
      if (saved) {
        const destination = new URL(saved, window.location.origin);
        if (destination.origin === window.location.origin && !destination.pathname.startsWith("/card/")) {
          window.location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
          return;
        }
      }
    } catch {
      // Continue with browser navigation when storage is unavailable.
    }
    let sameOriginReferrer = false;
    try {
      sameOriginReferrer = Boolean(document.referrer)
        && new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameOriginReferrer = false;
    }
    if (sameOriginReferrer && window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.location.assign("/");
    }, 150);
  };
  useEffect(() => {
    let current = true, timeout;
    const controller = new AbortController();
    setState("loading");
    setCard(null);
    setRevealed(false);
    setQrOpen(false);
    setClaimError("");
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(slug)) {
      setProblem(publicCardProblem({ code: "CARD_NOT_FOUND" }));
      setState("error");
      return () => { current = false; controller.abort(); };
    }
    // A sleeping or redeploying API can take up to a minute to answer. Retry
    // temporary failures quietly before showing the customer an error page.
    const load = async () => {
      for (let attempt = 0; ; attempt++) {
        const request = new AbortController();
        const abort = () => request.abort();
        controller.signal.addEventListener("abort", abort);
        timeout = window.setTimeout(abort, 20000);
        try {
          return await requestJson(`/api/cards/${encodeURIComponent(slug)}`, { signal: request.signal });
        } catch (error) {
          const temporary = !error.status || error.status === 429 || error.status >= 500;
          if (!current || !temporary || attempt >= 2) throw error;
        } finally {
          window.clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abort);
        }
        await new Promise((resolve) => { timeout = window.setTimeout(resolve, 2000 * 2 ** attempt); });
        if (!current) throw new Error("The coupon request was cancelled.");
      }
    };
    load()
      .then((data) => {
        if (!current) return;
        if (data.slug !== slug || typeof data.offerTitle !== "string")
          throw new Error("Unexpected coupon response.");
        setCard(data);
        setRevealed(Boolean(data.used));
        // Reopen an already scratched link as the same unlocked reward.
        setState("ready");
      })
      .catch((error) => {
        if (!current) return;
        setProblem(publicCardProblem(error));
        setState("error");
      });
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [slug, loadAttempt]);
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
        <section className="public-card-problem" role="alert" aria-labelledby="coupon-error-title">
          <div className="broken" aria-hidden="true">!</div>
          <h1 id="coupon-error-title">{problem.title}</h1>
          <p>{problem.description}</p>
          {problem.retry && <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>Try again</button>}
          <small>Secure rewards by JustConnect</small>
        </section>
      </main>
    );
  const share = () =>
    window.open(
      `https://web.whatsapp.com/send?text=${encodeURIComponent(`I found ${card.offerTitle}! Try this scratch card: ${location.href}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  // A malformed stored link must hide the claim button, not blank the card.
  const claimHost = (() => {
    try { return card.claimUrl ? new URL(card.claimUrl).hostname.replace(/^www\./, "") : ""; }
    catch { return ""; }
  })();
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
      if (error.status === 409) {
        try {
          const current = await requestJson(`/api/cards/${encodeURIComponent(slug)}`);
          setCard(current);
          setRevealed(Boolean(current.used));
          setState("ready");
        } catch (loadError) {
          setProblem(publicCardProblem(loadError));
          setState("error");
        }
      } else if ([403, 404, 410].includes(error.status)) {
        if (error.status === 410) {
          // Reload the canonical state when a card expires during scratching.
          setLoadAttempt((value) => value + 1);
        } else {
          setProblem(publicCardProblem(error));
          setQrOpen(false);
          setState("error");
        }
      } else {
        setProblem(publicCardProblem(error));
        setQrOpen(false);
        setState("error");
      }
      return false;
    }
  };
  // In-app browsers may deny clipboard access; the link and code stay visible
  // for manual copying.
  const copyShareLink = async () => {
    try { await navigator.clipboard.writeText(location.href); } catch { return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };
  const copyCouponCode = async () => {
    try { await navigator.clipboard.writeText(card.couponCode); } catch { return; }
    setCouponCopied(true);
    window.setTimeout(() => setCouponCopied(false), 2500);
  };
  return (
    <main
      className="recipient"
      lang={language}
      style={{
        "--accent": card.accentColor || DEFAULT_CARD.accentColor,
        "--page-color": card.pageColor || DEFAULT_CARD.pageColor,
        "--text-color": card.textColor || DEFAULT_CARD.textColor,
        "--ticket-color": card.ticketColor || DEFAULT_CARD.ticketColor,
        "--ticket-ink": card.ticketTextColor || DEFAULT_CARD.ticketTextColor,
      }}
    >
      {!card.expired && !card.redeemed && <Celebration />}
      <RecipientTopbar
        brand={card.senderName}
        normalBrand={card.normalBrand}
        fixedBrand={card.fixedBrand}
      />
      <button type="button" className="public-card-back" onClick={goBack}>
        <span aria-hidden="true">←</span> {t("goBack")}
      </button>
      <div className="glow one" />
      <div className="glow two" />
      <section className="experience">
        {card.expired && <h1>{t("couponAlreadyExpired")}</h1>}
        {!card.expired && (
          <>
            <div className="eyebrow">
              <GiftIcon /> {t("sentToYou")}
            </div>
            <h1>{card.redeemed ? t("couponAlreadyRedeemed") : card.headline}</h1>
            <p className="intro">
              {card.used
                ? (card.redeemed ? t("alreadyUsed") : t("unlocked"))
                : t("scratchInstruction")}
            </p>
          </>
        )}
        <ScratchCard card={card} onReveal={claimCoupon} t={t}
          onCopyCoupon={revealed && !card.expired && !card.redeemed ? copyCouponCode : undefined}
          onShowQr={revealed && !card.expired && !card.redeemed ? () => setQrOpen(true) : undefined} />
        {couponCopied && <p className="coupon-copy-notice" role="status">{t("codeCopied")}</p>}
        {state === "claiming" && (
          <p className="claim-status">{t("securing")}</p>
        )}
        {claimError && (
          <p className="claim-error" role="alert">
            {claimError} {t("scratchAgain")}
          </p>
        )}
        {!card.expired && !card.redeemed && <div className="recipient-actions">
          {revealed && claimHost && (
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
        </div>}
        <p className="privacy">{t("privacy")}</p>
      </section>
      {qrOpen && <CouponQrDialog couponCode={card.couponCode} t={t} onClose={() => setQrOpen(false)} />}
    </main>
  );
}

function App() {
  const slug = useMemo(
    () => location.pathname.match(/^\/card\/([\w-]+)\/?$/)?.[1]
      || (/^\/card(?:\/|$)/.test(location.pathname) ? "!" : undefined),
    [],
  );
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(storage.get("sessionStorage", "lucky-drop-session") || "null");
    } catch {
      return null;
    }
  });
  const [checking, setChecking] = useState(Boolean(session?.token) && !slug);
  const [language, setLanguage] = useState(() => {
    const saved = storage.get("localStorage", "lucky-drop-language");
    return TRANSLATIONS[saved] ? saved : "en";
  });
  const interfaceLanguage = session && !slug && session.user.role !== "super-admin" ? language : "en";
  const t = useCallback(
    (key) => TRANSLATIONS[interfaceLanguage][key] || TRANSLATIONS.en[key] || key,
    [interfaceLanguage],
  );
  const clearSession = useCallback(() => {
    storage.remove("sessionStorage", "lucky-drop-session");
    setSession(null);
    setChecking(false);
  }, []);
  useEffect(() => {
    storage.set("localStorage", "lucky-drop-language", language);
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
          storage.set("sessionStorage", "lucky-drop-session", JSON.stringify(restored));
          setSession(restored);
        }
      })
      .catch((error) => {
        // Only a rejected session signs the user out. A network blip, cold
        // start or deploy keeps it, and the workspace offers Retry instead.
        if (!cancelled && [401, 403].includes(error.status)) clearSession();
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
        <PublicCard
          slug={slug}
          language={language}
          setLanguage={setLanguage}
          t={t}
        />
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
          storage.set("sessionStorage", "lucky-drop-session", JSON.stringify(data));
          setSession(data);
        }}
      />
    );
  return (
    <Portal
      session={session}
      onSessionChange={(data) => {
        storage.set("sessionStorage", "lucky-drop-session", JSON.stringify(data));
        setSession(data);
      }}
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
// Without a boundary, one unexpected render error blanks the whole page.
class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Unexpected page error:", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="recipient status">
        <RecipientTopbar brand="JustConnect" />
        <section className="public-card-problem" role="alert" aria-labelledby="page-error-title">
          <div className="broken" aria-hidden="true">!</div>
          <h1 id="page-error-title">Something went wrong</h1>
          <p>This page hit an unexpected problem. Reload it to continue; anything already saved is safe.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
          <small>Secure rewards by JustConnect</small>
        </section>
      </main>
    );
  }
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
