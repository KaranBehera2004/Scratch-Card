import React, { useEffect, useRef, useState } from "react";
import { Icon, portalApi } from "./Portal.jsx";
import { useWorkspaceText } from "./workspace-i18n.js";
import { SHARE_EXCEL_HEADERS, shareExcelRows, mergeBulkResults } from "./bulk-coupons.js";
import { normalizeWhatsAppNumber } from "../../shared/whatsapp.js";

function defaultRecipient(coupons) {
  const numbers = new Set();
  for (const coupon of coupons) {
    try { numbers.add(normalizeWhatsAppNumber(coupon.customerPhone)); } catch { /* No assigned number. */ }
  }
  return numbers.size === 1 ? [...numbers][0] : "";
}

export default function BatchWhatsAppShare({ batchId, batchIds, coupons, token, businessId, onClose }) {
  const ui = useWorkspaceText(), dialog = useRef(null), processing = useRef(false), lastChatOpen = useRef(0);
  const [phone, setPhone] = useState(() => defaultRecipient(coupons));
  const [permission, setPermission] = useState(false), [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.focus();
  }, []);
  const close = () => { if (!processing.current) onClose(); };
  const recipient = () => {
    if (!permission) return "";
    try { return normalizeWhatsAppNumber(phone); }
    catch (failure) { setError(ui(failure.message)); return ""; }
  };
  const chatUrl = (number, count) => `https://web.whatsapp.com/send?phone=${number.slice(1)}&text=${encodeURIComponent(
    `I will share an Excel file containing ${count} scratch-card coupons here. Please see the attached file after I upload it.`)}`;
  const openBlank = () => {
    try { const chat = window.open("about:blank", "_blank"); if (chat) chat.opener = null; return chat; }
    catch { return null; }
  };
  const openDownloadedChat = () => {
    const number = recipient();
    if (!number || !downloaded || processing.current || Date.now() - lastChatOpen.current < 800) return;
    setError("");
    const chat = openBlank();
    try {
      if (!chat) throw new Error("blocked");
      chat.location.replace(chatUrl(number, downloaded.count));
      lastChatOpen.current = Date.now();
    } catch {
      try { chat?.close(); } catch { /* Browser may already own the tab. */ }
      setError(ui("WhatsApp Web could not be opened. Allow popups and try again."));
    }
  };
  const share = async (event) => {
    event.preventDefault();
    if (processing.current || downloaded) return;
    setError("");
    const number = recipient();
    if (!number) return;
    processing.current = true; setBusy(true);
    // Reserve ONE tab during the click, then prepare the file. No customer chats or messages are sent.
    const chat = openBlank();
    try {
      const ids = [...new Set((batchIds?.length ? batchIds : [batchId]).filter(Boolean))];
      const current = await Promise.all(ids.map(id => portalApi(`/api/portal/batches/${encodeURIComponent(id)}?businessId=${encodeURIComponent(businessId)}`, token)));
      // Never share only part of a continuous draft if a saved generation is
      // unavailable or incomplete. All reads remain authenticated and scoped.
      if (current.some((batch, index) => batch.batchId !== ids[index] || !Array.isArray(batch.coupons) || batch.savedCount !== batch.coupons.length))
        throw new Error(ui("Could not load all saved coupons. Try again."));
      const all = mergeBulkResults(current).coupons;
      if (!Array.isArray(all) || !all.length) throw new Error(ui("No coupons found in this batch."));
      const { default: write } = await import("write-excel-file/universal");
      const blob = await write([SHARE_EXCEL_HEADERS.map((value) => ({ value, type: String, fontWeight: "bold" })),
        ...shareExcelRows(all, location.origin)], { sheet: "WhatsApp coupons", stickyRowsCount: 1,
        columns: SHARE_EXCEL_HEADERS.map((_, index) => ({ width: index === 6 ? 55 : 25 })),
      }).toBlob();
      const filename = `whatsapp-coupons-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try {
        link.href = url; link.download = filename; link.style.display = "none";
        document.body.appendChild(link); link.click();
      } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setDownloaded({ filename, count: all.length });
      try {
        if (!chat) throw new Error("blocked");
        chat.location.replace(chatUrl(number, all.length));
        lastChatOpen.current = Date.now();
      } catch {
        try { chat?.close(); } catch { /* Browser may already own the tab. */ }
        setError(ui("Excel downloaded, but your browser blocked WhatsApp Web. Allow popups, then click Open WhatsApp Web."));
      }
    } catch (failure) {
      try { chat?.close(); } catch { /* The reserved tab may already be closed. */ }
      setError(ui("Could not prepare the batch Excel: {message}", { message: failure.message }));
    } finally { processing.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="p-dialog bulk-send-dialog" aria-labelledby="batch-share-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="p-dialog-head"><h2 id="batch-share-title">{ui("Send batch Excel via WhatsApp Web")}</h2>
      <button type="button" className="p-icon-button" aria-label={ui("Close dialog")} disabled={busy} onClick={close}><Icon name="close" /></button></div>
    <p>{ui("All {count} coupons generated in this draft will be included, regardless of branch filters or pages.", { count: coupons.length })}</p>
    <p className="p-builder-note">{ui("Excel includes each coupon’s assigned WhatsApp number. The recipient number below does not change those assignments.")}</p>
    <form onSubmit={share} noValidate>
      <fieldset className="creator-form-fields" disabled={busy}>
        <label className="bulk-share-recipient">{ui("Recipient WhatsApp number")}
          <input type="tel" inputMode="tel" autoComplete="off" placeholder="+91 98765 43210" maxLength="40" required
            value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} />
        </label>
        <label className="bulk-send-consent"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} />
          <span>{ui("I have permission to share these coupons and contact details with this number")}</span></label>
      </fieldset>
      <p className="p-alert">{ui("After WhatsApp Web opens, attach the downloaded Excel file using its attachment button, then click Send. This website cannot attach or send the file automatically.")}</p>
      {downloaded && <p role="status" className="bulk-share-download">{downloaded.filename} · {ui("{count} coupons", { count: downloaded.count })}<br />
        {ui("Excel downloaded. Attach the file in WhatsApp Web and click Send. Nothing has been sent automatically.")}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="p-button" disabled={busy} onClick={close}>{ui("Close dialog")}</button>
        {downloaded ? <button type="button" className="p-button primary" disabled={busy || !permission} onClick={openDownloadedChat}>{ui("Open WhatsApp Web")}</button>
          : <button type="submit" className="p-button primary" disabled={busy || !permission}>{ui(busy ? "Preparing Excel…" : "Download Excel & open WhatsApp Web")}</button>}
      </footer>
    </form>
  </dialog>;
}
