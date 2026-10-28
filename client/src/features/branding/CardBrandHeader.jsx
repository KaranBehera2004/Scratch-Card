import React, { useEffect, useRef, useState } from "react";
import { scratchApiUrl } from "../../../../server/shared/urls.js";
import BrandLogo from "./BrandLogo.jsx";
import "./branding.css";

export function brandImageUrl(image) {
  if (!/^\/api\/brand-images\/[a-f0-9]{64}$/.test(image || "")) return "";
  return import.meta.env.VITE_API_URL ? new URL(image, import.meta.env.VITE_API_URL).toString() : scratchApiUrl(image);
}
// Positions are a percentage of the image's own box, so they look the same on
// the narrow creator preview and the wider public card.
const clampOffset = (value) => Number.isFinite(Number(value)) ? Math.min(150, Math.max(-150, Math.round(Number(value)))) : 0;
function CardBrandItem({ brand, side, imageRevision, onMove }) {
  const src = brandImageUrl(brand?.image);
  const requestedScale = Number(brand?.logoScale);
  const logoScale = Number.isFinite(requestedScale)
    ? Math.min(1.4, Math.max(.6, requestedScale / 100))
    : 1;
  const offsetX = clampOffset(brand?.offsetX), offsetY = clampOffset(brand?.offsetY);
  const [failed, setFailed] = useState(false);
  const drag = useRef(null);
  useEffect(() => setFailed(false), [src, imageRevision]);
  if (!brand?.name) return <span className={`card-brand-item card-brand-${side} is-empty`} aria-hidden="true" />;
  const dragProps = onMove ? {
    title: "Drag to move",
    onDragStart: (event) => event.preventDefault(),
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX, offsetY,
        width: rect.width || 1, height: rect.height || 1 };
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Already released. */ }
    },
    onPointerMove(event) {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      onMove({
        x: clampOffset(start.offsetX + (event.clientX - start.x) / start.width * 100),
        y: clampOffset(start.offsetY + (event.clientY - start.y) / start.height * 100),
      });
    },
    onPointerUp() { drag.current = null; },
    onPointerCancel() { drag.current = null; },
  } : {};
  return <span className={`card-brand-item card-brand-${side}${onMove ? " is-draggable" : ""}`}
    style={{ "--brand-logo-scale": logoScale, "--brand-logo-x": offsetX, "--brand-logo-y": offsetY }} {...dragProps}>
    <BrandLogo key={`${imageRevision}:${brand.image || "empty"}`} src={src} name={brand.name}
      onFailure={() => setFailed(true)} onLoad={() => setFailed(false)} />
    {(!src || failed) && <b title={brand.name}>{brand.name}</b>}
  </span>;
}
// Pass onMove(side, { x, y }) to let the left, center and right images be dragged.
export default function CardBrandHeader({ businessName, normalBrand, fixedBrand, centerBrand, imageRevision = 0, onMove }) {
  const mover = (side) => onMove && ((position) => onMove(side, position));
  return <div className="card-brand-header">
    <CardBrandItem brand={normalBrand} side="left" imageRevision={imageRevision} onMove={mover("left")} />
    {centerBrand?.name
      ? <CardBrandItem brand={centerBrand} side="center" imageRevision={imageRevision} onMove={mover("center")} />
      : <strong className="card-business-name" title={businessName}>{businessName && !normalBrand?.name && !fixedBrand?.name && <i aria-hidden="true">✦ </i>}{businessName}</strong>}
    <CardBrandItem brand={fixedBrand} side="right" imageRevision={imageRevision} onMove={mover("right")} />
  </div>;
}
