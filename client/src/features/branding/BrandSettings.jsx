import React, { useState } from "react";
import { useWorkspaceText } from "../../i18n/workspace-i18n.js";
import CardBrandHeader, { brandImageUrl } from "./CardBrandHeader.jsx";
import BrandLogo from "./BrandLogo.jsx";

async function verifySavedLogo(src) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let objectUrl;
  try {
    const response = await fetch(src, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("The image address did not return an image");
    objectUrl = URL.createObjectURL(await response.blob());
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth > 0 ? resolve() : reject(new Error("Invalid image"));
      image.onerror = () => reject(new Error("The saved image could not be decoded"));
      image.src = objectUrl;
    });
  } catch (error) {
    throw new Error(`Brand details were saved, but the saved logo could not be loaded (${error.message}). Your selected file is kept here. Save again to retry, or choose the logo file again.`);
  } finally {
    clearTimeout(timeout);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function BrandForm({ title, description, initial, required, save, ui, onRetryImage, nameLabel = "Brand name", imageLabel = "Brand image",
  eyebrow, clearLabel = "Clear fixed brand", saveLabel = "Save brand" }) {
  const [name, setName] = useState(initial?.name || "");
  const [image, setImage] = useState(initial?.image || "");
  const [preview, setPreview] = useState(brandImageUrl(initial?.image));
  const [imageFailed, setImageFailed] = useState(false), [imageAttempt, setImageAttempt] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const choose = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Allow selecting the same file again after removing or replacing its logo.
    event.target.value = "";
    setError(""); setDone(false);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("Choose a JPG, PNG or WebP image smaller than 2 MB."); event.target.value = ""; return;
    }
    setBusy(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Unable to read this image.")); reader.readAsDataURL(file);
      });
      setImage(data); setPreview(data); setImageFailed(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <article className="p-card p-settings brand-setting-card">
    <span className="p-eyebrow">{ui(eyebrow || (required ? nameLabel : "Business Name"))}</span>
    <h2>{ui(title)}</h2><p>{ui(description)}</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(""); setDone(false);
      try {
        const result = await save({ name: name.trim(), image });
        const saved = result?.brand || result?.fixed || result?.center;
        if (!saved) throw new Error("The saved brand could not be confirmed. Refresh and try again.");
        const savedPreview = brandImageUrl(saved.image);
        if (savedPreview) await verifySavedLogo(savedPreview);
        setImage(saved.image || ""); setPreview(savedPreview); setImageFailed(false);
        setImageAttempt(value => value + 1); setDone(true);
      }
      catch (err) { setError(err.message); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="brand-form-fields">
        <label>{ui(nameLabel)}<input value={name} maxLength={60} required={required || Boolean(image)}
          onChange={event => { setName(event.target.value); setDone(false); }} /></label>
        <label>{ui(imageLabel)}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} /></label>
        <small>{ui("JPG, PNG or WebP, up to 2 MB. Transparent logos work best.")}</small>
        {preview && <div className="brand-upload-preview"><BrandLogo key={`${preview}:${imageAttempt}`} src={preview}
          name={name || ui("Brand image")} className="brand-logo-upload" onFailure={() => setImageFailed(true)} onLoad={() => setImageFailed(false)} />
          <button className="p-button small" type="button" onClick={() => { setImage(""); setPreview(""); setDone(false); }}>{ui("Remove image")}</button></div>}
        {preview && imageFailed && <div className="brand-image-notice" role="status">
          <p>{ui("This brand image could not be loaded. Retry, or upload the logo again and save the brand.")}</p>
          <button className="p-button small" type="button" onClick={() => { setImageFailed(false); setImageAttempt(value => value + 1); onRetryImage?.(); }}>{ui("Retry image")}</button>
        </div>}
        <div className="brand-form-actions"><button className="p-button primary" type="submit">{ui(busy ? "Saving…" : saveLabel)}</button>
          {!required && <button className="p-button" type="button" onClick={() => { setName(""); setImage(""); setPreview(""); setDone(false); }}>{ui(clearLabel)}</button>}</div>
      </fieldset>
      {error && <p className="p-alert error" role="alert">{ui(error)}</p>}
      {done && <p className="p-alert p-alert-success" role="status">{ui("Brand saved. New scratch cards will use these settings.")}</p>}
    </form>
  </article>;
}
export default function BrandSettings({ business, save, onManageBrands }) {
  const ui = useWorkspaceText();
  const brandMode = business.structureMode === "brand" || business.structureMode === "brand-department"
    || business.structureMode === "brand-only";
  const branchOnly = business.structureMode === "branch-only";
  const brandOnly = business.structureMode === "brand-only";
  const brands = (business.departments || []).filter(item => item.status !== "deleted");
  const [selected, setSelected] = useState(brands[0]?.departmentId || "");
  const [imageRevision, setImageRevision] = useState(0);
  const retryImages = () => setImageRevision(value => value + 1);
  const saveBrand = async (suffix, values) => { const result = await save(suffix, values); retryImages(); return result; };
  const current = brands.find(item => item.departmentId === selected) || brands[0];
  return <div className="brand-settings">
    <div className="p-card brand-settings-intro"><h2>{ui("Scratch-card images")}</h2>
      <p>{branchOnly ? ui("The business image appears on the right and the middle image in the centre of new cards. Existing coupons keep their original appearance.") : brandMode
        ? ui("The selected brand appears on the left, the middle image in the centre and the fixed brand on the right. Existing coupons keep their original branding.")
        : ui("The selected department appears on the left, the middle image in the centre and the business image on the right. Existing coupons keep their original branding.")}</p>
      <div className="brand-header-preview"><CardBrandHeader normalBrand={branchOnly ? null : current} fixedBrand={business.brandSettings?.fixed}
        centerBrand={business.brandSettings?.center} imageRevision={imageRevision} /></div>
    </div>
    <div className={`brand-settings-grid${branchOnly ? " is-single" : ""}`}>
      {!branchOnly && <section><div className="brand-choice"><label>{brandMode ? ui("Select brand") : ui("Select department")}<select aria-label={brandMode ? ui("Select brand") : ui("Select department")} value={current?.departmentId || ""} onChange={event => setSelected(event.target.value)}>
        {!brands.length && <option value="">{brandMode ? ui("No brands yet") : ui("No departments yet")}</option>}
        {brands.map(item => <option key={item.departmentId} value={item.departmentId}>{item.name}</option>)}
      </select></label><button className="p-button" onClick={onManageBrands} type="button">{brandOnly ? ui("Add brand") : brandMode ? ui("Add brands & departments") : ui("Add departments & branches")}</button></div>
      {current ? <BrandForm key={current.departmentId} title={brandMode ? "Selectable brand" : "Department image"}
        nameLabel={brandMode ? "Brand name" : "Department name"} imageLabel={brandMode ? "Brand image" : "Department image"}
        required initial={current} ui={ui} onRetryImage={retryImages}
        description={brandOnly ? "Configure this brand name and image for new scratch cards. Renaming keeps its staff and coupon assignments."
          : brandMode ? "Configure this brand name and image, then select it when creating a scratch card. Renaming keeps its existing departments and staff assignments."
          : "Configure this department name and image, then select it when creating a scratch card. Renaming keeps its existing branches and staff assignments."}
        save={values => saveBrand(`/${current.departmentId}`, values)} /> : <article className="p-card"><p>{brandOnly ? ui("Add a brand first, then configure its image here.") : brandMode ? ui("Add a brand and its departments first, then configure its image here.") : ui("Add a department and its branches first, then configure its image here.")}</p></article>}
      </section>}
      <BrandForm title={brandMode ? "Fixed brand" : "Business image"} initial={business.brandSettings?.fixed} ui={ui} onRetryImage={retryImages}
        nameLabel={brandMode ? "Brand name" : "Business name"} imageLabel={brandMode ? "Brand image" : "Business image"}
        description={brandMode ? "This brand name and image appear on every new scratch card, to the right of the business name. Leave both empty to turn it off."
          : "This business name and image appear on every new scratch card, to the right of the business name. Leave both empty to turn it off."}
        save={fixed => saveBrand("", { fixed })} />
      <BrandForm title="Middle image" eyebrow="Card centre" initial={business.brandSettings?.center} ui={ui} onRetryImage={retryImages}
        nameLabel="Image name" imageLabel="Middle image" clearLabel="Clear middle image" saveLabel="Save middle image"
        description="This image appears in the middle of every new scratch card, between the left and right images. Leave both empty to turn it off."
        save={center => saveBrand("", { center })} />
    </div>
  </div>;
}
