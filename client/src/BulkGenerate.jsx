import React, { useEffect, useRef, useState } from "react";
import { portalApi, Table, Badge, Icon } from "./Portal.jsx";
import { BULK_EXCEL_HEADERS, bulkExcelRows, branchQuantityError, unusedBulkBranches, addBulkBranch, mergeBulkResults, generatedByBranch, remainingBranchQuantities } from "./bulk-coupons.js";
import { useWorkspaceText } from "./workspace-i18n.js";
import BatchWhatsAppShare from "./BatchWhatsAppShare.jsx";
import { scratchCardUrl } from "../../shared/urls.js";

const storageKey = (id) => `scratch-bulk-pending:${id}`;
const resultsKey = (id) => `scratch-bulk-results:${id}`;
const draftKey = (id) => `scratch-bulk-draft:${id}`;
export function savedBulkDraft(id) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey(id)) || "null");
    return draft?.version === 1 && Array.isArray(draft.rows) && Array.isArray(draft.batchIds) ? draft : null;
  } catch { return null; }
}
function completedBatchIds(id) {
  const draft = savedBulkDraft(id);
  if (draft) return [...new Set(draft.batchIds.filter((value) => typeof value === "string" && value))];
  try {
    const legacy = sessionStorage.getItem(resultsKey(id));
    if (!legacy) return [];
    return [...new Set((legacy.startsWith("[") ? JSON.parse(legacy) : [legacy]).filter((value) => typeof value === "string" && value))];
  } catch { return []; }
}
export function completedBulk(id) {
  return completedBatchIds(id)[0] || "";
}
export function pendingBulk(id) {
  try { return JSON.parse(sessionStorage.getItem(storageKey(id)) || "null"); }
  catch { return null; }
}
export function useBulkGeneration({ form, setForm, business, token, user, onCreated, enabled }) {
  const ui = useWorkspaceText();
  const pending = pendingBulk(business.businessId);
  const active = (business.branches || []).filter((branch) => branch.status === "active");
  const [rows, setRows] = useState(() => savedBulkDraft(business.businessId)?.rows || pending?.branches || [{ branchId: active[0]?.branchId || "", quantity: 25 }]);
  const [previewId, setPreviewId] = useState(() => savedBulkDraft(business.businessId)?.previewId || rows[0]?.branchId || "");
  const [result, setResult] = useState(null), [status, setStatus] = useState("idle"), [message, setMessage] = useState("");
  const [restoreIds, setRestoreIds] = useState(() => completedBatchIds(business.businessId));
  const processing = useRef(false), confirmed = useRef(null), restoreRun = useRef(0);
  const persistDraft = (batchIds = confirmed.current?.batchIds || [], draftRows = rows, draftPreview = previewId) => {
    sessionStorage.setItem(draftKey(business.businessId), JSON.stringify({ version: 1, form, rows: draftRows, previewId: draftPreview, batchIds }));
  };
  const restore = async () => {
    if (!restoreIds.length) return;
    const run = ++restoreRun.current;
    setStatus("restoring"); setMessage("");
    try {
      const batches = await Promise.all(restoreIds.map((id) => portalApi(`/api/portal/batches/${encodeURIComponent(id)}?businessId=${encodeURIComponent(business.businessId)}`, token)));
      if (run !== restoreRun.current) return;
      if (batches.some((batch, index) => batch.batchId !== restoreIds[index] || !Array.isArray(batch.coupons) || batch.savedCount !== batch.coupons.length))
        throw new Error("Could not load all saved coupons. Try again.");
      const data = mergeBulkResults(batches);
      // Legacy tabs kept only one batch ID, not their draft. Rebuild its target
      // quantities from server-confirmed coupons instead of duplicating them.
      if (!savedBulkDraft(business.businessId)) {
        const counts = generatedByBranch(data.coupons);
        const retry = pendingBulk(business.businessId);
        if (retry && !data.batchIds.includes(`${business.businessId}:${retry.idempotencyKey}`))
          for (const row of retry.branches) counts.set(row.branchId, (counts.get(row.branchId) || 0) + row.quantity);
        setRows([...counts].map(([branchId, quantity]) => ({ branchId, quantity })));
        setPreviewId(counts.keys().next().value || "");
        if (!retry && data.coupons[0]) {
          const card = data.coupons[0], numbers = new Set(data.coupons.map((coupon) => coupon.customerPhone || ""));
          const date = card.expiresAt ? new Date(card.expiresAt) : null;
          setForm?.((current) => ({ ...current,
            ...Object.fromEntries(["headline", "offerTitle", "description", "claimUrl", "campaignName", "language", "pageColor", "textColor", "accentColor"]
              .filter((key) => card[key] !== undefined).map((key) => [key, card[key]])),
            customerPhone: numbers.size === 1 ? [...numbers][0] : "",
            expiresAt: date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
          }));
        }
      }
      confirmed.current = data; setResult(data); setStatus("done"); setRestoreIds([]);
    } catch (error) {
      if (run === restoreRun.current) { setStatus("error"); setMessage(ui("Unable to restore this draft: {message}", { message: ui(error.message) })); }
    }
  };
  useEffect(() => { restore(); return () => { restoreRun.current++; }; }, [token, business.businessId]);
  useEffect(() => {
    if (enabled && !restoreIds.length) {
      try { persistDraft(); } catch { /* A submit requires working retry storage before calling the API. */ }
    }
  }, [enabled, form, rows, previewId, result, restoreIds.length]);
  const remaining = remainingBranchQuantities(rows, result?.coupons);
  const total = remaining.reduce((sum, row) => sum + row.quantity, 0);
  const targetTotal = rows.reduce((sum, row) => sum + (Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0 ? Number(row.quantity) : 0), 0);
  const submit = async (event) => {
    event.preventDefault();
    if (processing.current || restoreIds.length) return;
    const stored = pendingBulk(business.businessId);
    const validation = stored ? "" : branchQuantityError(rows, confirmed.current?.coupons);
    if (validation) { setStatus("error"); setMessage(ui(validation)); return; }
    const branches = remainingBranchQuantities(rows, confirmed.current?.coupons);
    if (!stored && !branches.length) return;
    processing.current = true;
    setStatus("saving"); setMessage("");
    let saved;
    try {
      const payload = stored || { ...form, couponCode: undefined, branchId: undefined,
        businessId: business.businessId || user.businessId,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        branches,
        // Keep old imported pending requests intact, but never reuse contacts in a new batch.
        recipients: undefined,
        customerPhone: form.customerPhone,
        idempotencyKey: crypto.randomUUID(),
      };
      // Keep the exact request on a network failure, including across refresh.
      // Retries never generate a new key or use changed field values.
      persistDraft();
      sessionStorage.setItem(storageKey(business.businessId), JSON.stringify(payload));
      saved = await portalApi("/api/cards/bulk", token, "POST", payload);
      if (saved.batchId !== `${business.businessId}:${payload.idempotencyKey}` || !Array.isArray(saved.coupons)
        || saved.savedCount !== saved.coupons.length || saved.savedCount !== payload.branches.reduce((sum, row) => sum + row.quantity, 0)) {
        saved = null;
        throw new Error("The saved coupon count could not be confirmed. Retry the saved request.");
      }
      const combined = mergeBulkResults([confirmed.current, saved]);
      confirmed.current = combined; setResult(combined);
      // Save the complete ledger before clearing the pending retry. If storage
      // fails after commit, retrying still uses this same key, never a fresh one.
      persistDraft(combined.batchIds);
      try { sessionStorage.setItem(resultsKey(business.businessId), JSON.stringify(combined.batchIds)); } catch { /* The draft is the authoritative recovery record. */ }
      sessionStorage.removeItem(storageKey(business.businessId));
      setStatus("done");
      setMessage(`${ui("{count} coupons saved successfully. {total} coupons saved in this draft.", { count: saved.savedCount, total: combined.savedCount })}${saved.replayed ? ` ${ui("Existing batch recovered; no duplicate coupons created.")}` : ""}`);
      onCreated?.();
    } catch (error) {
      setStatus("error"); setMessage(saved ? ui("{count} coupons were saved, but recovery details could not be stored. Retry the saved request; no duplicate coupons will be created.", { count: saved.savedCount })
        : `${error.message}${pendingBulk(business.businessId) ? " Retry will use the same saved batch request." : ""}`);
      // Validation/capacity failures commit nothing and are safe to edit.
      if (error.savedCount === 0) sessionStorage.removeItem(storageKey(business.businessId));
    } finally { processing.current = false; }
  };
  return { rows, setRows, previewId, setPreviewId, result, status, message, total, targetTotal, submit,
    restoring: Boolean(restoreIds.length), restore,
    pending: Boolean(pending),
    reset: () => {
      if (processing.current || pendingBulk(business.businessId)) return;
      const freshRows = [{ branchId: active[0]?.branchId || "", quantity: 25 }];
      try {
        persistDraft([], freshRows, freshRows[0].branchId);
        sessionStorage.removeItem(resultsKey(business.businessId));
      } catch { setStatus("error"); setMessage(ui("Unable to start a new draft. Your saved coupons are unchanged.")); return; }
      restoreRun.current++; setRestoreIds([]); confirmed.current = null;
      setRows(freshRows); setPreviewId(freshRows[0].branchId); setResult(null); setMessage(""); setStatus("idle");
    }, active };
}
export function BranchQuantities({ bulk, business, onCreateBranch, onManageBranches }) {
  const ui = useWorkspaceText();
  const unused = unusedBulkBranches(bulk.rows, bulk.active);
  const emptyRow = bulk.rows.some((row) => !row.branchId);
  const branchLimit = Number(business?.limits?.branch || 0);
  const limitReached = branchLimit > 0 && (business?.branches?.length || 0) >= branchLimit;
  const generated = generatedByBranch(bulk.result?.coupons);
  return <section className="bulk-branches" aria-labelledby="branch-quantities-title">
    <h3 id="branch-quantities-title">{ui("Branch-wise Quantity")}</h3>
    <p className="p-builder-note">{ui("Choose distinct branches. Maximum 1,000 new coupons per generation.")}</p>
    <p className="p-builder-note">{ui("Quantity is the total wanted for this branch in this draft. Increasing it generates only the difference. Changing offer fields affects new coupons only.")}</p>
    {bulk.rows.map((row, index) => <div className="bulk-branch-row" key={index}>
      <label>Branch {index + 1}<select aria-label={`Bulk branch ${index + 1}`} required value={row.branchId}
        onChange={(event) => { const branchId = event.target.value; bulk.setRows((rows) => rows.map((item, i) => i === index ? { ...item, branchId } : item)); bulk.setPreviewId(branchId); }}>
        <option value="">{ui("Select branch")}</option>
        {bulk.active.map((branch) => <option key={branch.branchId} value={branch.branchId}
          disabled={bulk.rows.some((item, i) => i !== index && item.branchId === branch.branchId)}>{branch.name}</option>)}
      </select></label>
      <label>{ui("Number of coupons")}<input aria-label={`Coupon quantity ${index + 1}`} type="number" min={Math.max(1, generated.get(row.branchId) || 0)} step="1" required value={row.quantity}
        onChange={(event) => bulk.setRows((rows) => rows.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} /></label>
      <div className="bulk-row-actions">
        <button type="button" className="p-button small" aria-pressed={bulk.previewId === row.branchId}
          onClick={() => bulk.setPreviewId(row.branchId)}>{ui("Preview")}</button>
        <button type="button" className="p-button small" aria-label={`Remove branch row ${index + 1}`}
          onClick={() => { bulk.setRows((rows) => rows.filter((_, i) => i !== index)); if (bulk.previewId === row.branchId) bulk.setPreviewId(bulk.rows.find((_, i) => i !== index)?.branchId || ""); }}>{ui("Remove")}</button>
      </div>
      {(generated.get(row.branchId) || 0) > 0 && <small className="bulk-row-progress">{ui("{saved} generated · {remaining} remaining", { saved: generated.get(row.branchId), remaining: Math.max(0, Number(row.quantity) - generated.get(row.branchId)) || 0 })}</small>}
    </div>)}
    <div className="bulk-row-actions">
      <button type="button" className="p-button" disabled={!unused.length || emptyRow} onClick={() => {
        bulk.setRows((rows) => rows.some((row) => !row.branchId) ? rows
          : addBulkBranch(rows, unusedBulkBranches(rows, bulk.active)[0]?.branchId));
      }}>{ui("+ Add Branch")}</button>
      {onCreateBranch && <button type="button" className="p-button" disabled={limitReached} onClick={() => onCreateBranch((result) => {
        if (!result?.branch?.branchId) return;
        bulk.setRows((rows) => addBulkBranch(rows, result.branch.branchId));
        bulk.setPreviewId(result.branch.branchId);
      })}>{ui("Create new branch")}</button>}
      {onManageBranches && <button type="button" className="p-button" onClick={onManageBranches}>{ui("Manage branches")}</button>}
    </div>
    <p className="p-builder-note">{ui("Adds an existing branch to this batch. Each branch can appear only once.")}</p>
    {!!bulk.active.length && !unused.length && <p className="p-builder-note">{ui("All active branches are already in this batch. Create or activate another branch to add a row.")}</p>}
    {!!unused.length && emptyRow && <p className="p-builder-note">{ui("Choose a branch in the empty row before adding another row.")}</p>}
    {onCreateBranch && limitReached && <p className="p-builder-note">{ui("Branch limit reached ({limit}). Contact your administrator to increase it.", { limit: branchLimit })}</p>}
    {!bulk.active.length && <p role="alert">Create an active branch before generating bulk coupons.</p>}
    <div className="bulk-summary" aria-live="polite">
      {bulk.rows.map((row, index) => <span key={index}>{ui("{name}: {count} coupons", { name: bulk.active.find((branch) => branch.branchId === row.branchId)?.name || ui("Select branch"), count: row.quantity || 0 })}</span>)}
      <strong>{ui("Total: {count} coupons", { count: bulk.targetTotal })}</strong>
      {bulk.result && <span>{ui("Saved in this draft: {count} coupons", { count: bulk.result.savedCount })}</span>}
      <span>{ui("Remaining to generate: {count} coupons", { count: bulk.total })}</span>
    </div>
  </section>;
}
export function BulkResults({ result, onReset, locked, token, businessId }) {
  const ui = useWorkspaceText();
  const [branch, setBranch] = useState(""), [page, setPage] = useState(0), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const coupons = result.coupons;
  const branches = [...new Map(coupons.map((card) => [card.branchId, card.branchName])).entries()];
  const filtered = coupons.filter((card) => !branch || card.branchId === branch);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const copy = async (slug) => {
    try { await navigator.clipboard.writeText(scratchCardUrl(slug)); setNotice("Scratch link copied."); }
    catch { setNotice("Unable to copy. Select and copy the scratch link manually."); }
  };
  const download = async () => {
    setBusy(true); setNotice("");
    try {
      const { default: write } = await import("write-excel-file/universal");
      const blob = await write([BULK_EXCEL_HEADERS.map((value) => ({ value, type: String, fontWeight: "bold" })),
        ...bulkExcelRows(coupons, location.origin)], { sheet: "Bulk coupons", columns: BULK_EXCEL_HEADERS.map((_, i) => ({ width: i === 5 ? 55 : 25 })), stickyRowsCount: 1 }).toBlob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `bulk-coupons-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Excel contains all ${coupons.length} coupons from this draft.`);
    } catch (error) { setNotice(`Excel download failed: ${error.message}`); }
    finally { setBusy(false); }
  };
  return <section className="p-card bulk-results" aria-label="Generated batch results">
    <div className="bulk-results-head"><div><h2>{ui("Generated coupons")}</h2><p>{ui("{count} coupons saved in this draft", { count: result.savedCount })}</p></div>
      <button className="p-button" onClick={download} disabled={busy || locked}><Icon name="download" />{ui(busy ? "Preparing Excel…" : "Download Excel")}</button>
      <button className="p-button primary" onClick={() => setSendOpen(true)} disabled={busy || locked || !coupons.length}>{ui("Send via WhatsApp")}</button>
      <button className="p-button" onClick={onReset} disabled={locked || busy}>{ui("Start new draft")}</button></div>
    <label className="bulk-filter">{ui("Filter results by branch")}<select aria-label="Filter batch by branch" value={branch} onChange={(event) => { setBranch(event.target.value); setPage(0); }}>
      <option value="">{ui("All branches")}</option>{branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <p className="p-builder-note">{ui("Download Excel includes every coupon generated in this draft, across all branches and generations, regardless of this filter or page.")}</p>
    <p className="p-builder-note">{ui("Send via WhatsApp downloads all coupons from this draft as Excel and opens one chat in WhatsApp Web. Attach the downloaded file manually.")}</p>
    {notice && <p role="status">{notice}</p>}
    <Table columns={["Branch", "Coupon code", "WhatsApp number", "Offer", "Scratch link", "Expiry", "Status", "Actions"]} empty={!filtered.length}>
      {filtered.slice(page * 25, (page + 1) * 25).map((card) => <tr key={card.slug}>
        <td>{card.branchName}</td><td className="p-code">{card.couponCode}</td><td>{card.customerPhone || ui("No number assigned")}</td><td>{card.offerTitle}</td>
        <td><a href={scratchCardUrl(card.slug)} target="_blank" rel="noreferrer">{scratchCardUrl(card.slug)}</a></td>
        <td>{card.expiresAt ? new Date(card.expiresAt).toLocaleString() : ui("No expiry")}</td><td><Badge status={card.status} /></td>
        <td><button type="button" className="p-button small" onClick={() => copy(card.slug)}>{ui("Copy link")}</button></td>
      </tr>)}
    </Table>
    <div className="bulk-pagination"><button className="p-button" disabled={!page} onClick={() => setPage((value) => value - 1)}>{ui("Previous")}</button>
      <span>Page {page + 1} of {pageCount} · {filtered.length} coupons</span><button className="p-button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>{ui("Next")}</button></div>
    {sendOpen && <BatchWhatsAppShare batchId={result.batchId} batchIds={result.batchIds} coupons={coupons} token={token} businessId={businessId} onClose={() => setSendOpen(false)} />}
  </section>;
}
