const problems = {
  CARD_NOT_FOUND: { status: 404, title: "We couldn’t find this coupon", description: "Check that the shared link is complete, or ask the business to send it again." },
  BUSINESS_UNAVAILABLE: { status: 404, title: "This coupon is no longer available", description: "The business linked to this coupon is unavailable. Please contact the business that sent you this link." },
  CARD_DISABLED: { status: 410, title: "This coupon has been disabled", description: "This offer is no longer active. Please contact the business for help." },
  CARD_EXPIRED: { status: 410, title: "This coupon has expired", description: "The offer has ended and can no longer be redeemed. Please contact the business for a current offer." },
  BUSINESS_PAUSED: { status: 403, title: "Rewards are temporarily paused", description: "This business is not accepting rewards right now. Please contact the business before trying again." },
  BRANCH_UNAVAILABLE: { status: 403, title: "This coupon is unavailable", description: "The department assigned to this coupon is not active. Please contact the business for help." },
  CARD_UNAVAILABLE: { status: 410, title: "This coupon is unavailable", description: "This offer is disabled or has expired. Please contact the business for help." },
  RETRY_LATER: { status: 429, title: "Please try again shortly", description: "Too many requests were received. Wait a moment, then try opening your coupon again.", retry: true },
  SERVICE_UNAVAILABLE: { status: 503, title: "We couldn’t load your coupon", description: "The service is temporarily unavailable. Please try again in a moment.", retry: true },
};

export function publicCardProblem(error = {}) {
  const legacy = {
    "Business not found.": "BUSINESS_UNAVAILABLE",
    "Card not found.": "CARD_NOT_FOUND",
    "This card is disabled.": "CARD_DISABLED",
    "This card is disabled or expired.": "CARD_UNAVAILABLE",
    "This business has paused its rewards.": "BUSINESS_PAUSED",
    "This coupon's assigned branch is not active.": "BRANCH_UNAVAILABLE",
  };
  const requested = error.data?.code || error.code || legacy[error.message];
  const fallback = error.status === 404 ? "CARD_NOT_FOUND"
    : error.status === 410 ? "CARD_UNAVAILABLE"
    : error.status === 403 ? "BRANCH_UNAVAILABLE"
    : error.status === 429 ? "RETRY_LATER" : "SERVICE_UNAVAILABLE";
  const code = Object.hasOwn(problems, requested) ? requested : fallback;
  return { code, retry: false, ...problems[code] };
}
