export function normalizeWhatsAppNumber(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim()))
    throw new Error("Enter the customer's WhatsApp number.");
  const invalid = () => new Error("Enter a valid WhatsApp number with country code, or a 10-digit Indian mobile number.");
  if (typeof value !== "string" || value.length > 40) throw invalid();
  const raw = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(raw)) throw invalid();
  const compact = raw.replace(/[ ()-]/g, "");
  let digits = compact.replace(/^\+/, "");
  // The form explicitly identifies bare 10-digit mobile numbers as Indian.
  if (!compact.startsWith("+") && /^[6-9][0-9]{9}$/.test(digits)) digits = `91${digits}`;
  else if (!compact.startsWith("+") && digits.length < 11) throw invalid();
  if (!/^[1-9][0-9]{6,14}$/.test(digits)) throw invalid();
  return `+${digits}`;
}

export function whatsAppCardMessage(shareUrl) {
  return `A surprise is waiting for you! Scratch your card here: ${shareUrl}`;
}

export function whatsAppCardUrl(number, shareUrl) {
  const digits = normalizeWhatsAppNumber(number).slice(1);
  return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(whatsAppCardMessage(shareUrl))}`;
}
