import React, { useEffect, useState } from "react";
import { scratchApiUrl } from "../../../../server/shared/urls.js";
import BrandLogo from "./BrandLogo.jsx";
import "./branding.css";

export function brandImageUrl(image) {
  if (!/^\/api\/brand-images\/[a-f0-9]{64}$/.test(image || "")) return "";
  return import.meta.env.VITE_API_URL ? new URL(image, import.meta.env.VITE_API_URL).toString() : scratchApiUrl(image);
}
function CardBrandItem({ brand, side, imageRevision }) {
  const src = brandImageUrl(brand?.image);
  const requestedScale = Number(brand?.logoScale);
  const logoScale = Number.isFinite(requestedScale)
    ? Math.min(1.4, Math.max(.6, requestedScale / 100))
    : 1;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src, imageRevision]);
  if (!brand?.name) return <span className={`card-brand-item card-brand-${side} is-empty`} aria-hidden="true" />;
  return <span className={`card-brand-item card-brand-${side}`} style={{ "--brand-logo-scale": logoScale }}>
    <BrandLogo key={`${imageRevision}:${brand.image || "empty"}`} src={src} name={brand.name}
      onFailure={() => setFailed(true)} onLoad={() => setFailed(false)} />
    {(!src || failed) && <b title={brand.name}>{brand.name}</b>}
  </span>;
}
export default function CardBrandHeader({ businessName, normalBrand, fixedBrand, imageRevision = 0 }) {
  return <div className="card-brand-header">
    <CardBrandItem brand={normalBrand} side="left" imageRevision={imageRevision} />
    <strong className="card-business-name" title={businessName}>{!normalBrand?.name && !fixedBrand?.name && <i aria-hidden="true">✦ </i>}{businessName}</strong>
    <CardBrandItem brand={fixedBrand} side="right" imageRevision={imageRevision} />
  </div>;
}
