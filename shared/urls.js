export const PRODUCTION_APP_URL = "https://scratch.justconnect.biz";
export const PRODUCTION_API_URL = "https://api-scratch.justconnect.biz";

export function appOrigin(currentOrigin = globalThis.location?.origin) {
  if (!currentOrigin) return PRODUCTION_APP_URL;
  const url = new URL(currentOrigin);
  // Shares from Vercel aliases/previews should outlive those deployment URLs.
  // Keep localhost, LAN previews and alternative self-hosted installations local.
  if (url.hostname.endsWith(".vercel.app") ||
      url.hostname === new URL(PRODUCTION_APP_URL).hostname ||
      url.hostname === new URL(PRODUCTION_API_URL).hostname) {
    return PRODUCTION_APP_URL;
  }
  return url.origin;
}

export function scratchCardUrl(slug, currentOrigin) {
  return `${appOrigin(currentOrigin)}/card/${encodeURIComponent(slug)}`;
}
