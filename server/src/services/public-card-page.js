const escape = (value) => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

// Self-contained HTML also works when the app bundle or database is offline.
// Never interpolate a server exception, coupon code, or customer information.
export function publicCardErrorPage(problem, retryPath) {
  const retry = problem.retry && typeof retryPath === 'string' && /^\/share\//.test(retryPath);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${escape(problem.title)} · JustConnect</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#002b5c;color:#fff;font-family:system-ui,-apple-system,sans-serif}
header{height:72px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #ffffff20;font-weight:700;letter-spacing:.12em;font-size:14px}
header span{color:#f6a800;margin-right:10px}main{min-height:calc(100vh - 72px);display:grid;place-items:center;padding:32px 20px;background:radial-gradient(ellipse at top,#f6a80016,transparent 65%)}
section{width:min(100%,520px);padding:36px 28px;border:1px solid #ffffff26;border-radius:22px;background:#ffffff09;text-align:center}
.symbol{display:grid;place-items:center;margin:0 auto 24px;width:68px;height:68px;border:2px solid #f6a800;border-radius:50%;color:#f6a800;font-size:32px}
h1{font-size:clamp(24px,5vw,32px);line-height:1.25;margin:0 0 16px}p{color:#c4d5e8;line-height:1.7;margin:0;overflow-wrap:anywhere}
a{display:inline-flex;margin-top:24px;padding:13px 24px;border-radius:10px;background:#f6a800;color:#002b5c;text-decoration:none;font-weight:700}a:focus-visible{outline:3px solid white;outline-offset:4px}
footer{margin-top:28px;color:#a9bfd7;font-size:13px}
</style></head><body><header><span aria-hidden="true">✦</span>JUSTCONNECT</header><main>
<section role="alert" aria-labelledby="coupon-error-title"><div class="symbol" aria-hidden="true">!</div>
<h1 id="coupon-error-title">${escape(problem.title)}</h1><p>${escape(problem.description)}</p>
${retry ? `<a href="${escape(retryPath)}">Try again</a>` : ''}<footer>Secure rewards by JustConnect</footer>
</section></main></body></html>`;
}
