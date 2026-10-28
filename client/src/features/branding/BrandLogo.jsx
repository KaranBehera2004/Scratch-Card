import React, { useState } from "react";

// Never leave the browser's broken-image icon/alt text in a branded card.
// A new source remounts this component, so replacing a logo retries normally.
export default function BrandLogo({ src, name, className = "", onFailure, onLoad }) {
  const [failed, setFailed] = useState(false);
  const available = Boolean(src) && !failed;
  return <span className={`brand-logo ${className}${available ? "" : " brand-logo-placeholder"}`.trim()}
    {...(!available ? { role: "img", "aria-label": `${name} brand icon`, title: src ? "Logo unavailable" : "No brand image configured" } : {})}>
    {available ? <img src={src} alt={`${name} logo`} onLoad={onLoad}
      onError={() => { setFailed(true); onFailure?.(); }} />
      : <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 3.5h7.8L21 13.2 13.2 21l-9.7-9.7z" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m12 12 4 4" />
      </svg>}
  </span>;
}
