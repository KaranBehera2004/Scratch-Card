import React, { useCallback, useEffect, useRef, useState } from "react";
import "../../styles/portal.css";
import "../../styles/portal-theme.css";
import { WorkspaceLocale, useWorkspaceText, workspaceTranslator } from "../../i18n/workspace-i18n.js";
import { summarizeCampaigns } from "./campaigns.js";
import { scratchApiUrl, scratchCardUrl } from "../../../../server/shared/urls.js";
import { COUPON_STATUSES, summarizeCouponStatuses } from "../../../../server/shared/coupon-status.js";
import { EMPTY_COUPON_FILTERS, couponBranchKey, couponDepartmentKey, couponCampaignKey, couponStaffKey, couponDateBounds, filterCouponCards } from "./coupon-filters.js";
import BrandSettings from "../branding/BrandSettings.jsx";
import CardBrandHeader from "../branding/CardBrandHeader.jsx";

function JustConnectLogo({ theme = "light", className = "" }) {
  return (
    <img
      className={`p-brand-logo ${className}`.trim()}
      src={`/justconnect-logo-${theme === "dark" ? "dark" : "light"}.png`}
      alt="JustConnect"
      width={1323}
      height={216}
    />
  );
}

function apiUrl(url) {
  return import.meta.env.VITE_API_URL
    ? new URL(url, import.meta.env.VITE_API_URL).toString()
    : scratchApiUrl(url);
}

export async function portalApi(url, token, method = "GET", body) {
  let response;
  try {
    response = await fetch(apiUrl(url), {
    cache: "no-store",
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      import.meta.env.PROD
        ? "The Scratch-card API could not be reached. Please try again shortly."
        : "The Scratch-card API did not respond. Restart npm run dev and open the URL printed in the terminal.",
    );
  }
  const content = await response.text();
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error(
      import.meta.env.PROD
        ? "The Scratch-card API is temporarily unavailable. Please try again shortly."
        : "The Scratch-card API did not respond. Restart npm run dev and open the URL printed in the terminal.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 && token)
      window.dispatchEvent(new Event("scratch:expired"));
    throw Object.assign(new Error(result.message || "Unable to complete request."), {
      status: response.status,
      savedCount: result.savedCount,
      details: result.details,
    });
  }
  return result;
}
const paths = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  business: "M4 21V3h16v18 M8 7h2 M14 7h2 M8 11h2 M14 11h2 M10 21v-6h4v6",
  cards: "M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z M15 6v12",
  branches: "M12 3v6 M5 21v-7h14v7 M12 9v12 M3 21h4 M10 21h4 M17 21h4",
  team: "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-3a4 4 0 0 0-3-4 M17 2a4 4 0 0 1 0 8",
  analytics: "M3 3v18h18 M7 16v-4 M12 16V8 M17 16V5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  security: "M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6",
  audit: "M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h4",
  campaign: "M3 10l17-6v16L3 14z M7 15l2 6h4l-2-7",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "M9 5l7 7-7 7",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  logout: "M10 3H3v18h7 M8 12h13 M16 7l5 5-5 5",
  plus: "M12 4v16 M4 12h16",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  refresh: "M21 8V3l-3 3a9 9 0 1 0 3 9 M16 8h5",
  close: "M6 6l12 12 M6 18L18 6",
  check: "M5 12l4 4L19 6",
  moon: "M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  download: "M12 3v12 M7 10l5 5 5-5 M3 17v4h18v-4",
};
export function Icon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.cards} />
    </svg>
  );
}
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
const businessFields = [
  { key: "name", label: "Business name", required: true },
  { key: "website", label: "Website", type: "url" },
];
const businessLoginIdField = {
  key: "loginId",
  label: "Login ID (optional)",
  minLength: 6,
  maxLength: 16,
  pattern: "(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{6,16}",
  title: "Use 6–16 letters and numbers, including at least one of each. Leave empty to generate automatically.",
};
const randomLoginId = () => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = `${letters}${digits}`;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const result = [letters[bytes[0] % letters.length], digits[bytes[1] % digits.length]];
  for (let index = 2; index < bytes.length; index += 1)
    result.push(all[bytes[index] % all.length]);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = bytes[index] % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result.join("");
};
const branchFields = [
  { key: "name", label: "Branch name", required: true },
  { key: "address", label: "Address" },
];
const businessLimitFields = [
  {
    key: "cardLimit",
    label: "Scratch-card limit",
    type: "number",
    required: true,
  },
  { key: "branchLimit", label: "Branch limit", type: "number", required: true },
  { key: "departmentLimit", label: "Department limit", type: "number", required: true },
  {
    key: "accountLimit",
    label: "Business account limit",
    type: "number",
    required: true,
  },
];
// The dashboard has one consistent Branches & Departments presentation.
// Keep one-level legacy workspaces operational without changing their saved records.
const workspaceMode = (item) => ["branch-only", "brand-only"].includes(item?.structureMode)
  ? item.structureMode : "branch-department";
// Keep the saved structure/API mode unchanged, but present the hierarchy with
// the workspace's Brand + Department terminology throughout the dashboard.
const workspaceLanguageMode = (item) => workspaceMode(item) === "branch-only"
  ? "brand-only" : "brand-department";
const brandStructure = (item) => ["brand", "brand-department", "brand-only"].includes(item?.structureMode)
  || !item?.structureMode;
const onlyStructure = (item) => workspaceMode(item).endsWith("-only");
const businessPayload = (values) => ({
  name: values.name,
  website: values.website,
  loginId: values.loginId,
  status: values.status,
  limits: {
    card: Number(values.cardLimit),
    branch: Number(values.structureMode === "brand-only" ? values.departmentLimit : values.branchLimit),
    department: Number(values.structureMode === "branch-only" ? 0 : values.departmentLimit),
    account: Number(values.accountLimit),
  },
});

export function PortalLogin({ onLogin }) {
  const [loginId, setLoginId] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [platform, setPlatform] = useState({
    platformName: "JustConnect Rewards",
    supportEmail: "",
  });
  useEffect(() => {
    portalApi("/api/platform")
      .then(setPlatform)
      .catch(() => {});
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await portalApi("/api/auth/login", "", "POST", { loginId, password }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="p-login">
      <section className="p-login-story">
        <a className="p-brand" href="/" aria-label="JustConnect home">
          <JustConnectLogo theme="dark" />
        </a>
        <div className="p-login-copy">
          <div className="p-eyebrow">YOUR REWARDS. ONE WORKSPACE.</div>
          <h1>
            A little surprise.
            <br />A lasting connection.
          </h1>
          <p>
            Create memorable rewards, manage every department, and see how your
            offers perform.
          </p>
          <div className="p-login-points">
            <span>
              <Icon name="security" /> Secure business workspaces
            </span>
            <span>
              <Icon name="cards" /> Unique, one-time coupon codes
            </span>
            <span>
              <Icon name="analytics" /> Live reward activity
            </span>
          </div>
          <div className="p-login-ticket">
            <small>YOUR NEXT CUSTOMER MOMENT</small>
            <strong>Make it rewarding.</strong>
            <span>Scratch cards • Departments • Insights</span>
          </div>
        </div>
        <small className="p-login-footer">
          Built for growing businesses and their teams.
        </small>
      </section>
      <section className="p-login-panel">
        <form className="p-login-form" onSubmit={submit}>
          <JustConnectLogo className="p-login-logo" />
          <h2>Welcome back</h2>
          <p>{platform.loginMessage || "Sign in to manage your scratch-card workspace."}</p>
          <label>
            Login ID
            <input
              type="text"
              placeholder="Enter your login ID"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="username"
              required
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
            />
          </label>
          <label>
            Password
            <div className="p-password">
              <input
                type={show ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label="Toggle password visibility"
              >
                <Icon name="eye" />
              </button>
            </div>
          </label>
          {error && (
            <div className="p-alert error" role="alert">
              {error}
            </div>
          )}
          <button className="p-button primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to dashboard"}
            <Icon name="arrow" />
          </button>
          <small>
            {platform.supportEmail ? (
              <a href={`mailto:${platform.supportEmail}`}>
                Need access? Contact support.
              </a>
            ) : (
              "Need access? Contact your business administrator."
            )}
          </small>
          {platform.supportUrl && (
            <a className="p-support-link" href={platform.supportUrl} target="_blank" rel="noopener noreferrer">
              Visit support website <Icon name="arrow" size={16} />
            </a>
          )}
        </form>
        <span className="p-legal">
          {platform.platformName} • Business rewards platform
        </span>
      </section>
    </main>
  );
}

function Editor({ editor, onClose, onSave }) {
  const ui = useWorkspaceText();
  const [values, setValues] = useState(editor.values || {}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [visiblePasswords, setVisiblePasswords] = useState({});
  const formRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    formRef.current?.querySelector("input, select")?.focus();
    return () => previous?.focus();
  }, []);
  const keys = (event) => {
    if (event.key === "Escape" && !busy) onClose();
    if (event.key !== "Tab") return;
    const targets = [
      ...formRef.current.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      ),
    ];
    const first = targets[0],
      last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(values);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-backdrop">
      <form
        className={`p-dialog${editor.wide ? " p-business-editor" : ""}`}
        ref={formRef}
        onKeyDown={keys}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={ui(editor.title)}
      >
        <div className="p-dialog-head">
          <div>
            <span className="p-eyebrow">{ui("WORKSPACE CONTROL")}</span>
            <h2>{ui(editor.title)}</h2>
          </div>
          <button
            className="p-icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={ui("Close dialog")}
          >
            <Icon name="close" />
          </button>
        </div>
        {editor.description && <p>{ui(editor.description)}</p>}
        {editor.deletionSummary && <div className="p-alert p-deletion-summary" role="note">
          <span>{ui("Business")}: <strong>{editor.deletionSummary.businessName}</strong></span>
          <span>{ui("Coupons to delete")}: <strong>{editor.deletionSummary.count}</strong></span>
        </div>}
        <div className="p-editor-fields">
          {editor.fields.filter(field => !(field.key === "departmentLimit" && values.structureMode === "branch-only")
            && !(field.key === "branchLimit" && values.structureMode === "brand-only")).map((field) => (
            <label key={field.key}>
              {field.key === "branchLimit" && ["brand-department", "branch-department"].includes(values.structureMode) ? "Department limit"
                : field.key === "departmentLimit" && values.structureMode === "branch-department" ? "Branch limit"
                  : field.key === "departmentLimit" && brandStructure({ structureMode: values.structureMode }) ? "Brand limit"
                  : ui(field.label)}
              {field.type === "select" ? (
                <select
                  required={field.required}
                  value={values[field.key] || ""}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                >
                  {!field.options.some((option) => option.value === "") && (
                    <option value="">{ui("Select…")}</option>
                  )}
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {ui(option.label)}
                    </option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.checked })
                  }
                />
              ) : field.type === "password" ? (
                <div className="p-password">
                  <input
                    type={visiblePasswords[field.key] ? "text" : "password"}
                    minLength={field.minLength}
                    maxLength={field.maxLength ?? 200}
                    pattern={field.pattern}
                    title={field.title}
                    autoComplete="new-password"
                    required={field.required}
                    readOnly={field.readOnly}
                    value={values[field.key] ?? ""}
                    onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                  />
                  <button type="button" disabled={busy}
                    aria-label={`${visiblePasswords[field.key] ? "Hide" : "Show"} ${ui(field.label)}`}
                    onClick={() => setVisiblePasswords((current) => ({ ...current, [field.key]: !current[field.key] }))}>
                    <Icon name="eye" />
                  </button>
                </div>
              ) : field.actionLabel ? (
                <div className="p-input-action">
                  <input
                    type={field.type || "text"}
                    minLength={field.minLength}
                    maxLength={field.maxLength}
                    pattern={field.pattern}
                    title={field.title}
                    required={field.required}
                    value={values[field.key] ?? ""}
                    onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                  />
                  <button type="button" className="p-button" disabled={busy}
                    onClick={() => setValues({ ...values, [field.key]: field.generateValue() })}>
                    {ui(field.actionLabel)}
                  </button>
                </div>
              ) : (
                <input
                  type={field.type || "text"}
                  min={field.type === "number" ? 0 : undefined}
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                  pattern={field.pattern}
                  title={field.title}
                  required={field.required}
                  readOnly={field.readOnly}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                />
              )}
              {field.help && <small className="p-field-help">{ui(field.help)}</small>}
            </label>
          ))}
        </div>
        {error && (
          <div className="p-alert error" role="alert">
            {ui(error)}
          </div>
        )}
        <footer>
          <button
            type="button"
            className="p-button"
            onClick={onClose}
            disabled={busy}
          >
            {ui("Cancel")}
          </button>
          <button className={`p-button ${editor.danger ? "danger" : "primary"}`} disabled={busy}>
            {ui(busy ? "Saving…" : editor.submitLabel || "Save changes")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function RedemptionResultDialog({ feedback, onClose, structureMode }) {
  const ui = useWorkspaceText();
  const singleLevel = structureMode === "branch-only" || structureMode === "brand-only";
  const buttonRef = useRef(null);
  const success = feedback.type === "success";
  const details = feedback.coupon || feedback.details;
  useEffect(() => {
    buttonRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="p-backdrop p-result-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`p-dialog p-redemption-result is-${feedback.type}`}
        role="alertdialog" aria-modal="true" aria-labelledby="redemption-result-title">
        <button className="p-icon-button p-result-close" type="button" onClick={onClose}
          aria-label="Close result popup"><Icon name="close" /></button>
        <div className="p-result-symbol" aria-hidden="true">
          <Icon name={success ? "check" : "close"} size={34} />
        </div>
        <span className="p-eyebrow">{success ? "REDEMPTION SUCCESSFUL" : "REDEMPTION FAILED"}</span>
        <h2 id="redemption-result-title">{ui(feedback.title)}</h2>
        <p>{ui(feedback.message)}</p>
        {details && <dl className="p-result-details">
          {details.couponCode && <div><dt>Coupon code</dt><dd>{details.couponCode}</dd></div>}
          {details.offerTitle && <div><dt>Reward</dt><dd>{details.offerTitle}</dd></div>}
          {details.redemptionStatus && <div><dt>Status</dt><dd>{details.redemptionStatus}</dd></div>}
          {details.assignedBranchName && <div><dt>{ui("Assigned branch")}</dt><dd>{details.assignedBranchName === "All branches"
            ? ui("All branches") : details.assignedBranchName}</dd></div>}
          {!singleLevel && (details.assignedLocationName || details.assignedBranchName === "All branches") && <div><dt>{ui("Assigned department")}</dt>
            <dd>{details.assignedLocationName || ui("All departments")}</dd></div>}
          {details.redeemedBranchName && <div><dt>{ui("Redeemed branch")}</dt><dd>{details.redeemedBranchName}</dd></div>}
          {!singleLevel && details.redeemedLocationName && <div><dt>{ui("Redeemed department")}</dt><dd>{details.redeemedLocationName}</dd></div>}
          {details.branchName && !details.redeemedBranchName && <div><dt>{ui("Branch")}</dt><dd>{details.branchName === "All branches"
            ? ui("All branches") : details.branchName}</dd></div>}
          {details.staffName && <div><dt>Staff member</dt><dd>{details.staffName}</dd></div>}
          {details.redeemedAt && <div><dt>Date &amp; time</dt><dd>{new Date(details.redeemedAt).toLocaleString()}</dd></div>}
        </dl>}
        <button ref={buttonRef} className={`p-button ${success ? "primary" : "danger"}`}
          type="button" onClick={onClose}>{success ? "Done" : "Try another code"}</button>
      </section>
    </div>
  );
}

export function normalizeScannedCoupon(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let candidate = raw;
  try {
    const parsed = JSON.parse(raw);
    candidate = parsed.couponCode || parsed.code || raw;
  } catch {
    try {
      const url = new URL(raw);
      candidate = url.searchParams.get("coupon") || url.searchParams.get("code") || raw;
    } catch {
      // The customer QR intentionally contains only the coupon code.
    }
  }
  const normalized = String(candidate).trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{5,23}$/.test(normalized) ? normalized : "";
}

function CouponScannerDialog({ onClose, onScan }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const decoderRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const completedRef = useRef(false);
  const mountedRef = useRef(true);
  const [message, setMessage] = useState("Starting camera…");
  const [cameraStatus, setCameraStatus] = useState("starting");
  const finish = (value) => {
    if (completedRef.current) return;
    const code = normalizeScannedCoupon(value);
    if (!code) {
      setMessage("That QR code does not contain a valid coupon code.");
      return;
    }
    completedRef.current = true;
    onScan(code);
  };
  const decodeImage = (image) => {
    if (!decoderRef.current) return null;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = image.videoWidth || image.naturalWidth;
    canvas.height = image.videoHeight || image.naturalHeight;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = decoderRef.current(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    if (result?.data) finish(result.data);
    return completedRef.current;
  };
  const stopCamera = () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };
  const scanFrame = () => {
    if (!mountedRef.current || completedRef.current) return;
    const video = videoRef.current;
    if (video?.readyState >= 2 && decodeImage(video)) return;
    frameRef.current = requestAnimationFrame(scanFrame);
  };
  const cameraErrorMessage = (error) => {
    if (!window.isSecureContext)
      return "Live camera requires HTTPS. On a computer, http://localhost is also allowed.";
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError")
      return "Camera permission is blocked. Allow camera access in your browser's site settings, then click Retry camera.";
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError")
      return "No camera was found on this device. Connect a camera or upload a QR image.";
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError")
      return "The camera is being used by another app. Close that app, then click Retry camera.";
    return "The camera could not start. Check browser permission and click Retry camera.";
  };
  const startCamera = async () => {
    stopCamera();
    completedRef.current = false;
    setCameraStatus("starting");
    setMessage("Requesting camera access…");
    try {
      if (!window.isSecureContext) throw Object.assign(new Error("Insecure context"), { name: "SecurityError" });
      if (!navigator.mediaDevices?.getUserMedia)
        throw Object.assign(new Error("Camera API unavailable"), { name: "NotSupportedError" });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (error) {
        if (["NotAllowedError", "SecurityError"].includes(error?.name)) throw error;
        // Desktop webcams often do not expose a rear/environment camera.
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraStatus("live");
      setMessage("Camera is live. Point it at the customer's coupon QR code.");
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      if (!mountedRef.current) return;
      stopCamera();
      setCameraStatus("error");
      setMessage(cameraErrorMessage(error));
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    import("jsqr")
      .then(({ default: decoder }) => {
        if (mountedRef.current) decoderRef.current = decoder;
      })
      .catch(() => {
        if (mountedRef.current) setMessage("The QR scanner could not load. Refresh the page and try again.");
      });
    startCamera();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      mountedRef.current = false;
      stopCamera();
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const upload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const image = new Image();
    image.onload = async () => {
      if (!decoderRef.current) {
        try {
          decoderRef.current = (await import("jsqr")).default;
        } catch {
          setMessage("The QR scanner could not load. Refresh the page and try again.");
          URL.revokeObjectURL(image.src);
          return;
        }
      }
      const decoded = decodeImage(image);
      if (!decoded) setMessage("No coupon QR code was found in that image. Try a clearer photo.");
      URL.revokeObjectURL(image.src);
    };
    image.src = URL.createObjectURL(file);
  };
  return <div className="p-backdrop p-scanner-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="p-dialog p-qr-scanner" role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title">
      <div className="p-dialog-head">
        <div><span className="p-eyebrow">QR REDEMPTION</span><h2 id="qr-scanner-title">Scan coupon QR code</h2></div>
        <button type="button" className="p-icon-button" onClick={onClose} aria-label="Close scanner"><Icon name="close" /></button>
      </div>
      <div className="p-scanner-view"><video ref={videoRef} playsInline muted /><span>Place QR code inside the frame</span></div>
      <canvas ref={canvasRef} className="p-scanner-canvas" aria-hidden="true" />
      <p className="p-scanner-message" role="status">{message}</p>
      {cameraStatus !== "live" && <button type="button" className="p-button primary p-camera-retry"
        disabled={cameraStatus === "starting"} onClick={startCamera}>
        {cameraStatus === "starting" ? "Starting camera…" : "Retry camera"}
      </button>}
      <label className="p-button p-scanner-upload">Upload QR image<input type="file" accept="image/*" capture="environment" onChange={upload} /></label>
    </section>
  </div>;
}

function CouponManagerDialog({ business, cards, busy, onClose, onPreview, onCopy,
  onDeleteCoupon, onDeleteAll, onRestoreCoupon }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const closeRef = useRef(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = cards.filter((card) =>
    (status === "all" || (status === "deleted" ? Boolean(card.deletedAt) : card.status === status))
    && (!normalizedQuery || [card.couponCode, card.offerTitle, card.campaignName,
      card.branchName, card.customerPhone].some((value) =>
      String(value || "").toLowerCase().includes(normalizedQuery))));
  const count = (value) => cards.filter((card) => card.status === value).length;
  const used = cards.filter((card) => ["opened", "scratched", "redeemed"].includes(card.status)).length;
  const metrics = [
    ["Total coupons", cards.length],
    ["Used / interacted", used],
    ["Available", count("available")],
    ["Opened", count("opened")],
    ["Scratched", count("scratched")],
    ["Redeemed", count("redeemed")],
    ["Expired", count("expired")],
    ["Disabled", count("disabled")],
    ["Deleted by business", cards.filter(card => card.deletedAt).length],
  ];
  const branchName = (card) => business.branches?.find((branch) =>
    branch.branchId === card.branchId)?.name || card.branchName || "All departments";
  return (
    <div className="p-backdrop p-coupon-manager-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="p-dialog p-coupon-manager" role="dialog" aria-modal="true"
        aria-labelledby="coupon-manager-title">
        <div className="p-dialog-head">
          <div><span className="p-eyebrow">BUSINESS COUPON CONTROL</span>
            <h2 id="coupon-manager-title">Manage coupons · {business.name}</h2></div>
          <button ref={closeRef} className="p-icon-button" type="button" onClick={onClose}
            aria-label="Close coupon manager"><Icon name="close" /></button>
        </div>
        <div className="p-coupon-manager-summary" aria-label="Coupon status summary">
          {metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </div>
        <div className="p-coupon-manager-tools">
          <label><span>Search coupons</span><input type="search" aria-label="Search coupons" value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Code, reward, campaign, department or number" /></label>
          <label><span>Coupon status</span><select aria-label="Coupon status" value={status}
            onChange={(event) => setStatus(event.target.value)}>
            {["all", "available", "opened", "scratched", "redeemed", "expired", "disabled", "deleted"].map((value) =>
              <option key={value} value={value}>{value === "all" ? "All statuses" : value[0].toUpperCase() + value.slice(1)}</option>)}
          </select></label>
          <button className="p-button danger p-coupon-delete-all" type="button" disabled={busy || !filtered.length}
            onClick={() => onDeleteAll(filtered)}>Delete matching coupons ({filtered.length}) · {business.name}</button>
        </div>
        <div className="p-coupon-manager-count" aria-live="polite">
          Showing {filtered.length} of {cards.length} coupons
        </div>
        <Table columns={["Reward & coupon", "Branch", "Campaign", "Status", "Created", "Expiry date", "Actions"]}
          empty={!filtered.length}>
          {filtered.map((card) => <tr key={card.slug}>
            <td><b>{card.offerTitle}</b><small className="p-code">{card.couponCode}</small></td>
            <td>{branchName(card)}</td>
            <td>{card.campaignName || "General rewards"}</td>
            <td><Badge status={card.status} /></td>
            <td>{date(card.createdAt)}</td>
            <td>{card.expiresAt ? date(card.expiresAt) : "No expiry"}</td>
            <td><div className="p-row-actions">
              <button type="button" onClick={() => onPreview(card)}>Preview</button>
              <button type="button" disabled={busy} onClick={() => onCopy(card)}>Copy link</button>
              {card.deletedAt && <button type="button" disabled={busy}
                onClick={() => onRestoreCoupon(card)}>Restore coupon</button>}
              <button type="button" className="danger" disabled={busy}
                onClick={() => onDeleteCoupon(card)}>{card.deletedAt ? "Delete permanently (1)" : "Delete (1)"}</button>
            </div></td>
          </tr>)}
        </Table>
        <footer><button className="p-button" type="button" onClick={onClose}>Close</button></footer>
      </section>
    </div>
  );
}

const newBranchDraft = () => ({ name: "", address: "" });
let nextHierarchyDraftId = 0;
const newDepartmentDraft = (branchCount = 1) => ({
  draftId: ++nextHierarchyDraftId,
  name: "",
  branches: Array.from({ length: branchCount }, newBranchDraft),
});
const resizeDrafts = (items, count, factory) => [
  ...items.slice(0, count),
  ...Array.from({ length: Math.max(0, count - items.length) }, factory),
];

const activeCount = (items) => (items || []).filter((item) => item.status !== "deleted").length;
const hasBranchCapacity = (item) => Boolean(item) && (!item.limits?.branch
  || activeCount(item.branches) < item.limits.branch);
const hasDepartmentCapacity = (item) => Boolean(item) && (!item.limits?.department
  || activeCount(item.departments) < item.limits.department);
const hasHierarchyCapacity = (item) => workspaceMode(item) === "branch-only"
  ? hasBranchCapacity(item) : hasBranchCapacity(item) && hasDepartmentCapacity(item);

function DepartmentBranchEditor({ businesses, initialBusinessId, onClose, onSave, language }) {
  const firstAvailableBusiness = businesses.find(hasHierarchyCapacity);
  const [businessId, setBusinessId] = useState(initialBusinessId || firstAvailableBusiness?.businessId || "");
  const [departments, setDepartments] = useState(() => [newDepartmentDraft()]);
  const [singleName, setSingleName] = useState("");
  const [defaultBranchCount, setDefaultBranchCount] = useState(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const branchTotal = departments.reduce((sum, item) => sum + item.branches.length, 0);
  const selectedBusiness = businesses.find((item) => item.businessId === businessId);
  const ui = workspaceTranslator(language, workspaceLanguageMode(selectedBusiness));
  const departmentLimit = selectedBusiness?.limits?.department || 0;
  const departmentRemaining = departmentLimit
    ? Math.max(0, departmentLimit - activeCount(selectedBusiness?.departments))
    : Infinity;
  const branchLimit = selectedBusiness?.limits?.branch || 0;
  const branchRemaining = branchLimit
    ? Math.max(0, branchLimit - activeCount(selectedBusiness?.branches))
    : Infinity;
  const departmentRemainingAfterSave = Math.max(0, departmentRemaining - departments.length);
  const branchRemainingAfterSave = Math.max(0, branchRemaining - branchTotal);
  const departmentLimitExceeded = departments.length > departmentRemaining;
  const branchLimitExceeded = branchTotal > branchRemaining;
  const availableBranchSlots = Math.min(200, branchRemaining);
  // Keep the default independent of the panel count. Over-budget drafts can be
  // adjusted below, but the total allowance is still enforced before saving.
  const maximumDefaultBranchCount = Math.max(1, Math.min(50, availableBranchSlots));
  const effectiveDefaultBranchCount = Math.min(defaultBranchCount, maximumDefaultBranchCount);
  const maximumDepartmentsByBranchCapacity = departments.length
    + Math.floor(Math.max(0, availableBranchSlots - branchTotal) / effectiveDefaultBranchCount);
  const maximumNewDepartments = Math.min(
    20,
    Number.isFinite(departmentRemaining) ? departmentRemaining : 20,
    maximumDepartmentsByBranchCapacity,
  );
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      if (!departments.length) throw new Error("Add at least one department before saving.");
      if (branchTotal > availableBranchSlots) throw new Error("The hierarchy exceeds the available branch slots.");
      await onSave({ businessId, departments: departments.map(({ draftId, ...department }) => department) });
    }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  if (onlyStructure(selectedBusiness)) return <div className="p-backdrop">
    <form className="p-dialog p-department-editor" role="dialog" aria-modal="true"
      aria-label={workspaceMode(selectedBusiness) === "brand-only" ? "Add brand" : "Add branch"}
      onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { await onSave({ businessId, mode: workspaceMode(selectedBusiness), name: singleName.trim() }); }
        catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
      }}>
      <div className="p-dialog-head"><div><span className="p-eyebrow">PLATFORM STRUCTURE</span>
        <h2>{workspaceMode(selectedBusiness) === "brand-only" ? "Add brand" : "Add branch"}</h2></div>
        <button type="button" className="p-icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><Icon name="close" /></button>
      </div>
      <div className="p-editor-fields">
        <label>Business<select required value={businessId} disabled={busy || Boolean(initialBusinessId)}
          onChange={event => setBusinessId(event.target.value)}>
          <option value="">Select business</option>
          {businesses.map(item => <option key={item.businessId} value={item.businessId}
            disabled={!hasHierarchyCapacity(item)}>{item.name}</option>)}
        </select></label>
        <label>{workspaceMode(selectedBusiness) === "brand-only" ? "Brand name" : "Branch name"}
          <input required maxLength="60" value={singleName} onChange={event => setSingleName(event.target.value)} /></label>
      </div>
      {error && <div className="p-alert error" role="alert">{error}</div>}
      <footer><button type="button" className="p-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="p-button primary" disabled={busy || !hasHierarchyCapacity(selectedBusiness)}>{busy ? "Saving…" : "Create"}</button></footer>
    </form>
  </div>;
  return <div className="p-backdrop">
    <form className="p-dialog p-department-editor" role="dialog" aria-modal="true"
      aria-label={ui("Add departments and branches")} onSubmit={submit}>
      <div className="p-dialog-head">
        <div><span className="p-eyebrow">PLATFORM STRUCTURE</span><h2>{ui("Add departments and branches")}</h2></div>
        <button type="button" className="p-icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><Icon name="close" /></button>
      </div>
      <p>{ui("Choose how many departments this business needs, then add the branches belonging to each department. Everything is validated and saved together.")}</p>
      <div className="p-hierarchy-summary">
        <label>Business<select required value={businessId} disabled={busy || Boolean(initialBusinessId)}
          onChange={(event) => setBusinessId(event.target.value)}>
          <option value="">Select business</option>
          {businesses.map((item) => <option key={item.businessId} value={item.businessId}
            disabled={!hasHierarchyCapacity(item)}>
            {item.name}{hasHierarchyCapacity(item) ? "" : " — workspace limit reached"}
          </option>)}
        </select></label>
        <label>{ui("Number of departments")}<input type="number" min="0"
          max={maximumNewDepartments} step="1" required
          disabled={busy}
          value={departments.length} onChange={(event) => {
            const count = Math.min(maximumNewDepartments, Math.max(0, Math.trunc(Number(event.target.value) || 0)));
            setDepartments((current) => resizeDrafts(current, count, () => newDepartmentDraft(effectiveDefaultBranchCount)));
          }} /></label>
        <label>{ui("Branches per department")}<input type="number" min="1"
          max={maximumDefaultBranchCount} step="1" required
          disabled={busy || availableBranchSlots < Math.max(1, departments.length)}
          value={effectiveDefaultBranchCount} onChange={(event) => {
            const count = Math.min(maximumDefaultBranchCount, Math.max(1, Math.trunc(Number(event.target.value) || 1)));
            setDefaultBranchCount(count);
            setDepartments((current) => current.map((department) => ({
              ...department, branches: resizeDrafts(department.branches, count, newBranchDraft),
            })));
          }} /></label>
        <div><b>{branchTotal}</b><span>{ui("Total branches")}</span></div>
      </div>
      <p className="p-hierarchy-default-note">{ui("Set the default number of branches for every department. You can change each department below.")}</p>
      {Number.isFinite(departmentRemaining) && <div className={`p-alert${departmentLimitExceeded ? " error" : ""}`} role="status">
        {departmentRemaining
          ? ui("{remaining} of {limit} department slots remaining after saving this draft.", { remaining: departmentRemainingAfterSave, limit: departmentLimit })
          : ui("Department limit reached ({limit}). Increase it in the business workspace settings.", { limit: departmentLimit })}
      </div>}
      {Number.isFinite(branchRemaining) && <div className={`p-alert${branchLimitExceeded || branchRemaining === 0 ? " error" : ""}`} role="status">
        {branchRemaining
          ? ui("{remaining} of {limit} branch slots remaining after saving this draft. This limit applies to all departments together.", { remaining: branchRemainingAfterSave, limit: branchLimit })
          : ui("Branch limit reached ({limit}). Increase it in the business workspace settings before adding another branch.", { limit: branchLimit })}
      </div>}
      {branchTotal > availableBranchSlots && <div className="p-alert error" role="alert">
        {ui("This draft needs {total} branch slots. Only {remaining} are available. Reduce the counts below before saving.", {
          total: branchTotal, remaining: availableBranchSlots,
        })}
      </div>}
      <div className="p-department-list">
        {!departments.length && <div className="p-hierarchy-empty" role="status">
          <p>{ui("No departments added. Add a department to continue.")}</p>
          <button type="button" className="p-button" disabled={busy || maximumNewDepartments < 1}
            onClick={() => setDepartments([newDepartmentDraft(effectiveDefaultBranchCount)])}>
            <Icon name="plus" />{ui("Add department")}
          </button>
        </div>}
        {departments.map((department, departmentIndex) => <fieldset key={department.draftId}>
          <legend>{ui("Department {number}", { number: departmentIndex + 1 })}</legend>
          <div className="p-hierarchy-panel-actions">
            <button type="button" className="p-button small danger" disabled={busy}
              aria-label={ui("Remove department {number}", { number: departmentIndex + 1 })}
              onClick={() => setDepartments((current) => current.filter((item) => item.draftId !== department.draftId))}>
              <Icon name="close" size={16} />{ui("Remove department")}
            </button>
          </div>
          <div className="p-department-head">
            <label>{ui("Department name")}<input required maxLength="60" value={department.name}
              onChange={(event) => setDepartments((current) => current.map((item, index) =>
                index === departmentIndex ? { ...item, name: event.target.value } : item))} /></label>
            <label>{ui("Number of branches")}<input type="number" min="1"
              max={maximumDefaultBranchCount}
              step="1" required disabled={busy || availableBranchSlots < 1}
              value={department.branches.length} onChange={(event) => {
                const count = Math.min(maximumDefaultBranchCount, Math.max(1, Math.trunc(Number(event.target.value) || 1)));
                setDepartments((current) => current.map((item, index) => index === departmentIndex
                  ? { ...item, branches: resizeDrafts(item.branches, count, newBranchDraft) } : item));
              }} /></label>
          </div>
          <div className="p-hierarchy-branches">
            {department.branches.map((branch, branchIndex) => <div key={branchIndex}>
              <span>{ui("Branch {number}", { number: branchIndex + 1 })}</span>
              <label>{ui("Branch name")}<input required maxLength="60" value={branch.name}
                onChange={(event) => setDepartments((current) => current.map((item, index) => index === departmentIndex
                  ? { ...item, branches: item.branches.map((value, position) => position === branchIndex ? { ...value, name: event.target.value } : value) } : item))} /></label>
              <label>Address <em>optional</em><input maxLength="140" value={branch.address}
                onChange={(event) => setDepartments((current) => current.map((item, index) => index === departmentIndex
                  ? { ...item, branches: item.branches.map((value, position) => position === branchIndex ? { ...value, address: event.target.value } : value) } : item))} /></label>
            </div>)}
          </div>
        </fieldset>)}
      </div>
      {error && <div className="p-alert error" role="alert">{ui(error)}</div>}
      <footer><button type="button" className="p-button" onClick={onClose} disabled={busy}>{ui("Cancel")}</button>
        <button className="p-button primary" disabled={busy || !departments.length || departmentLimitExceeded || branchLimitExceeded || branchTotal > availableBranchSlots || branchRemaining === 0}>{busy ? ui("Saving…") : ui("Create {branches} {branchLabel} and {departments} {departmentLabel}", {
          branches: departments.length,
          branchLabel: departments.length === 1 ? "department" : "departments",
          departments: branchTotal,
          departmentLabel: branchTotal === 1 ? "branch" : "branches",
        })}</button></footer>
    </form>
  </div>;
}
function DeleteConfirmationDialog({ title, message, values = {}, confirmLabel, onClose, onDelete }) {
  const ui = useWorkspaceText();
  const ref = useRef(null);
  const cancelRef = useRef(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    cancelRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await onDelete();
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
      submitting.current = false;
    }
  };
  return <dialog ref={ref} className="p-dialog p-staff-confirm" role="alertdialog"
    aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <div className="p-dialog-head">
      <div className="p-staff-confirm-heading">
        <span className="p-staff-confirm-icon" aria-hidden="true"><Icon name="trash" size={24} /></span>
        <h2 id="delete-confirmation-title">{ui(title)}</h2>
      </div>
      <button type="button" className="p-icon-button" disabled={busy} aria-label={ui("Close dialog")} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
    <p id="delete-confirmation-description">{ui(message, values)}</p>
    {error && <div className="p-alert error" role="alert">{ui(error)}</div>}
    <footer>
      <button ref={cancelRef} type="button" className="p-button" disabled={busy} onClick={onClose}>{ui("Cancel")}</button>
      <button type="button" className="p-button danger" disabled={busy} onClick={confirm}>
        {ui(busy ? "Deleting…" : confirmLabel)}
      </button>
    </footer>
  </dialog>;
}

function CredentialsDialog({ credentials, onClose }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  const copy = async (key) => {
    setError("");
    try {
      await navigator.clipboard.writeText(key === "all"
        ? `Login ID: ${credentials.loginId}\nPassword: ${credentials.password}`
        : credentials[key]);
      setCopied(key);
    } catch {
      setError("Unable to copy. Select the credentials below and copy them manually.");
    }
  };
  return (
    <dialog ref={ref} className="p-dialog p-credentials-dialog" aria-labelledby="credentials-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="p-dialog-head">
        <div><span className="p-eyebrow">ACCOUNT CREATED</span><h2 id="credentials-title">Login credentials</h2></div>
        <button type="button" className="p-icon-button" aria-label="Close credentials" onClick={onClose}><Icon name="close" /></button>
      </div>
      <p><b>{credentials.name}</b> is ready. Save these credentials now. The password is shown only once.</p>
      {[['loginId', 'Login ID'], ['password', 'Password']].map(([key, label]) => (
        <label className="p-credential-field" key={key}>
          <span>{label}</span>
          <div>
            <input aria-label={label} value={credentials[key]} readOnly autoComplete="off" spellCheck={false}
              onFocus={(event) => event.target.select()} />
            <button type="button" className="p-button small" aria-label={`Copy ${label}`} onClick={() => copy(key)}>
              {copied === key ? "Copied!" : "Copy"}
            </button>
          </div>
        </label>
      ))}
      {error && <div className="p-alert error" role="alert">{error}</div>}
      <footer>
        <button type="button" className="p-button" onClick={onClose}>Done</button>
        <button type="button" className="p-button primary" onClick={() => copy("all")}>{copied === "all" ? "Copied!" : "Copy credentials"}</button>
      </footer>
    </dialog>
  );
}
export function Table({ columns, children, empty }) {
  const ui = useWorkspaceText();
  return (
    <div className="p-table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">{ui(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="p-empty">
                  <Icon name="cards" size={30} />
                  <b>{ui("No records found")}</b>
                  <span>{ui("Create a record or adjust your search.")}</span>
                </div>
              </td>
            </tr>
          ) : (
            React.Children.map(children, (row) => React.isValidElement(row)
              ? React.cloneElement(row, {}, React.Children.toArray(row.props.children).map((cell, index) =>
                  React.isValidElement(cell) ? React.cloneElement(cell, { "data-label": ui(columns[index] || "") }) : cell))
              : row)
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Badge({ status }) {
  const ui = useWorkspaceText();
  return <span className={`p-badge ${status}`}>{ui(status)}</span>;
}

function CardPreviewDialog({ card, ScratchCard, t, onClose }) {
  const ui = useWorkspaceText();
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialogRef.current.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="p-dialog p-card-preview"
      aria-labelledby="card-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="p-dialog-head">
        <div>
          <span className="p-eyebrow">{ui("REWARD PREVIEW")}</span>
          <h2 id="card-preview-title">{ui("Scratch-card preview")}</h2>
        </div>
        <button
          className="p-icon-button"
          onClick={onClose}
          aria-label={ui("Close preview")}
          autoFocus
        >
          <Icon name="close" />
        </button>
      </div>
      <section
        className="p-reward-preview"
        lang={card.language || "en"}
        style={{
          "--page-color": card.pageColor || "#4b0024",
          "--text-color": card.textColor || "#fff8f5",
          "--accent": card.accentColor || "#ff9b72",
        }}
      >
        <div className="p-preview-brand"><CardBrandHeader normalBrand={card.normalBrand} fixedBrand={card.fixedBrand} centerBrand={card.centerBrand} /></div>
        <span>{t("sentToYou")}</span>
        <h2>{card.headline}</h2>
        <ScratchCard card={card} preview t={t} />
      </section>
      <div className="p-preview-caption">
        <Badge status={card.status} />
        <p>
          {ui("Preview only. Viewing this card does not use the coupon or change its status.")}
        </p>
      </div>
      <footer>
        <button className="p-button" onClick={onClose}>
          {ui("Close preview")}
        </button>
      </footer>
    </dialog>
  );
}

export default function Portal({
  session,
  onLogout,
  onSessionChange,
  Creator,
  ScratchCard,
  cardTranslator,
  language: businessLanguage,
  setLanguage,
}) {
  const platformAdmin = session.user.role === "super-admin";
  const branchStaff = session.user.role === "branch-staff";
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("lucky-drop-theme") === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    try { localStorage.setItem("lucky-drop-theme", theme); } catch { /* Theme still works without storage. */ }
  }, [theme]);
  const [workspaceId, setWorkspaceId] = useState(() =>
    platformAdmin
      ? new URLSearchParams(location.search).get("business") || ""
      : session.user.businessId,
  );
  const global = platformAdmin && !workspaceId;
  const language = global ? "en" : businessLanguage;
  const t = cardTranslator(language);
  const localizedDate = (value) => value ? new Date(value).toLocaleString(`${language}-IN`) : "—";
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("tab") || "Overview"),
    [businesses, setBusinesses] = useState([]),
    [cards, setCards] = useState([]),
    [accounts, setAccounts] = useState([]),
    [superAdmins, setSuperAdmins] = useState([]),
    [events, setEvents] = useState([]),
    [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [businessFilter, setBusinessFilter] = useState(""),
    [locationFilter, setLocationFilter] = useState(""),
    [departmentFilter, setDepartmentFilter] = useState(""),
    [expandedLocations, setExpandedLocations] = useState({}),
    [couponFilters, setCouponFilters] = useState(() => ({ ...EMPTY_COUPON_FILTERS })),
    [editor, setEditor] = useState(null),
    [staffToDelete, setStaffToDelete] = useState(null),
    [structureToDelete, setStructureToDelete] = useState(null),
    [couponManagerBusinessId, setCouponManagerBusinessId] = useState(""),
    [departmentEditor, setDepartmentEditor] = useState(false),
    [credentials, setCredentials] = useState(null),
    [temporaryAdminPassword, setTemporaryAdminPassword] = useState(""),
    [visibleAdminPassword, setVisibleAdminPassword] = useState(false),
    [temporaryOwnerPasswords, setTemporaryOwnerPasswords] = useState({}),
    [visibleOwnerPasswords, setVisibleOwnerPasswords] = useState({}),
    [previewCard, setPreviewCard] = useState(null),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false),
    [redemptionCode, setRedemptionCode] = useState(""),
    [redemptionFeedback, setRedemptionFeedback] = useState(null),
    [scannerOpen, setScannerOpen] = useState(false);
  const business = businesses.find((item) => item.businessId === workspaceId);
  const ui = workspaceTranslator(language, workspaceLanguageMode(business));
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia("(max-width: 800px), (max-height: 500px) and (max-width: 1100px)").matches);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px), (max-height: 500px) and (max-width: 1100px)");
    const update = () => {
      setCompactNavigation(query.matches);
      if (!query.matches) setMenu(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!compactNavigation || !menu) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = sidebarRef.current;
    sidebar?.querySelector("nav button.active")?.focus({ preventScroll: true });
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(false);
      } else if (event.key === "Tab") {
        const controls = [...sidebar.querySelectorAll("button:not(:disabled), a[href], [tabindex='0']")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      menuButtonRef.current?.focus({ preventScroll: true });
    };
  }, [compactNavigation, menu]);
  const branchStaffBranch = branchStaff
    ? business?.branches?.find((item) => item.branchId === session.user.branchId)
    : null;
  const branchStaffLocation = business?.departments?.find((item) =>
    item.departmentId === branchStaffBranch?.departmentId);
  const branchStaffLocationName = branchStaffLocation?.name
    || ui(branchStaffBranch?.departmentId ? "Unavailable department" : "Unassigned");
  const staffUnitName = workspaceMode(business) === "brand-only" ? "brand"
    : onlyStructure(business) ? "branch" : "department";
  useEffect(() => {
    try {
      sessionStorage.setItem("scratch-card-dashboard-return", location.href);
    } catch {
      // Navigation still works through browser history when storage is unavailable.
    }
  }, [tab, workspaceId]);
  useEffect(() => {
    setLocationFilter("");
    setDepartmentFilter("");
  }, [businessFilter, tab, workspaceId]);
  const branchCreationDisabled = global
    ? !businesses.some(hasBranchCapacity)
    : !hasBranchCapacity(business);
  const hierarchyCreationDisabled = global
    ? !businesses.some(hasHierarchyCapacity)
    : !hasHierarchyCapacity(business);
  useEffect(() => {
    setCouponFilters({ ...EMPTY_COUPON_FILTERS });
    setBusinessFilter("");
  }, [tab, workspaceId]);
  const admin = ["super-admin", "business", "admin"].includes(
    session.user.role,
  );
  const canManageWorkspace = ["super-admin", "business", "admin"].includes(session.user.role);
  const canRenameWorkspace = ["super-admin", "business"].includes(session.user.role);
  const canCreate = !["viewer", "branch-staff"].includes(session.user.role);
  const nav = global
    ? [
        ["Overview", "overview"],
        ["Businesses", "business"],
        ["Campaigns", "campaign"],
        ["Scratch cards", "cards"],
        ["Branches", "branches"],
        ["Business accounts", "team"],
        ["Branch staff", "team"],
        ["Super admins", "security"],
        ["Analytics", "analytics"],
        ["Security", "security"],
        ["Audit", "audit"],
        ["Platform settings", "settings"],
      ]
    : branchStaff ? [
        ["Overview", "overview"],
        ["Redeem coupon", "check"],
        ["Redemption history", "audit"],
      ] : [
        ["Overview", "overview"],
        ...(canCreate ? [["Create scratch card", "plus"]] : []),
        ["Campaigns", "campaign"],
        ["Coupons", "cards"],
        ["Branches", "branches"],
        ...(admin ? [["Branch staff", "team"]] : []),
        ...(admin ? [["Card image settings", "settings"]] : []),
        ["Business settings", "settings"],
      ];
  useEffect(() => {
    if (!nav.some(([name]) => name === tab)) setTab("Overview");
  }, [global, canCreate, branchStaff, tab]);
  const api = useCallback(
    (url, method = "GET", body) => portalApi(url, session.token, method, body),
    [session.token],
  );
  const scoped = useCallback(
    (url) =>
      `${url}${workspaceId ? `?business=${encodeURIComponent(workspaceId)}` : ""}`,
    [workspaceId],
  );
  const refresh = useCallback(
    async (quiet = false) => {
      if (quiet !== true) setLoading(true);
      setError("");
      try {
        const results = await Promise.all([
          api("/api/portal/businesses"),
          api(scoped("/api/portal/cards")),
          admin
            ? api(scoped("/api/portal/users"))
            : Promise.resolve({ users: [] }),
          global
            ? api(scoped("/api/portal/audit"))
            : Promise.resolve({ events: [] }),
          global
            ? api("/api/portal/settings")
            : api("/api/platform").then((settings) => ({ settings })),
          global ? api("/api/portal/super-admins") : Promise.resolve({ users: [] }),
        ]);
        setBusinesses(results[0].businesses);
        setCards(results[1].cards);
        setAccounts(results[2].users);
        setEvents(results[3].events);
        setConfig(results[4].settings);
        setSuperAdmins(results[5].users);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [api, scoped, global, admin],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!["Overview", "Coupons", "Scratch cards", "Campaigns", "Analytics"].includes(tab)) return;
    let stopped = false, pending = false, pollError = "";
    const updateActivity = async () => {
      if (stopped || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await api(scoped("/api/portal/cards"));
        if (!stopped) {
          setCards(result.cards);
          // A deploy or brief outage clears itself; remove only the banner a
          // failed poll raised, never an error from the user's own action.
          if (pollError) setError((current) => current === pollError ? "" : current);
          pollError = "";
        }
      } catch (err) {
        if (!stopped) {
          pollError = err.message;
          setError(err.message);
        }
      } finally {
        pending = false;
      }
    };
    // The main refresh already loads cards. Poll later instead of issuing an
    // identical second request immediately after every page/navigation load.
    const interval = window.setInterval(updateActivity, 15000);
    window.addEventListener("focus", updateActivity);
    document.addEventListener("visibilitychange", updateActivity);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", updateActivity);
      document.removeEventListener("visibilitychange", updateActivity);
    };
  }, [api, scoped, tab]);
  useEffect(() => {
    const listener = () => {
      const params = new URLSearchParams(location.search);
      const id = params.get("business") || "";
      if (platformAdmin) {
        setWorkspaceId(id);
      }
      setTab(params.get("tab") || "Overview");
      setMenu(false);
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, [platformAdmin]);
  const navigate = (name) => {
    const url = new URL(location.href);
    if (name === "Overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", name);
    history.replaceState({}, "", url);
    setTab(name);
    setSearch("");
    setStatus("all");
    setMenu(false);
    setError("");
    setNotice("");
  };
  const openWorkspace = (id, destination = "Overview") => {
    const url = new URL(location.href);
    url.pathname = "/";
    url.search = "";
    if (id) url.searchParams.set("business", id);
    if (destination !== "Overview") url.searchParams.set("tab", destination);
    history.pushState({}, "", url);
    setWorkspaceId(id);
    setTab(destination);
    setSearch("");
    setStatus("all");
    setBusinessFilter("");
    setMenu(false);
    setError("");
    setNotice("");
  };
  const mutate = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice("Changes saved successfully.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const redeemBranchCouponCode = async (couponCode, redemptionMethod = "manual") => {
    const normalizedCode = String(couponCode || "").trim().toUpperCase();
    if (!normalizedCode) return;
    setBusy(true);
    setError("");
    setNotice("");
    setRedemptionFeedback(null);
    try {
      const result = await api("/api/portal/redeem", "POST", { couponCode: normalizedCode, redemptionMethod });
      setRedemptionFeedback({
        type: "success",
        title: "Coupon redeemed",
        message: "This coupon was verified and redeemed successfully.",
        coupon: result.coupon,
      });
      setRedemptionCode("");
      await refresh(true);
    } catch (err) {
      const title = err.status === 403
        ? "Wrong branch"
        : err.status === 404
          ? "Coupon not found"
          : err.status === 409
            ? "Coupon cannot be redeemed"
            : err.status === 410
              ? "Coupon unavailable"
              : "Redemption failed";
      setRedemptionFeedback({ type: "error", title, message: err.message, details: err.details });
    } finally {
      setBusy(false);
    }
  };
  const redeemBranchCoupon = (event) => {
    event.preventDefault();
    redeemBranchCouponCode(redemptionCode);
  };
  const redeemScannedCoupon = (couponCode) => {
    setScannerOpen(false);
    setRedemptionCode(couponCode);
    redeemBranchCouponCode(couponCode, "qr");
  };
  const saved = async (values) => {
    const savedEditor = editor;
    const result = await savedEditor.save(values);
    setEditor(null);
    if (result?.credentials) setCredentials({ ...result.credentials, name: result.business?.name || result.user?.name });
    setNotice(typeof savedEditor.successMessage === "function" ? savedEditor.successMessage(result)
      : savedEditor.successMessage || "Changes saved successfully.");
    savedEditor.onSaved?.(result);
    if (!savedEditor.skipRefresh) await refresh(savedEditor.quietRefresh === true);
  };
  const match = (value) =>
    `${JSON.stringify(value)} ${ui(value.status || "")} ${value.defaultName || ("campaignName" in value && !value.campaignName) ? ui("General rewards") : ""}`
      .toLowerCase().includes(search.toLowerCase());
  const couponSection = ["Coupons", "Scratch cards"].includes(tab);
  const inSelectedBusiness = (item) => !global || !businessFilter || item.businessId === businessFilter;
  const managedCards = cards.filter(inSelectedBusiness);
  const couponDeletionBusiness = businesses.find(item => item.businessId === (global ? businessFilter : workspaceId));
  const couponDateError = couponDateBounds(couponFilters).error;
  const updateCouponFilter = (key, value) => setCouponFilters((current) => ({ ...current, [key]: value }));
  const clearCouponFilters = () => {
    setCouponFilters({ ...EMPTY_COUPON_FILTERS });
    setSearch("");
    setStatus("all");
  };
  const branches = businesses
    .filter((item) => global || item.businessId === workspaceId)
    .flatMap((item) =>
      (item.branches || []).map((branch) => ({
        ...branch,
        departmentName: item.departments?.find((department) => department.departmentId === branch.departmentId)?.name || "Unassigned",
        businessId: item.businessId,
        businessName: item.name,
      })),
    );
  const departments = businesses
    .filter((item) => global || item.businessId === workspaceId)
    .flatMap((item) => (item.departments || []).map((department) => ({
      ...department,
      businessId: item.businessId,
      businessName: item.name,
    })));
  const locationKey = (unit) => unit?.departmentId
    ? `${unit.businessId}:${unit.departmentId}` : "unassigned";
  const departmentNameKey = (name) => String(name || "").trim().toLowerCase();
  const structureUnits = branches.filter((unit) =>
    (platformAdmin || unit.status !== "deleted") && inSelectedBusiness(unit));
  const locationOptions = departments.filter((location) =>
    (platformAdmin || location.status !== "deleted") && inSelectedBusiness(location))
    .map((location) => ({
      value: `${location.businessId}:${location.departmentId}`,
      label: global ? `${location.businessName} · ${location.name}` : location.name,
    })).sort((a, b) => a.label.localeCompare(b.label));
  const departmentOptions = [...new Map(structureUnits.filter((unit) =>
    (!locationFilter || locationKey(unit) === locationFilter) && departmentNameKey(unit.name))
    .map((unit) => [departmentNameKey(unit.name), { value: departmentNameKey(unit.name), label: unit.name }]))
    .values()].sort((a, b) => a.label.localeCompare(b.label));
  const matchesStructureFilters = (unit) => (!locationFilter || locationKey(unit) === locationFilter)
    && (!departmentFilter || departmentNameKey(unit?.name) === departmentFilter);
  const options = businesses.map((item) => ({
    value: item.businessId,
    label: item.name,
  }));
  const visibleBranches = structureUnits.filter((branch) => matchesStructureFilters(branch) && match(branch));
  const visibleDepartments = departments.filter((department) =>
    (platformAdmin || department.status !== "deleted") && inSelectedBusiness(department)
    && (!locationFilter || locationKey(department) === locationFilter)
    && (!departmentFilter || structureUnits.some((unit) => unit.businessId === department.businessId
      && unit.departmentId === department.departmentId && departmentNameKey(unit.name) === departmentFilter)));
  const couponBranchNames = new Map(branches.filter(inSelectedBusiness)
    .map(branch => [couponBranchKey(branch), branch.name]));
  const couponBranchOptions = new Map();
  const addCouponDepartmentOption = (item, name, businessName) => {
    const label = String(name || item.branchId || "").trim();
    if (!label) return;
    const key = couponDepartmentKey(item, label);
    if (!couponBranchOptions.has(key)) couponBranchOptions.set(key, {
      key, name: global ? `${businessName} · ${label}` : label,
    });
  };
  for (const branch of branches.filter(inSelectedBusiness))
    addCouponDepartmentOption(branch, branch.name, branch.businessName);
  // Retain options for older cards whose assigned branch no longer appears in management.
  for (const card of managedCards) {
    if (!card.branchId || couponBranchNames.has(couponBranchKey(card))) continue;
    const name = card.branchName || card.branchId;
    couponBranchNames.set(couponBranchKey(card), name);
    addCouponDepartmentOption(card, name, card.senderName);
  }
  const visibleCards = filterCouponCards(managedCards.filter(
    (item) => match(item) && (status === "all" || (status === "deleted" ? Boolean(item.deletedAt) : item.status === status)),
  ), couponSection ? couponFilters : EMPTY_COUPON_FILTERS, new Date(), couponBranchNames);
  const couponDeletionRows = couponDeletionBusiness
    ? visibleCards.filter(card => card.businessId === couponDeletionBusiness.businessId) : [];
  const couponDeletionCount = couponDeletionRows.length;
  const couponCampaignOptions = [...new Map(managedCards.map((card) => [couponCampaignKey(card.campaignName), {
    key: couponCampaignKey(card.campaignName), name: card.campaignName || ui("General rewards"),
  }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const couponStaffOptions = new Map();
  for (const card of managedCards) {
    const key = couponStaffKey(card);
    if (!key || couponStaffOptions.has(key)) continue;
    const details = card.redemptionDetails;
    const name = [details?.staffName || card.staffRedeemedByName || ui("Unknown staff member"),
      details?.branchName, details?.departmentName].filter(Boolean).join(" · ");
    couponStaffOptions.set(key, { key, name: global
      ? `${businesses.find(item => item.businessId === card.businessId)?.name || card.senderName} · ${name}` : name });
  }
  const businessSelect = {
    key: "businessId",
    label: "Business",
    type: "select",
    required: true,
    options,
  };
  const accountPasswordFields = [
    {
      key: "password", label: "Password", type: "password", required: true,
      minLength: 1, maxLength: 200,
    },
    {
      key: "confirmPassword", label: "Confirm password", type: "password", required: true,
      minLength: 1, maxLength: 200,
      title: "Enter the same password again.",
    },
  ];
  const manualPasswordPayload = (values) => {
    if (values.password !== values.confirmPassword) throw new Error("Passwords do not match.");
    if (!values.password || values.password.length > 200)
      throw new Error("Enter a password of up to 200 characters.");
    const { confirmPassword, ...payload } = values;
    return payload;
  };
  const createBusiness = () =>
    setEditor({
      title: "Create business workspace",
      wide: true,
      fields: [...businessFields, businessLoginIdField, ...accountPasswordFields, ...businessLimitFields],
      description:
        "Enter a 6–16 character login ID using letters and numbers, or leave it empty to generate one automatically. Enter the owner password manually. The account limit includes the owner login; use 0 for unlimited.",
      values: {
        cardLimit: config?.defaultLimits?.card ?? 100,
        branchLimit: config?.defaultLimits?.branch ?? 2,
        departmentLimit: config?.defaultLimits?.department ?? config?.defaultLimits?.branch ?? 2,
        accountLimit: config?.defaultLimits?.account ?? 1,
        loginId: "",
        structureMode: "branch-department",
      },
      save: (values) => {
        const payload = manualPasswordPayload(values);
        return api("/api/portal/businesses", "POST", { ...businessPayload(payload), password: payload.password, generateCredentials: true });
      },
    });
  const requestDeleteAllCoupons = (item, matchingCards) => {
    const filtered = Array.isArray(matchingCards);
    const targets = (filtered ? matchingCards : cards).filter(card => card.businessId === item.businessId);
    const couponSlugs = targets.map(card => card.slug);
    const couponCount = couponSlugs.length;
    const couponWord = couponCount === 1 ? "coupon" : "coupons";
    setEditor({
      title: `Delete ${filtered ? "matching" : "all"} coupons for ${item.name}`,
      danger: true,
      submitLabel: filtered ? "Delete matching coupons" : "Delete all coupons",
      deletionSummary: { businessName: item.name, count: couponCount },
      successMessage: result => platformAdmin
        ? `${result.deletedCount} ${result.deletedCount === 1 ? "coupon was" : "coupons were"} permanently deleted for ${item.name}. Shared links no longer work.`
        : `${result.deletedCount} ${result.deletedCount === 1 ? "coupon was" : "coupons were"} removed from ${item.name}. A super administrator can restore them.`,
      description: platformAdmin
        ? `Permanently delete ${couponCount} ${couponWord}${filtered ? " matching the current filters" : ", including archived coupons"} belonging to ${item.name}. ${filtered ? "Other coupons will not be changed." : "Table filters do not limit this action."} This cannot be undone. Type the exact business name to confirm.`
        : `Remove ${couponCount} ${couponWord}${filtered ? " matching the current filters" : ""} belonging to ${item.name} from your workspace and deactivate their shared links. ${filtered ? "Other coupons will not be changed." : "Table filters do not limit this action."} A super administrator can restore them or delete them permanently. Type the exact business name to confirm.`,
      fields: [{ key: "confirmName", label: `Type ${item.name} to confirm`, required: true }],
      save: (values) => api(`/api/portal/businesses/${item.businessId}/cards`, "DELETE", {
        ...values, couponSlugs, confirmCount: couponCount,
        selectionMode: filtered ? "filtered" : "all",
        ...(filtered ? { couponStates: targets.map(card => ({ slug: card.slug, status: card.status })) } : {}),
      }),
    });
  };
  const requestDeleteCoupon = (item, card) => setEditor({
    title: `Delete coupon ${card.couponCode}`,
    danger: true,
    deletionSummary: { businessName: item.name, count: 1 },
    submitLabel: platformAdmin ? "Delete coupon permanently" : "Delete coupon",
    successMessage: platformAdmin
      ? `${card.couponCode} was permanently deleted. Its shared link no longer works.`
      : `${card.couponCode} was removed from your workspace. A super administrator can restore it.`,
    description: platformAdmin
      ? `Permanently delete this coupon from ${item.name}. This cannot be undone. Type the exact coupon code to confirm.`
      : `Remove this coupon from ${item.name} and deactivate its shared link. A super administrator can restore it or delete it permanently. Type the exact coupon code to confirm.`,
    fields: [{ key: "confirmCode", label: `Type ${card.couponCode} to confirm`, required: true }],
    save: (values) => api(`/api/portal/businesses/${item.businessId}/cards/${card.slug}`, "DELETE", values),
  });
  const requestRestoreCoupon = (item, card) => setEditor({
    title: `Restore coupon ${card.couponCode}`,
    submitLabel: "Restore coupon",
    successMessage: `${card.couponCode} was restored to ${item.name}. Its original expiry and redemption state are unchanged.`,
    description: "Restore this coupon to the business workspace. Redeemed coupons stay redeemed and expired coupons stay expired. Type the exact coupon code to confirm.",
    fields: [{ key: "confirmCode", label: `Type ${card.couponCode} to confirm`, required: true }],
    save: values => api(`/api/portal/businesses/${item.businessId}/cards/${card.slug}/restore`, "POST", values),
  });
  const deleteAllBusinesses = () => setEditor({
    title: "Delete all businesses",
    danger: true,
    submitLabel: "Delete all businesses",
    successMessage: "All businesses deleted. Their accounts and shared card links are disabled.",
    description: `Remove all ${businesses.length} business workspaces, including ${cards.length} scratch cards, from the platform. Accounts and card links will be disabled. Records are archived for recovery. Type DELETE ALL BUSINESSES to confirm.`,
    fields: [{ key: "confirmText", label: "Type DELETE ALL BUSINESSES to confirm", required: true }],
    save: (values) => api("/api/portal/businesses", "DELETE", {
      ...values, businessIds: businesses.map((business) => business.businessId),
    }),
  });
  const editBusiness = (item) =>
    setEditor({
      title: `Manage ${item.name}`,
      wide: true,
      description:
        "Enter a custom owner login ID, click Generate new to preview one, or leave it empty to generate one automatically when you save. Limits apply to this business only; use 0 for unlimited.",
      fields: [
        businessFields[0],
        businessFields[1],
        { ...businessLoginIdField,
          label: item.loginId ? "Owner login ID" : "New owner login ID (optional)",
          required: false,
          actionLabel: "Generate new",
          generateValue: randomLoginId },
        ...businessLimitFields,
        {
          key: "status",
          label: "Workspace access",
          type: "select",
          options: ["active", "paused"].map((value) => ({
            value,
            label: value,
          })),
        },
      ],
      values: {
        ...item,
        loginId: item.loginId || "",
        cardLimit: item.limits.card,
        branchLimit: item.limits.branch,
        departmentLimit: item.limits.department,
        accountLimit: item.limits.account,
        structureMode: workspaceMode(item),
      },
      save: (values) => {
        const payload = businessPayload(values);
        return api(`/api/portal/businesses/${item.businessId}`, "PATCH", payload);
      },
    });
  const createBranch = () =>
    setEditor({
      title: "Add branch",
      fields: [...(global ? [{ ...businessSelect, options: options.filter((option) =>
        hasBranchCapacity(businesses.find((item) => item.businessId === option.value)))}] : []), ...branchFields,
        ...(!global && business?.departments?.some((item) => (item.status || "active") === "active")
          ? [{ key: "departmentId", label: "Department", type: "select",
            options: [{ value: "", label: "Unassigned" }, ...business.departments
              .filter((item) => (item.status || "active") === "active")
              .map((item) => ({ value: item.departmentId, label: item.name }))] }] : [])],
      values: { businessId: workspaceId },
      save: (values) => api(
          `/api/portal/businesses/${values.businessId}/branches`,
          "POST",
          values,
        ),
    });
  const createDepartmentHierarchy = () => setDepartmentEditor(true);
  const saveDepartmentHierarchy = async ({ businessId, departments, mode, name }) => {
    if (mode === "branch-only") {
      await api(`/api/portal/businesses/${businessId}/branches`, "POST", { name });
      setDepartmentEditor(false); setNotice(`${name} branch created successfully.`); await refresh(); return;
    }
    if (mode === "brand-only") {
      await api(`/api/portal/businesses/${businessId}/departments/branches`, "POST", {
        departments: [{ name, branches: [{ name }] }],
      });
      setDepartmentEditor(false); setNotice(`${name} brand created successfully.`); await refresh(); return;
    }
    const result = await api(`/api/portal/businesses/${businessId}/departments/branches`, "POST", { departments });
    setDepartmentEditor(false);
    const branchLabel = result.departments.length === 1 ? "branch" : "branches";
    const departmentLabel = result.branches.length === 1 ? "department" : "departments";
    setNotice(`${result.departments.length} ${branchLabel} and ${result.branches.length} ${departmentLabel} created successfully.`);
    await refresh();
  };
  const createAccount = () =>
    setEditor({
      title: "Add business account",
      fields: [
        ...(global ? [businessSelect] : []),
        { key: "name", label: "Full name", required: true },
        {
          key: "role",
          label: "Permissions",
          type: "select",
          required: true,
          options: [
            { value: "admin", label: "Admin — manage branches and accounts" },
            {
              value: "editor",
              label: "Editor — create and manage scratch cards",
            },
            { value: "viewer", label: "Viewer — read and export only" },
          ],
        },
        ...accountPasswordFields,
      ],
      values: { businessId: workspaceId, role: "editor" },
      description: "Enter any password manually. A unique 12-character login ID containing letters and numbers will be created automatically.",
      save: (values) => api("/api/portal/users", "POST", { ...manualPasswordPayload(values), generateCredentials: true }),
    });
  const createBranchStaff = () => {
    const availableBranches = branches.filter((item) => item.status === "active");
    setEditor({
      title: "Create branch staff login",
      fields: [
        { key: "name", label: "Staff name", required: true },
        {
          ...businessLoginIdField,
          label: "Login ID",
          required: true,
          title: "Use 6–16 letters and numbers, including at least one of each.",
        },
        {
          key: "branchId",
          label: global ? "Business and workspace unit" : onlyStructure(business) ? brandStructure(business) ? "Brand" : "Branch" : "Department and branch",
          type: "select",
          required: true,
          options: availableBranches.map((item) => ({
            value: item.branchId,
            label: [global && item.businessName,
              onlyStructure(businesses.find(value => value.businessId === item.businessId)) ? null : item.departmentName,
              item.name].filter(Boolean).join(" · "),
          })),
        },
        ...accountPasswordFields,
      ],
      values: { loginId: "", branchId: "" },
      description: "Enter a unique Login ID using 6–16 letters and numbers, including at least one of each. Choose one branch for this login; the staff member will see only that branch's dashboard, coupons, and redemption activity.",
      save: (values) => {
        const branch = availableBranches.find((item) => item.branchId === values.branchId);
        if (!branch) throw new Error("Choose an active business branch.");
        return api("/api/portal/users", "POST", {
          ...manualPasswordPayload(values),
          businessId: branch.businessId,
          branchId: branch.branchId,
          role: "branch-staff",
          loginId: String(values.loginId || "").trim(),
          generateCredentials: true,
        });
      },
    });
  };
  const createSuperAdmin = () => setEditor({
    title: "Create super-admin account",
    fields: [{ key: "name", label: "Full name", required: true }, ...accountPasswordFields],
    description: "This account will have full platform access. Enter any password manually; a unique 12-character login ID containing letters and numbers is created automatically.",
    save: (values) => api("/api/portal/super-admins", "POST", manualPasswordPayload(values)),
  });
  const editAccount = (item) =>
    setEditor({
      title: `Manage ${item.name}`,
      fields: [
        {
          key: "role",
          label: "Role",
          type: "select",
          options: ["admin", "editor", "viewer"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: "status",
          label: "Account access",
          type: "select",
          options: ["active", "paused"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: "password",
          label: "Reset password (leave empty to keep)",
          type: "password",
        },
      ],
      values: { ...item, password: "" },
      save: (values) =>
        api(scoped(`/api/portal/users/${item.id}`), "PATCH", values),
    });
  const editBranchStaff = (item) => {
    const businessBranches = branches.filter((branch) =>
      branch.businessId === item.businessId && branch.status === "active");
    setEditor({
      title: `Manage ${item.name}`,
      fields: [
        {
          key: "branchId",
          label: onlyStructure(businesses.find(value => value.businessId === item.businessId))
            ? brandStructure(businesses.find(value => value.businessId === item.businessId)) ? "Assigned brand" : "Assigned branch"
            : "Assigned department and branch",
          type: "select",
          required: true,
          options: businessBranches.map((branch) => ({
            value: branch.branchId,
            // This dialog only permits assignments inside the staff member's
            // existing business, even when opened by a super administrator.
            label: onlyStructure(businesses.find(value => value.businessId === item.businessId))
              ? branch.name : `${branch.departmentName} · ${branch.name}`,
          })),
        },
        {
          key: "status",
          label: "Account access",
          type: "select",
          options: ["active", "paused"].map((value) => ({ value, label: value })),
        },
        { key: "password", label: "Reset password (leave empty to keep)", type: "password" },
      ],
      values: { branchId: item.branchId, status: item.status, password: "" },
      description: "Change this staff member's branch, pause access, or assign a new password. Saving changes revokes existing sessions.",
      save: (values) => api(`/api/portal/users/${item.id}`, "PATCH", values),
    });
  };
  const couponDepartmentName = (card) => branches.find((unit) =>
    unit.businessId === card.businessId && unit.branchId === card.branchId)?.name
      || card.branchName || ui("All branches");
  const couponLocationName = (card) => {
    if (!card.branchId) return ui("All departments");
    const assignedBusiness = businesses.find((item) => item.businessId === card.businessId);
    const unit = assignedBusiness?.branches?.find((item) => item.branchId === card.branchId);
    if (unit && !unit.departmentId) return ui("Unassigned");
    return assignedBusiness?.departments?.find((item) => item.departmentId === unit?.departmentId)?.name
      || ui("Unavailable department");
  };
  const exportBusinessAccounts = async (business) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/portal/businesses/${encodeURIComponent(business.businessId)}/accounts-export`);
      const { default: write } = await import("write-excel-file/universal");
      const labels = ["Business", "Account name", "Role", "Brand", "Department", "Login ID", "Password", "Access"];
      const rows = result.accounts.map(account => [result.business.name, account.name, account.role,
        account.branch, account.department, account.loginId, account.password, account.status]
        .map(value => ({ value: String(value ?? ""), type: String, wrap: true })));
      const blob = await write([
        labels.map(value => ({ value, fontWeight: "bold", backgroundColor: "#002B5C", textColor: "#FFFFFF" })),
        ...rows,
      ], {
        sheet: "Business accounts",
        columns: [30, 28, 24, 24, 24, 28, 24, 16].map(width => ({ width })),
        stickyRowsCount: 1,
      }).toBlob();
      const filename = result.business.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "business";
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = `${filename}-accounts-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Account list downloaded. Existing passwords cannot be retrieved; no passwords were changed.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const exportCards = async () => {
    setBusy(true);
    setError("");
    try {
      const { default: write } = await import("write-excel-file/universal");
      const labels = [...t("excelHeaders"), ui("Expiry date"), ui("WhatsApp number"), ui("Department"), ui("Branch")],
        rows = visibleCards.map((item) =>
          [
            item.couponCode,
            item.offerTitle,
            item.senderName,
            item.status === "available"
                ? t("waiting")
                : ui(item.status) || {
                    hi: { expired: "समाप्त", disabled: "निष्क्रिय" },
                    te: {
                      expired: "గడువు ముగిసింది",
                      disabled: "నిలిపివేయబడింది",
                    },
                  }[language]?.[item.status] || item.status,
            item.createdAt
              ? new Date(item.createdAt).toLocaleString(`${language}-IN`)
              : "—",
            item.staffRedeemedAt
              ? new Date(item.staffRedeemedAt).toLocaleString(`${language}-IN`)
              : "—",
            scratchCardUrl(item.slug),
            item.expiresAt ? localizedDate(item.expiresAt) : ui("No expiry"),
            item.customerPhone || "—",
            couponLocationName(item),
            couponDepartmentName(item),
          ].map((value) => ({ value: String(value ?? "") })),
        );
      const blob = await write(
        [
          labels.map((value) => ({
            value,
            fontWeight: "bold",
            backgroundColor: "#17142D",
            textColor: "#FFFFFF",
          })),
          ...rows,
        ],
        {
          sheet: t("excelSheet"),
          columns: labels.map((_, index) => ({ width: index === 6 ? 50 : 25 })),
          stickyRowsCount: 1,
        },
      ).toBlob();
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `coupons-${language}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Excel download started.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const completedHere = cards.filter((item) => item.staffRedeemedAt
    && item.staffRedeemedBranchId === session.user.branchId);
  const couponCounts = summarizeCouponStatuses(cards);
  const used = couponCounts.redeemed,
    available = couponCounts.available,
    staffRedeemed = completedHere.length,
    redeemedToday = completedHere.filter((item) => item.staffRedeemedAt
      && new Date(item.staffRedeemedAt).toDateString() === new Date().toDateString()).length;
  const campaigns = summarizeCampaigns(managedCards, businesses);
  const campaignRows = campaigns.flatMap((campaign) => campaign.branches.map((branch) => ({
    ...campaign,
    ...branch,
    branches: undefined,
  }))).filter(match);
  const branchActivity = (branch) => {
    const branchCards = cards.filter((card) =>
      card.businessId === branch.businessId && card.branchId === branch.branchId);
    return {
      total: branchCards.length,
      redeemed: branchCards.filter((card) => card.used).length,
    };
  };
  const exportCampaigns = async () => {
    setBusy(true);
    setError("");
    try {
      const { default: write } = await import("write-excel-file/universal");
      const labels = ["Campaign", ...(global ? ["Business"] : []), "Branch", "Scratch cards", "Redeemed", "Conversion"].map((label) => ui(label));
      const rows = campaignRows.map((item) => [
        { value: item.defaultName ? ui("General rewards") : item.name },
        ...(global ? [{ value: item.businessName || "—" }] : []),
        { value: item.branchId ? item.branchName : ui("All branches") },
        { value: item.total, type: Number },
        { value: item.used, type: Number },
        { value: item.used / item.total, type: Number, format: "0%" },
      ]);
      const blob = await write([
        labels.map((value) => ({ value, fontWeight: "bold", backgroundColor: "#17142D", textColor: "#FFFFFF" })),
        ...rows,
      ], {
        sheet: ui("Campaigns"),
        columns: labels.map((_, index) => ({ width: index < 3 ? 30 : 18 })),
        stickyRowsCount: 1,
      }).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `campaigns-${language}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Excel download started.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const exportBranches = async () => {
    setBusy(true);
    setError("");
    try {
      const { default: write } = await import("write-excel-file/universal");
      const labels = ["Department", "Branch", ...(global ? ["Business"] : []), "Scratch cards", "Redeemed", "Conversion", "Address", "Access"].map((label) => ui(label));
      const rows = visibleBranches.map((branch) => {
        const activity = branchActivity(branch);
        return [
          { value: branch.departmentName || "Unassigned" },
          { value: branch.name },
          ...(global ? [{ value: branch.businessName }] : []),
          { value: activity.total, type: Number },
          { value: activity.redeemed, type: Number },
          { value: activity.total ? activity.redeemed / activity.total : 0, type: Number, format: "0%" },
          { value: branch.address || "—" },
          { value: ui(branch.status || "active") },
        ];
      });
      const blob = await write([
        labels.map((value) => ({ value, fontWeight: "bold", backgroundColor: "#17142D", textColor: "#FFFFFF" })),
        ...rows,
      ], {
        sheet: ui("Branches"),
        columns: labels.map((_, index) => ({ width: index < (global ? 2 : 1) ? 30 : 20 })),
        stickyRowsCount: 1,
      }).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `departments-${language}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Excel download started.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const stats = [
    {
      title: global ? "Businesses" : "Scratch cards",
      value: global ? businesses.length : cards.length,
      caption: global
        ? `${businesses.filter((item) => item.status === "active").length} active workspaces`
        : ui("{count} reward campaigns", { count: campaigns.length }),
      icon: "business",
    },
    ...(global ? [{
      title: "Total scratch cards",
      value: cards.length,
      caption: "Across all businesses",
      icon: "cards",
    }] : []),
    {
      title: "Available rewards",
      value: available,
      caption: "Not opened or scratched",
      icon: "cards",
    },
    {
      title: "Redeemed coupons",
      value: used,
      caption: "Claimed by staff",
      icon: "security",
    },
    {
      title: "Redemption rate",
      value: `${cards.length ? Math.round((used / cards.length) * 100) : 0}%`,
      caption: ui("{used} of {total} scratch cards", { used, total: cards.length }),
      icon: "analytics",
    },
  ];
  const analyticsStats = [
    ...(global ? [{
      title: "Businesses",
      value: businesses.length,
      caption: ui("{active} active · {paused} paused", {
        active: businesses.filter((item) => item.status === "active").length,
        paused: businesses.filter((item) => item.status === "paused").length,
      }),
    }] : []),
    { title: "Total scratch cards", value: couponCounts.total, caption: global ? "Across all businesses" : "All coupons in this workspace" },
    { title: "Redemption rate", value: `${couponCounts.redemptionRate}%`,
      caption: ui("{used} of {total} scratch cards", { used: couponCounts.redeemed, total: couponCounts.total }) },
    ...[
      ["available", "Available rewards", "Not opened or scratched"],
      ["opened", "Opened coupons", "Opened, not scratched"],
      ["scratched", "Scratched coupons", "Scratched, not redeemed"],
      ["redeemed", "Redeemed coupons", "Claimed by staff"],
      ["expired", "Expired coupons", "Expired before redemption"],
      ["disabled", "Disabled coupons", "Disabled by an administrator"],
      ...(platformAdmin ? [["deleted", "Deleted coupons", "Retained for super-admin recovery"]] : []),
    ].map(([status, title, caption]) => ({ status, title, value: couponCounts[status], caption })),
  ];
  const redemptionMethodLabel = (item) => ui(item.staffRedemptionMethod === "qr" ? "QR scanner"
    : item.staffRedemptionMethod === "manual" ? "Manual code" : "Not recorded");
  const cardsTable = (rows, showPhone = false) => (
    <Table
      columns={[
        "Reward & coupon",
        ...(showPhone ? ["WhatsApp number"] : []),
        ...(global ? ["Business"] : []),
        ...(!global && onlyStructure(business) ? [] : ["Department"]),
        "Branch",
        "Campaign",
        "Status",
        "Created",
        ...(showPhone ? ["Expiry date"] : []),
        ...(showPhone ? ["Redeemed by", ...(!global && onlyStructure(business) ? [] : ["Redeemed department"]), "Redeemed branch", "Redeemed date & time", "Redemption method"] : []),
        "Actions",
      ]}
      empty={!rows.length}
    >
      {rows.map((item) => (
        <tr key={item.slug}>
          <td>
            <b>{item.offerTitle}</b>
            <small className="p-code">{item.couponCode}</small>
          </td>
          {showPhone && <td>{item.customerPhone || "—"}</td>}
          {global && <td>{businesses.find((value) => value.businessId === item.businessId)?.name || item.senderName}</td>}
          {(global || !onlyStructure(business)) && <td>{couponLocationName(item)}</td>}
          <td>{couponDepartmentName(item)}</td>
          <td>{item.campaignName || ui("General rewards")}</td>
          <td>
            <Badge status={item.status} />
          </td>
          <td>{localizedDate(item.createdAt)}</td>
          {showPhone && <td>{item.expiresAt ? localizedDate(item.expiresAt) : ui("No expiry")}</td>}
          {showPhone && <>
            <td>{item.staffRedeemedAt ? item.redemptionDetails?.staffName || "—" : "—"}</td>
            {(global || !onlyStructure(business)) && <td>{item.staffRedeemedAt ? item.redemptionDetails?.branchName || "—" : "—"}</td>}
            <td>{item.staffRedeemedAt ? item.redemptionDetails?.departmentName || "—" : "—"}</td>
            <td>{item.staffRedeemedAt ? localizedDate(item.redemptionDetails?.redeemedAt || item.staffRedeemedAt) : "—"}</td>
            <td>{item.staffRedeemedAt ? redemptionMethodLabel(item) : "—"}</td>
          </>}
          <td>
            <div className="p-row-actions">
              <button onClick={() => setPreviewCard(item)}>{ui("Preview")}</button>
              <button
                disabled={busy}
                onClick={() =>
                  navigator.clipboard
                    .writeText(scratchCardUrl(item.slug))
                    .then(() => setNotice("Share link copied."))
                    .catch(() =>
                      setError(
                        "Unable to copy. Open the card to copy its URL.",
                      ),
                    )
                }
              >
                {ui("Copy link")}
              </button>
              {canCreate && !item.revealed && !item.deletedAt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate(() =>
                      api(scoped(`/api/portal/cards/${item.slug}`), "PATCH", {
                        disabled: !item.disabled,
                      }),
                    )
                  }
                >
                  {ui(item.disabled ? "Enable" : "Disable")}
                </button>
              )}
              {showPhone && admin && (
                <button type="button" className="danger" disabled={busy}
                  onClick={() => requestDeleteCoupon(businesses.find(value => value.businessId === item.businessId)
                    || { businessId: item.businessId, name: item.senderName }, item)}>
                  {ui(platformAdmin && item.deletedAt ? "Delete permanently ({count})" : "Delete coupon ({count})", { count: 1 })}
                </button>
              )}
              {showPhone && platformAdmin && item.deletedAt && (
                <button type="button" disabled={busy}
                  onClick={() => requestRestoreCoupon(businesses.find(value => value.businessId === item.businessId)
                    || { businessId: item.businessId, name: item.senderName }, item)}>
                  {ui("Restore coupon")}
                </button>
              )}
              {global && (
                <button onClick={() => openWorkspace(item.businessId, "Coupons")}>
                  Manage business
                </button>
              )}
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
  const branchRedemptionDesk = () => (
    <div className="p-staff-redemption-grid">
      <article className="p-card p-redeem-desk">
        <span className="p-eyebrow">COUPON VERIFICATION</span>
        <h2>Redeem a scratched coupon</h2>
        <p>Enter a scratched coupon assigned to {branchStaffBranch?.name || `your ${staffUnitName}`}.</p>
        <form onSubmit={redeemBranchCoupon}>
          <label htmlFor="branch-redemption-code">Coupon code</label>
          <div>
            <input id="branch-redemption-code" name="couponCode" required maxLength="24"
              autoComplete="off" autoCapitalize="characters" spellCheck="false"
              placeholder="Example: LUCKY-71F37C66" value={redemptionCode}
              onChange={(event) => setRedemptionCode(event.target.value.toUpperCase())} />
            <button className="p-button primary" type="submit" disabled={busy || !redemptionCode.trim()}>
              <Icon name="check" />{busy ? "Checking…" : "Redeem coupon"}
            </button>
            <button className="p-button p-scan-button" type="button" disabled={busy}
              onClick={() => setScannerOpen(true)}>
              <span className="p-scan-icon" aria-hidden="true" />Scan QR code
            </button>
          </div>
        </form>
      </article>
      <article className="p-card p-redemption-guide">
        <span className="p-eyebrow">SAFE REDEMPTION</span>
        <h2>Before you redeem</h2>
        <ol>
          <li><b>Customer scratches the card</b><span>The reward and coupon code become visible.</span></li>
          <li><b>Check the assigned {staffUnitName}</b><span>Coupons for {branchStaffBranch?.name || `this ${staffUnitName}`} can be redeemed here. Other {staffUnitName}s cannot redeem them.</span></li>
          <li><b>Confirm once</b><span>A redeemed code is locked permanently and cannot be used again.</span></li>
        </ol>
      </article>
    </div>
  );
  const branchRedemptionHistory = (limit) => {
    const rows = completedHere.filter(match);
    const displayed = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
    return <article className="p-card">
      <div className="p-card-title"><div><h2>{limit ? "Recent redemptions" : "Redemption history"}</h2>
        <p>Coupons completed by staff at {branchStaffBranch?.name || `this ${staffUnitName}`}.</p></div></div>
      <Table columns={["Coupon code", "Reward", "Campaign", "Redemption method", "Redeemed at", "Status"]}
        empty={!displayed.length}>
        {displayed.map((item) => <tr key={item.slug}>
          <td className="p-code">{item.couponCode}</td>
          <td>{item.offerTitle}</td>
          <td>{item.campaignName || ui("General rewards")}</td>
          <td>{redemptionMethodLabel(item)}</td>
          <td>{localizedDate(item.staffRedeemedAt)}</td>
          <td><Badge status="redeemed" /></td>
        </tr>)}
      </Table>
    </article>;
  };
  const branchStaffOverview = (
    <>
      <div className="p-welcome-row p-staff-welcome">
        <div>
          <span className="p-eyebrow">{staffUnitName.toUpperCase()} REDEMPTION DESK</span>
          <h1>{branchStaffBranch?.name || `Assigned ${staffUnitName}`}</h1>
          {!onlyStructure(business) && <p className="p-staff-location"><Icon name="business" size={16} />
            <span>{ui("Department")}: <strong>{branchStaffLocationName}</strong></span>
          </p>}
          <p>Verify a customer's scratched coupon code and redeem it securely for {business?.name || "this business"}.</p>
        </div>
        <Badge status="active" />
      </div>
      <div className="p-metrics p-staff-metrics">
        <article><div><span>Redeemed today</span><Icon name="check" /></div>
          <strong>{redeemedToday}</strong><small>Completed at this {staffUnitName} today</small></article>
        <article><div><span>Total redeemed</span><Icon name="analytics" /></div>
          <strong>{staffRedeemed}</strong><small>All completed {staffUnitName} redemptions</small></article>
      </div>
      <div className="p-staff-redemption-grid">
        <article className="p-card p-redeem-desk">
          <span className="p-eyebrow">COUPON VERIFICATION</span>
          <h2>Redeem a scratched coupon</h2>
          <p>Ask the customer for the coupon code shown after scratching their card.</p>
          <form onSubmit={redeemBranchCoupon}>
            <label htmlFor="branch-redemption-code">Coupon code</label>
            <div>
              <input id="branch-redemption-code" name="couponCode" required maxLength="24"
                autoComplete="off" autoCapitalize="characters" spellCheck="false"
                placeholder="Example: LUCKY-71F37C66" value={redemptionCode}
                onChange={(event) => setRedemptionCode(event.target.value.toUpperCase())} />
              <button className="p-button primary" type="submit" disabled={busy || !redemptionCode.trim()}>
                <Icon name="check" />{busy ? "Checking…" : "Redeem coupon"}
              </button>
              <button className="p-button p-scan-button" type="button" disabled={busy}
                onClick={() => setScannerOpen(true)}>
                <span className="p-scan-icon" aria-hidden="true" />Scan QR code
              </button>
            </div>
          </form>
        </article>
        <article className="p-card p-redemption-guide">
          <span className="p-eyebrow">SAFE REDEMPTION</span>
          <h2>Before you redeem</h2>
          <ol>
            <li><b>Customer scratches the card</b><span>The reward and coupon code become visible.</span></li>
            <li><b>Check the assigned {staffUnitName}</b><span>Accept coupons for {branchStaffBranch?.name || `this ${staffUnitName}`}. Other {staffUnitName}s cannot redeem them.</span></li>
            <li><b>Confirm once</b><span>A redeemed code is locked permanently and cannot be used again.</span></li>
          </ol>
        </article>
      </div>
      <article className="p-card">
        <div className="p-card-title"><div><h2>Recent redemptions</h2>
          <p>Latest coupons completed at {branchStaffBranch?.name || "this department"}.</p></div></div>
        <Table columns={["Coupon code", "Reward", "Redeemed at", "Status"]}
          empty={!completedHere.length}>
          {completedHere.slice(0, 8).map((item) => <tr key={item.slug}>
            <td className="p-code">{item.couponCode}</td>
            <td>{item.offerTitle}</td>
            <td>{localizedDate(item.staffRedeemedAt)}</td>
            <td><Badge status="redeemed" /></td>
          </tr>)}
        </Table>
      </article>
    </>
  );
  const overview = (
    <>
      <div className="p-welcome-row">
        <div>
          <span className="p-eyebrow">
            {ui(global ? "PLATFORM OVERVIEW" : branchStaff ? "BRANCH DASHBOARD" : "BUSINESS OVERVIEW")}
          </span>
          <h1>
            {global
              ? "Your rewards platform, at a glance."
              : branchStaff
                ? `${branchStaffBranch?.name || `Assigned ${staffUnitName}`} dashboard`
              : ui("{name} workspace", { name: business?.name || session.user.name })}
          </h1>
          <p>{branchStaff
            ? `Monitor coupons and redemption activity for ${business?.name || "your business"}.`
            : ui("Manage rewards, monitor activity, and keep your team in sync.")}</p>
        </div>
        {!branchStaff && <button
          className="p-button primary"
          onClick={
            global ? createBusiness : () => navigate("Create scratch card")
          }
          disabled={!global && !canCreate}
        >
          <Icon name="plus" />
          {ui(global ? "New business" : "Create scratch card")}
        </button>}
      </div>
      <div className={`p-metrics${global ? " p-metrics-platform" : ""}`}>
        {stats.map((item) => (
          <article key={item.title}>
            <div>
              <span>{ui(item.title)}</span>
              <Icon name={item.icon} />
            </div>
            <strong>{item.value}</strong>
            <small>{ui(item.caption)}</small>
          </article>
        ))}
      </div>
      <div className="p-overview-grid">
        <article className="p-card">
          <div className="p-card-title">
            <h2>{ui("Redemption activity")}</h2>
            <span>{ui("Last 7 days")}</span>
          </div>
          <div className="p-bars">
            {Array.from({ length: 7 }, (_, index) => {
              const day = new Date();
              day.setDate(day.getDate() - 6 + index);
              const count = cards.filter(
                (item) =>
                  item.staffRedeemedAt &&
                  new Date(item.staffRedeemedAt).toDateString() ===
                    day.toDateString(),
              ).length;
              const max = Math.max(1, used);
              return (
                <div key={index} title={ui("{count} redemptions", { count })}>
                  <b>{count}</b>
                  <span
                    style={{ height: `${Math.max(3, (count / max) * 100)}%` }}
                  />
                  <small>
                    {day.toLocaleDateString(`${language}-IN`, { weekday: "short" })}
                  </small>
                </div>
              );
            })}
          </div>
        </article>
        <article className="p-card p-quick">
          <span className="p-eyebrow">{ui("WORKSPACE HEALTH")}</span>
          <h2>{ui("Keep your rewards running.")}</h2>
          <div>
            <Icon name="branches" />
            <span>
              <b>{ui("{count} branches", { count: branches.length })}</b>
              <small>{ui("Manage your business locations")}</small>
            </span>
            {!branchStaff && <button onClick={() => navigate("Branches")}>{ui("View")}</button>}
          </div>
          {global && (
            <div>
              <Icon name="team" />
              <span>
                <b>{accounts.length} additional business accounts</b>
                <small>Permissions across your workspace</small>
              </span>
              <button onClick={() => navigate("Business accounts")}>
                View
              </button>
            </div>
          )}
          <div>
            <Icon name="cards" />
            <span>
              <b>{ui("{count} campaigns", { count: campaigns.length })}</b>
              <small>{ui("Grouped scratch-card rewards")}</small>
            </span>
            {!branchStaff && <button onClick={() => navigate("Campaigns")}>{ui("View")}</button>}
          </div>
        </article>
      </div>
      <article className="p-card">
        <div className="p-card-title">
          <div>
            <h2>{ui("Recent scratch cards")}</h2>
            <p>{ui("Your latest offers and reward activity.")}</p>
          </div>
          <button
            className="p-button"
            onClick={() => navigate(global ? "Scratch cards" : "Coupons")}
          >
            {ui("View all")}
          </button>
        </div>
        {cardsTable(cards.slice(0, 5))}
      </article>
    </>
  );
  const render = () => {
    if (tab === "Overview") return branchStaff ? branchStaffOverview : overview;
    if (branchStaff && tab === "Redeem coupon") return branchRedemptionDesk();
    if (branchStaff && tab === "Redemption history") return branchRedemptionHistory();
    // The creator needs the loaded workspace. When loading failed, offer Retry
    // instead of rendering a form without a business (a blank-page crash).
    if (tab === "Create scratch card" && !business)
      return (
        <article className="p-card">
          <div className="p-info">{ui("This workspace could not be loaded. Retry to continue creating scratch cards.")}</div>
          <button type="button" className="p-button" onClick={() => refresh()}>{ui("Retry")}</button>
        </article>
      );
    if (tab === "Create scratch card")
      return (
        <div className="p-builder">
          <Creator
            key={workspaceId}
            language={language}
            setLanguage={setLanguage}
            t={t}
            ui={ui}
            token={session.token}
            user={{
              ...session.user,
              businessId: workspaceId,
              name: business?.name || session.user.name,
            }}
            business={business}
            onCreated={() => refresh(true)}
            onManageBranches={() => navigate("Branches")}
          />
        </div>
      );
    if (tab === "Businesses") {
      const rows = businesses.filter(match);
      return (
        <article className="p-card">
          <div className="p-info">
            Every owner login ID is listed below. Passwords are protected with one-way hashing and cannot be viewed by anyone, including super admins. Use Reset password to assign a new password and revoke the owner's existing sessions.
            {" "}Download accounts (Excel) includes the selected business's owner and staff login IDs, assigned locations and departments, and access status. Passwords are marked Not retrievable.
          </div>
          <Table
            columns={[
              "Business",
              "Owner login ID",
              "Business limits",
              "Structure units",
              "Access",
              "Actions",
            ]}
            empty={!rows.length}
          >
            {rows.map((item) => (
              <tr key={item.businessId}>
                <td>
                  <div className="p-business-name">
                    <span>{item.name.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <b>{item.name}</b>
                      <small>{item.website || "No website added"}</small>
                    </div>
                  </div>
                </td>
                <td className="p-code">{item.loginId || item.loginEmail}</td>
                <td>
                  <small>{item.limits.card || "Unlimited"} scratch cards</small>
                  {workspaceMode(item) !== "brand-only" && <small>{item.limits.branch || "Unlimited"} {onlyStructure(item) ? "branches" : "departments"}</small>}
                  {workspaceMode(item) !== "branch-only" && <small>{item.limits.department || "Unlimited"} {brandStructure(item) ? "brands" : "branches"}</small>}
                  <small>
                    {item.limits.account || "Unlimited"} business accounts
                  </small>
                </td>
                <td>{workspaceMode(item) === "brand-only" ? activeCount(item.departments) : activeCount(item.branches)} {workspaceMode(item) === "brand-only" ? "brands" : onlyStructure(item) ? "branches" : "departments"}</td>
                <td>
                  <Badge status={item.status} />
                </td>
                <td>
                  <details className="p-business-actions" name="business-actions">
                    <summary aria-label={`Actions for ${item.name}`}><span>Actions</span><Icon name="chevron" size={16} /></summary>
                    <div className="p-row-actions">
                    <button onClick={() => editBusiness(item)}>Manage</button>
                    <button disabled={busy} onClick={() => navigator.clipboard
                      .writeText(item.loginId || item.loginEmail)
                      .then(() => setNotice("Owner login ID copied."))
                      .catch(() => setError("Unable to copy the owner login ID."))}>
                      Copy login ID
                    </button>
                    <button disabled={busy} onClick={() => setEditor({
                      title: "Reset business password",
                      submitLabel: "Reset password",
                      description: `Set a new owner password for ${item.name}. The current password is not required. Existing owner sessions will be signed out. Share the new password securely with the business owner.`,
                      successMessage: "Business password reset. The owner can sign in with the same login ID and the new password.",
                      fields: [
                        { key: "loginId", label: "Owner login ID", readOnly: true },
                        { key: "password", label: "New password", type: "password", required: true },
                        { key: "confirmPassword", label: "Confirm new password", type: "password", required: true },
                      ],
                      values: { loginId: item.loginId || item.loginEmail },
                      save: (values) => {
                        if (values.password !== values.confirmPassword) throw new Error("Passwords do not match.");
                        return api(`/api/portal/businesses/${item.businessId}`, "PATCH", { password: values.password });
                      },
                    })}>Reset password</button>
                    <button disabled={busy} onClick={() => exportBusinessAccounts(item)}
                      title="Download owner and staff login details. Existing passwords cannot be retrieved and will not be changed.">
                      <Icon name="download" size={14} /> Download accounts (Excel)
                    </button>
                    <button onClick={() => openWorkspace(item.businessId)}>
                      Open workspace <Icon name="arrow" size={14} />
                    </button>
                    <button disabled={busy} onClick={() => setCouponManagerBusinessId(item.businessId)}>
                      Manage coupons
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        mutate(() =>
                          api(
                            `/api/portal/businesses/${item.businessId}`,
                            "PATCH",
                            {
                              status:
                                item.status === "active" ? "paused" : "active",
                            },
                          ),
                        )
                      }
                    >
                      {item.status === "active" ? "Pause" : "Activate"}
                    </button>
                    <button className="danger p-coupon-delete-all" disabled={busy || !cards.some((card) => card.businessId === item.businessId)}
                      onClick={() => requestDeleteAllCoupons(item)}>
                      {ui("Delete all coupons ({count})", { count: cards.filter(card => card.businessId === item.businessId).length })} · {item.name}
                    </button>
                    <button className="danger" disabled={busy}
                      onClick={() => setEditor({
                        title: "Delete business",
                        danger: true,
                        submitLabel: "Delete business",
                        successMessage: "Business deleted. Its accounts and shared card links are disabled.",
                        description: `Remove ${item.name} from the platform and disable its accounts and scratch-card links. Records are archived for recovery. Type the business name to confirm.`,
                        fields: [{ key: "confirmName", label: `Type ${item.name} to confirm`, required: true }],
                        save: (values) => api(`/api/portal/businesses/${item.businessId}`, "DELETE", values),
                      })}>
                      Delete
                    </button>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </Table>
        </article>
      );
    }
    if (tab === "Scratch cards" || tab === "Coupons")
      return <article className="p-card">{cardsTable(visibleCards, true)}</article>;
    if (tab === "Branches") {
      const groups = visibleDepartments.map((department) => ({
        ...department,
        key: `${department.businessId}:${department.departmentId}`,
        rows: visibleBranches.filter((unit) => unit.businessId === department.businessId
          && unit.departmentId === department.departmentId),
      })).filter((group) => !search.trim() || group.rows.length || match(group));
      // Older departments may have no physical branch, or reference an archived
      // branch omitted from this workspace. Keep those records manageable too.
      for (const unit of visibleBranches) {
        if (groups.some((group) => !group.unassigned && group.businessId === unit.businessId && group.departmentId === unit.departmentId)) continue;
        const key = `${unit.businessId}:${unit.departmentId || "unassigned"}`;
        const existing = groups.find((group) => group.key === key);
        if (existing) existing.rows.push(unit);
        else groups.push({ key, businessId: unit.businessId, departmentId: unit.departmentId,
          businessName: unit.businessName, name: unit.departmentName || ui("Unassigned"), unassigned: true, rows: [unit] });
      }
      const renderDepartments = (rows) => (
          <Table
            columns={[
              "Branch",
              ...(global ? ["Business"] : []),
              "Scratch cards",
              "Redeemed",
              "Address",
              "Access",
              "Actions",
            ]}
            empty={!rows.length}
          >
            {rows.map((item) => {
              const activity = branchActivity(item);
              const deleted = item.status === "deleted";
              const branchDepartment = businesses.find((value) => value.businessId === item.businessId)
                ?.departments?.find((department) => department.departmentId === item.departmentId);
              const canRestoreBranch = !item.departmentId || (branchDepartment?.status || "active") === "active";
              return <tr key={`${item.businessId}:${item.branchId}`}>
                <td>
                  <b>{item.name}</b>
                </td>
                {global && <td>{item.businessName}</td>}
                <td>{activity.total}</td>
                <td>{activity.redeemed}</td>
                <td>{item.address || "—"}</td>
                <td>
                  <Badge status={item.status} />
                </td>
                <td>
                  {admin && (
                    <div className="p-row-actions">
                      {!deleted && <button
                        onClick={() =>
                          setEditor({
                            title: "Edit branch",
                            fields: [...branchFields, ...(workspaceMode(businesses.find(value => value.businessId === item.businessId)) === "branch-only" ? [] : [{ key: "departmentId", label: "Department", type: "select",
                              options: [{ value: "", label: "Unassigned" }, ...(businesses.find((value) => value.businessId === item.businessId)?.departments || [])
                                .filter((department) => (department.status || "active") === "active")
                                .map((department) => ({ value: department.departmentId, label: department.name }))] }])],
                            values: item,
                            save: (values) =>
                              api(
                                `/api/portal/businesses/${item.businessId}/branches/${item.branchId}`,
                                "PATCH",
                                values,
                              ),
                          })
                        }
                      >
                        {ui("Edit")}
                      </button>}
                      {!deleted && <button
                        disabled={busy}
                        onClick={() =>
                          mutate(() =>
                            api(
                              `/api/portal/businesses/${item.businessId}/branches/${item.branchId}`,
                              "PATCH",
                              {
                                status:
                                  item.status === "active"
                                    ? "paused"
                                    : "active",
                              },
                            ),
                          )
                        }
                      >
                        {ui(item.status === "active" ? "Pause" : "Activate")}
                      </button>}
                      {!deleted && <button className="danger" disabled={busy}
                        onClick={() => setStructureToDelete({ resource: "branches", item })}>{ui("Delete branch")}</button>}
                      {deleted && platformAdmin && <button disabled={busy || !canRestoreBranch}
                        title={!canRestoreBranch ? "Restore this department's branch first" : undefined}
                        onClick={() => mutate(() => api(
                          `/api/portal/businesses/${item.businessId}/branches/${item.branchId}/restore`, "POST", {},
                        ))}>{ui("Restore branch")}</button>}
                      {global && <button onClick={() => openWorkspace(item.businessId, "Branches")}>
                        Manage business
                      </button>}
                    </div>
                  )}
                </td>
              </tr>;
            })}
          </Table>
      );
      if (!global && workspaceMode(business) === "branch-only") return <article className="p-card">
        <h2>Branches</h2>{renderDepartments(visibleBranches)}
      </article>;
      if (!global && workspaceMode(business) === "brand-only") return <article className="p-card">
        <h2>Brands</h2>
        <div className="p-department-groups">{groups.map(group => {
          const activity = group.rows.reduce((total, row) => {
            const value = branchActivity(row); return { total: total.total + value.total, redeemed: total.redeemed + value.redeemed };
          }, { total: 0, redeemed: 0 });
          return <div className="p-department-control" key={group.key}>
            <span><b>{group.name}</b><small>{activity.total} scratch cards · {activity.redeemed} redeemed</small></span>
            <Badge status={group.status || "active"} />
            {admin && !group.unassigned && group.status !== "deleted" && <button type="button" onClick={() => setEditor({
              title: "Edit brand", fields: [{ key: "name", label: "Brand name", required: true, maxLength: 60 }],
              values: { name: group.name },
              save: values => api(`/api/portal/businesses/${group.businessId}/brand-settings/${group.departmentId}`,
                "PATCH", { name: values.name }),
            })}>Edit brand</button>}
            {admin && !group.unassigned && group.status !== "deleted" && <button className="danger" disabled={busy}
              onClick={() => setStructureToDelete({ resource: "departments", item: group })}>Delete brand</button>}
            {admin && group.status === "deleted" && platformAdmin && <button className="restore" disabled={busy}
              onClick={() => mutate(() => api(`/api/portal/businesses/${group.businessId}/departments/${group.departmentId}/restore`, "POST", {}))}>Restore brand</button>}
          </div>;
        })}</div>
      </article>;
      const scope = JSON.stringify([workspaceId, businessFilter, locationFilter, departmentFilter, search]);
      return (
        <article className="p-card">
          {global && <div className="p-info">
            Platform control shows departments across every business. Filter by business, review coupon performance, change access, or open the business workspace directly.
          </div>}
          <section className="p-department-controls" aria-label={ui("Department controls")}>
            <strong>{ui("Departments")}</strong>
            <div className="p-department-groups">
              {groups.map((department) => {
                const expansionKey = `${scope}:${department.key}`;
                const expanded = expandedLocations[expansionKey] ?? Boolean(locationFilter || departmentFilter || search.trim());
                const panelId = `p-location-${encodeURIComponent(department.key)}`;
                return <div className="p-branch-group" key={department.key}>
                  <div className="p-department-control">
                    <button type="button" className="p-branch-toggle" aria-expanded={expanded} aria-controls={panelId}
                      onClick={() => setExpandedLocations((current) => ({ ...current, [expansionKey]: !expanded }))}>
                      <Icon name="chevron" size={18} />
                      <span><b>{department.name}</b>{global && <small>{department.businessName}</small>}</span>
                      <small className="p-branch-count">{department.rows.length} {ui(department.rows.length === 1 ? "Branch" : "Branches")}</small>
                    </button>
                    {!department.unassigned && <Badge status={department.status || "active"} />}
                    {admin && !department.unassigned && department.status !== "deleted" && <button type="button" className="brand-edit"
                      onClick={() => setEditor({
                        title: brandStructure(businesses.find(item => item.businessId === department.businessId)) ? "Edit brand" : "Edit department",
                        description: brandStructure(businesses.find(item => item.businessId === department.businessId))
                          ? "Rename this brand. Its departments and staff assignments stay connected."
                          : "Rename this department. Its branches and staff assignments stay connected.",
                        fields: [{ key: "name", label: brandStructure(businesses.find(item => item.businessId === department.businessId)) ? "Brand name" : "Department name", required: true, maxLength: 60 }],
                        values: { name: department.name },
                        save: (values) => api(`/api/portal/businesses/${department.businessId}/brand-settings/${department.departmentId}`,
                          "PATCH", { name: values.name }),
                      })}>{brandStructure(businesses.find(item => item.businessId === department.businessId)) ? ui("Edit brand") : ui("Edit department")}</button>}
                    {admin && !department.unassigned && department.status !== "deleted" && <button className="danger" disabled={busy}
                      onClick={() => setStructureToDelete({ resource: "departments", item: department })}>{ui("Delete department")}</button>}
                    {admin && !department.unassigned && department.status === "deleted" && platformAdmin && <button className="restore" disabled={busy} onClick={() =>
                      mutate(() => api(`/api/portal/businesses/${department.businessId}/departments/${department.departmentId}/restore`, "POST", {}))
                    }>{ui("Restore department")}</button>}
                  </div>
                  <div id={panelId} hidden={!expanded} className="p-branch-departments">
                    {expanded && renderDepartments(department.rows)}
                  </div>
                </div>;
              })}
              {!groups.length && renderDepartments([])}
            </div>
          </section>
        </article>
      );
    }
    if (tab === "Business accounts") {
      const rows = accounts.filter((item) => item.role !== "branch-staff" && match(item));
      return (
        <article className="p-card">
          <div className="p-info">
            Owners are managed in Businesses. Additional logins use the account
            allowance set for their business.
          </div>
          <Table
            columns={["Account", "Business", "Role", "Access", "Actions"]}
            empty={!rows.length}
          >
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <b>{item.name}</b>
                  <small>{item.loginId || item.email}</small>
                </td>
                <td>
                  {
                    businesses.find(
                      (value) => value.businessId === item.businessId,
                    )?.name
                  }
                </td>
                <td>{item.role}</td>
                <td>
                  <Badge status={item.status} />
                </td>
                <td>
                  <button
                    className="p-button small"
                    disabled={item.id === session.user.id}
                    onClick={() => editAccount(item)}
                  >
                    Manage access
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </article>
      );
    }
    if (tab === "Branch staff" && admin) {
      const rows = accounts.filter((item) => {
        if (item.role !== "branch-staff" || !inSelectedBusiness(item)) return false;
        const unit = branches.find((branch) => branch.businessId === item.businessId && branch.branchId === item.branchId);
        return matchesStructureFilters(unit) && match({ ...item,
          businessName: unit?.businessName,
          locationName: unit?.departmentName,
          departmentName: unit?.name,
        });
      });
      const groups = new Map();
      for (const item of rows) {
        const unit = branches.find((branch) => branch.businessId === item.businessId && branch.branchId === item.branchId);
        const location = departments.find((department) => department.businessId === item.businessId
          && department.departmentId === unit?.departmentId);
        // Group by persisted IDs, never by a location's display name. Keep
        // staff with deleted/missing assignments accessible under a fallback.
        const key = JSON.stringify([item.businessId, unit?.departmentId || null]);
        if (!groups.has(key)) groups.set(key, {
          key,
          name: location?.name || (unit?.departmentId ? "Unavailable branch" : "Unassigned"),
          businessName: businesses.find((business) => business.businessId === item.businessId)?.name || "Unavailable business",
          status: location?.status,
          rows: [],
        });
        groups.get(key).rows.push(item);
      }
      const renderStaff = (rows) => (
          <Table
            columns={["Staff", "Business", "Branch", "Login ID", "Last login", "Logins", "Access", "Actions"]}
            empty={!rows.length}
          >
            {rows.map((item) => {
              const staffBusiness = businesses.find((value) => value.businessId === item.businessId);
              const staffBranch = staffBusiness?.branches?.find((value) => value.branchId === item.branchId);
              return <tr key={item.id}>
                <td><b>{item.name}</b><small>Department staff</small></td>
                <td>{staffBusiness?.name || "Unavailable business"}</td>
                <td>{staffBranch?.name || "Unavailable department"}</td>
                <td className="p-code">{item.loginId || item.email}</td>
                <td>{item.lastLoginAt ? localizedDate(item.lastLoginAt) : "Never"}</td>
                <td>{item.loginCount || 0}</td>
                <td><Badge status={item.status} /></td>
                <td><div className="p-staff-actions">
                  <button className="p-button small" disabled={busy} onClick={() => editBranchStaff(item)}>
                    Manage staff
                  </button>
                  <button className="p-button small danger" disabled={busy} onClick={() => setStaffToDelete(item)}>{ui("Delete staff")}</button>
                </div></td>
              </tr>;
            })}
          </Table>
      );
      const scope = JSON.stringify([workspaceId, businessFilter, locationFilter, departmentFilter, search]);
      return (
        <article className="p-card">
          <div className="p-info">
            Create and monitor staff logins for individual departments. Department staff can redeem scratched coupons by code for their assigned business, but cannot create, edit, disable, or manage cards.
          </div>
          <section className="p-department-controls" aria-label={ui("Staff by brand")}>
            <strong>{ui("Departments")}</strong>
            <div className="p-department-groups">
              {[...groups.values()].map((group) => {
                const expansionKey = `staff:${scope}:${group.key}`;
                const expanded = expandedLocations[expansionKey] ?? Boolean(locationFilter || departmentFilter || search.trim());
                const panelId = `p-staff-location-${encodeURIComponent(group.key)}`;
                return <div className="p-branch-group" key={group.key}>
                  <div className="p-department-control">
                    <button type="button" className="p-branch-toggle" aria-expanded={expanded} aria-controls={panelId}
                      onClick={() => setExpandedLocations((current) => ({ ...current, [expansionKey]: !expanded }))}>
                      <Icon name="chevron" size={18} />
                      <span><b>{group.name}</b>{global && <small>{group.businessName}</small>}</span>
                      <small className="p-branch-count">{group.rows.length} {ui("Staff")}</small>
                    </button>
                    {group.status && <Badge status={group.status} />}
                  </div>
                  <div id={panelId} hidden={!expanded} className="p-branch-departments">
                    {expanded && renderStaff(group.rows)}
                  </div>
                </div>;
              })}
              {!groups.size && renderStaff([])}
            </div>
          </section>
        </article>
      );
    }
    if (tab === "Super admins" && global) {
      const rows = superAdmins.filter(match);
      return <article className="p-card">
        <div className="p-info">Super administrators have full platform access. The primary account and your own account cannot be paused.</div>
        <Table columns={["Account", "Login ID", "Access", "Actions"]} empty={!rows.length}>
          {rows.map((item) => <tr key={item.id}>
            <td><b>{item.name}</b><small>{item.primary ? "Primary account" : "Super administrator"}</small></td>
            <td className="p-code">{item.loginId}</td>
            <td><Badge status={item.status} /></td>
            <td>{!item.primary && item.id !== session.user.id && <button className="p-button small" disabled={busy}
              onClick={() => mutate(() => api(`/api/portal/super-admins/${item.id}`, "PATCH", { status: item.status === "active" ? "paused" : "active" }))}>
              {item.status === "active" ? "Pause" : "Activate"}
            </button>}</td>
          </tr>)}
        </Table>
      </article>;
    }
    if (tab === "Campaigns") {
      const rows = campaignRows;
      return (
        <>
        <div className="p-metrics">
          <article>
            <span>{ui("Total scratch cards")}</span>
            <strong>{managedCards.length}</strong>
            <small>{ui("Across all campaigns and branches")}</small>
          </article>
        </div>
        <article className="p-card">
          <div className="p-info">
            {global
              ? "Platform control compares campaign performance across businesses and departments. Filter by business or open its workspace for card creation and detailed management."
              : ui("Campaign results are grouped by business and branch. All branches counts cards without a specific branch.")}
          </div>
          <Table
            columns={[
              "Campaign",
              ...(global ? ["Business"] : []),
              "Branch",
              "Scratch cards",
              "Redeemed",
              "Conversion",
              ...(global ? ["Actions"] : []),
            ]}
            empty={!rows.length}
          >
            {rows.map((item) => (
              <tr key={JSON.stringify([item.key, item.branchId])}>
                <td>
                  <b>{item.defaultName ? ui("General rewards") : item.name}</b>
                </td>
                {global && <td>{item.businessName}</td>}
                <td>{item.branchId ? item.branchName : ui("All branches")}</td>
                <td>{item.total}</td>
                <td>{item.used}</td>
                <td>{Math.round((item.used / item.total) * 100)}%</td>
                {global && <td><button className="p-button small"
                  onClick={() => openWorkspace(item.businessId, "Campaigns")}>
                  Manage business
                </button></td>}
              </tr>
            ))}
          </Table>
        </article>
        </>
      );
    }
    if (tab === "Analytics")
      return (
        <>
          <div className="p-metrics p-analytics-metrics" aria-label={ui("Analytics summary")}>
            {analyticsStats.map((item) => (
              <article key={item.title} data-status={item.status}>
                <span>{ui(item.title)}</span>
                <strong>{item.value}</strong>
                <small>{ui(item.caption)}</small>
              </article>
            ))}
          </div>
          <div className="p-info p-analytics-breakdown" role="status">
            <p>{ui("Coupon breakdown")}: {COUPON_STATUSES.map((status, index) => <React.Fragment key={status}>
              {index > 0 && " + "}{ui(status)} {couponCounts[status]}
            </React.Fragment>)} = {couponCounts.total} {ui("Total coupons")}</p>
            <p>{couponCounts.total
              ? ui("Redemption rate: {redeemed} ÷ {total} × 100 = {rate}% (rounded).", {
                redeemed: couponCounts.redeemed, total: couponCounts.total, rate: couponCounts.redemptionRate,
              })
              : ui("No coupons yet. Redemption rate is 0%.")}</p>
            <p>{ui("Each coupon appears in one status only. Redeemed coupons remain redeemed; other disabled or expired coupons are excluded from opened and scratched counts.")}</p>
          </div>
          <article className="p-card">
            <div className="p-card-title">
              <h2>Department performance</h2>
              <button
                className="p-button"
                onClick={exportCards}
                disabled={busy || !cards.length}
              >
                <Icon name="download" />
                Export coupons
              </button>
            </div>
            <Table
              columns={["Branch", "Business", "Created", "Redeemed", "Rate"]}
              empty={!branches.length}
            >
              {branches.map((item) => {
                const rows = cards.filter(
                    (card) => card.branchId === item.branchId,
                  ),
                  count = rows.filter((card) => card.used).length;
                return (
                  <tr key={item.branchId}>
                    <td>{item.name}</td>
                    <td>{item.businessName}</td>
                    <td>{rows.length}</td>
                    <td>{count}</td>
                    <td>
                      {rows.length
                        ? Math.round((count / rows.length) * 100)
                        : 0}
                      %
                    </td>
                  </tr>
                );
              })}
            </Table>
          </article>
        </>
      );
    if (tab === "Audit") {
      const rows = events.filter(match);
      return (
        <article className="p-card">
          <Table
            columns={["Action", "Actor", "Business", "Details", "Time"]}
            empty={!rows.length}
          >
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <b>{ui(item.action)}</b>
                </td>
                <td>{item.actor}</td>
                <td>
                  {businesses.find(
                    (value) => value.businessId === item.businessId,
                  )?.name || "Platform"}
                </td>
                <td>{item.detail ? ui(item.detail) : "—"}</td>
                <td>{date(item.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </article>
      );
    }
    if (tab === "Security") {
      const openAccountPasswordEditor = () => setEditor({
        title: "Change your password",
        description: "Your existing password cannot be recovered. Enter it to verify your identity, then choose a new password.",
        successMessage: "Password changed. Your new password can be revealed until this page is refreshed.",
        skipRefresh: true,
        fields: [
          { key: "currentPassword", label: "Current password", type: "password", required: true },
          { key: "password", label: "New password", type: "password", minLength: 10, required: true },
          { key: "confirmPassword", label: "Confirm new password", type: "password", minLength: 10, required: true },
        ],
        save: (values) => {
          if (values.password !== values.confirmPassword) throw new Error("Passwords do not match.");
          return api("/api/portal/security/password", "POST", {
            currentPassword: values.currentPassword,
            password: values.password,
          }).then((result) => {
            setTemporaryAdminPassword(values.password);
            setVisibleAdminPassword(false);
            onSessionChange?.({ token: result.token, user: result.user });
            return result;
          });
        },
      });
      return (
        <div className="p-security-grid">
          <article className="p-card">
            <span className="p-welcome">
              <Icon name="security" />
            </span>
            <h2>Your account</h2>
            <p>{session.user.loginId || session.user.email}</p>
            <dl>
              <dt>Role</dt>
              <dd>{session.user.role}</dd>
              <dt>Session</dt>
              <dd>Signed and expiry-checked on the server</dd>
            </dl>
            <label>Password</label>
            <div className="p-password p-protected-password">
              <input aria-label="Password" type={visibleAdminPassword ? "text" : "password"}
                value={temporaryAdminPassword || "protected-password"} readOnly
                autoComplete="off" spellCheck={false} />
              <button type="button"
                aria-label={temporaryAdminPassword
                  ? `${visibleAdminPassword ? "Hide" : "Show"} password`
                  : "Change password to set a new value"}
                title={temporaryAdminPassword
                  ? `${visibleAdminPassword ? "Hide" : "Show"} the newly set password`
                  : "The existing password cannot be recovered. Change it to set a new password."}
                onClick={() => temporaryAdminPassword
                  ? setVisibleAdminPassword((value) => !value)
                  : openAccountPasswordEditor()}>
                <Icon name="eye" />
              </button>
            </div>
            <p>{temporaryAdminPassword
              ? "The newly set password is available only in this page's memory and disappears after refresh."
              : "The existing password cannot be recovered because it is protected with one-way hashing. Change it to set a new visible value."}</p>
            <button
              className="p-button"
              onClick={openAccountPasswordEditor}
            >
              Change password
            </button>
          </article>
          {admin && (
            <article className="p-card">
              <h2>Session control</h2>
              <p>
                Signs out every other {global ? "business owner, staff member, and super admin" : "workspace account"}
                on their next request. Your current account remains signed in.
              </p>
              <button
                className="p-button danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Revoke other account sessions?"))
                    mutate(() =>
                      api(scoped("/api/portal/security/revoke"), "POST", {}),
                    );
                }}
              >
                Revoke other sessions
              </button>
              <p>This does not delete accounts, change passwords, or remove business data.</p>
            </article>
          )}
        </div>
      );
    }
    if (tab === "Platform settings")
      return (
        <article className="p-card p-settings p-platform-settings">
          <h2>Platform configuration</h2>
          <p>Manage your portal identity and global access.</p>
          {config && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                mutate(() => api("/api/portal/settings", "PUT", config));
              }}
            >
              <fieldset className="p-setting-group">
                <legend>Portal identity & support</legend>
              <label>
                Platform name
                <input
                  required
                  maxLength={40}
                  value={config.platformName}
                  onChange={(event) =>
                    setConfig({ ...config, platformName: event.target.value })
                  }
                />
              </label>
              <label>
                Support email
                <input
                  type="email"
                  value={config.supportEmail}
                  onChange={(event) =>
                    setConfig({ ...config, supportEmail: event.target.value })
                  }
                />
              </label>
              <label>
                Support website
                <input type="url" maxLength={500} placeholder="https://example.com/support"
                  value={config.supportUrl || ""}
                  onChange={(event) => setConfig({ ...config, supportUrl: event.target.value })} />
              </label>
              <label className="p-setting-wide">
                Login welcome message
                <input maxLength={200} value={config.loginMessage || ""}
                  onChange={(event) => setConfig({ ...config, loginMessage: event.target.value })} />
              </label>
              <p className="p-setting-wide">Shown on the sign-in page. Leave the support website empty to hide its link.</p>
              </fieldset>
              <fieldset className="p-setting-group">
                <legend>New business defaults</legend>
                <p className="p-setting-wide">Prefills the Create business form. Existing businesses are not changed. Use 0 for unlimited; accounts include the owner login.</p>
                {[["card", "Default scratch-card limit"], ["branch", "Default department limit"], ["department", "Default branch limit"], ["account", "Default business account limit"]].map(([key, label]) => (
                  <label key={key}>{label}
                    <input type="number" min="0" max="1000000000" step="1" required
                      value={config.defaultLimits?.[key] ?? ""}
                      onChange={(event) => setConfig({ ...config, defaultLimits: { ...config.defaultLimits, [key]: event.target.value } })} />
                  </label>
                ))}
              </fieldset>
              <fieldset className="p-setting-group">
                <legend>Access & sessions</legend>
              <label>
                Session duration (hours)
                <input
                  type="number"
                  min="1"
                  max="48"
                  value={config.sessionHours}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      sessionHours: Number(event.target.value),
                    })
                  }
                />
              </label>
              <p>Session duration applies to new logins. Disabling business access blocks business accounts, not super administrators. Disabling creation stops new cards, not existing rewards.</p>
              <label className="p-switch">
                <input
                  type="checkbox"
                  checked={config.memberAccess}
                  onChange={(event) =>
                    setConfig({ ...config, memberAccess: event.target.checked })
                  }
                />
                Allow business sign-in and member access
              </label>
              <label className="p-switch">
                <input
                  type="checkbox"
                  checked={config.cardCreation}
                  onChange={(event) =>
                    setConfig({ ...config, cardCreation: event.target.checked })
                  }
                />
                Allow scratch-card creation
              </label>
              </fieldset>
              <button className="p-button primary" disabled={busy}>
                Save platform settings
              </button>
            </form>
          )}
        </article>
      );
    if (tab === "Card image settings" && admin && business) return <BrandSettings key={business.businessId}
      business={business} onManageBrands={createDepartmentHierarchy}
      save={async (suffix, values) => {
        const result = await api(`/api/portal/businesses/${workspaceId}/brand-settings${suffix}`, "PATCH", values);
        await refresh(true);
        return result;
      }} />;
    if (tab === "Business settings") {
      const accountLoginId = platformAdmin
        ? business?.loginId || business?.loginEmail
        : session.user.loginId || session.user.email;
      const passwordFields = [
        ...(!platformAdmin ? [{ key: "currentPassword", label: "Current password", type: "password", required: true }] : []),
        { key: "password", label: "New password", type: "password", minLength: 10, required: true },
        { key: "confirmPassword", label: "Confirm new password", type: "password", minLength: 10, required: true },
      ];
      const openPasswordEditor = () => setEditor({
        title: platformAdmin ? `Reset ${business?.name} owner password` : "Change your password",
        submitLabel: platformAdmin ? "Reset password" : "Change password",
        description: platformAdmin
          ? "Set a new password for this business owner. Their existing sessions will be signed out."
          : "Enter your current password and choose a new password. You will need to sign in again after it changes.",
        successMessage: platformAdmin
          ? "Business password reset. Existing owner sessions were signed out."
          : "Password changed. Sign in again with your new password.",
        fields: passwordFields,
        save: (values) => {
          if (values.password !== values.confirmPassword) throw new Error("Passwords do not match.");
          if (platformAdmin)
            return api(`/api/portal/businesses/${workspaceId}`, "PATCH", { password: values.password })
              .then((result) => {
                setTemporaryOwnerPasswords((current) => ({ ...current, [workspaceId]: values.password }));
                setVisibleOwnerPasswords((current) => ({ ...current, [workspaceId]: false }));
                return result;
              });
          return api("/api/portal/security/password", "POST", {
            currentPassword: values.currentPassword,
            password: values.password,
          });
        },
      });
      return (
        <div className="p-business-settings">
          <article className="p-card p-settings p-business-settings-wide">
            <div className="p-card-title">
              <div><span className="p-eyebrow">WORKSPACE PROFILE</span><h2>Business information</h2></div>
            </div>
            <p>Manage the business identity used throughout the dashboard and on newly created scratch cards.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              mutate(() => api(`/api/portal/businesses/${workspaceId}`, "PATCH", {
                ...(canRenameWorkspace ? { name: form.get("name") } : {}),
                ...(canManageWorkspace ? { website: form.get("website") } : {}),
              }));
            }}>
              <fieldset className="p-setting-group">
                <legend>Business profile</legend>
                <label>Business name
                  <input key={business?.name} name="name" maxLength="60" required
                    defaultValue={business?.name || ""} disabled={!canRenameWorkspace} />
                </label>
                <label>Website
                  <input key={business?.website} name="website" type="url" maxLength="500"
                    placeholder="https://example.com" defaultValue={business?.website || ""}
                    disabled={!canManageWorkspace} />
                </label>
                <label>Login ID
                  <input key={accountLoginId} name={undefined}
                    defaultValue={accountLoginId || ""} readOnly
                    disabled
                    required={Boolean(business?.loginId)} minLength={business?.loginId ? 6 : undefined}
                    maxLength={business?.loginId ? 16 : undefined}
                    pattern={business?.loginId ? "(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{6,16}" : undefined}
                    title={business?.loginId ? "Use 6–16 letters and numbers, including at least one of each." : undefined} />
                </label>
                {false && platformAdmin && !business?.loginId && <label>New login ID (optional)
                  <input name="loginId" minLength="6" maxLength="16"
                    pattern="(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{6,16}"
                    title="Use 6–16 letters and numbers, including at least one of each." />
                </label>}
                <label>Account role
                  <input value={platformAdmin ? "Business owner" : session.user.role} readOnly />
                </label>
                <p className="p-setting-wide">{platformAdmin
                  ? "Changing the owner login ID signs out existing owner sessions. Login IDs must contain 6–16 letters and numbers."
                  : "The login ID can be viewed, but only a super administrator can change it. The current password cannot be recovered because it is protected with one-way hashing."}</p>
              </fieldset>
              {canManageWorkspace && <button className="p-button primary" disabled={busy}>Save business information</button>}
            </form>
          </article>

          <article className="p-card p-settings">
            <h2>Brand appearance</h2>
            <p>Set the default colors used when this business creates a scratch card.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              mutate(() => api(`/api/portal/businesses/${workspaceId}`, "PATCH", {
                brand: {
                  pageColor: form.get("pageColor"),
                  textColor: form.get("textColor"),
                  accentColor: form.get("accentColor"),
                },
              }));
            }}>
              <div className="p-business-color-grid">
                {[
                  ["pageColor", "Page background", "#4b0024"],
                  ["textColor", "Message text", "#fff8f5"],
                  ["accentColor", "Scratch card", "#ff9b72"],
                ].map(([key, label, fallback]) => (
                  <label key={`${key}:${business?.brand?.[key]}`}>{label}
                    <input name={key} type="color" defaultValue={business?.brand?.[key] || fallback}
                      disabled={!canManageWorkspace} />
                  </label>
                ))}
              </div>
              {canManageWorkspace && <button className="p-button primary" disabled={busy}>Save appearance</button>}
            </form>
          </article>

          <article className="p-card p-settings">
            <h2>Login & password</h2>
            <p><b>{accountLoginId || "No login ID"}</b></p>
            <label>Password</label>
            <div className="p-password p-protected-password">
              <input aria-label="Password" readOnly autoComplete="off" spellCheck={false}
                type={visibleOwnerPasswords[workspaceId] ? "text" : "password"}
                value={temporaryOwnerPasswords[workspaceId] || "protected-password"} />
              <button type="button"
                aria-label={temporaryOwnerPasswords[workspaceId]
                  ? `${visibleOwnerPasswords[workspaceId] ? "Hide" : "Show"} password`
                  : `Reset password to reveal a new value`}
                title={temporaryOwnerPasswords[workspaceId]
                  ? `${visibleOwnerPasswords[workspaceId] ? "Hide" : "Show"} password`
                  : "The existing password cannot be recovered. Reset it to view a new password."}
                onClick={() => temporaryOwnerPasswords[workspaceId]
                  ? setVisibleOwnerPasswords((current) => ({ ...current, [workspaceId]: !current[workspaceId] }))
                  : openPasswordEditor()}>
                <Icon name="eye" />
              </button>
            </div>
            <p>{temporaryOwnerPasswords[workspaceId]
              ? "The newly reset password can be shown with the eye button until this page is refreshed."
              : `The existing password cannot be recovered because it is protected with one-way hashing. ${platformAdmin ? "Reset it" : "Change it"} to set a new password.`}</p>
            <button type="button" className="p-button" onClick={openPasswordEditor}>
              <Icon name="security" /> {platformAdmin ? "Reset owner password" : "Change password"}
            </button>
          </article>

          <article className="p-card p-settings">
            <h2>Workspace usage & limits</h2>
            <dl className="p-business-usage">
              <div><dt>Scratch cards</dt><dd>{cards.length} / {business?.limits?.card || "Unlimited"}</dd></div>
              {workspaceMode(business) !== "brand-only" && <div><dt>{ui("Branches")}</dt><dd>{activeCount(business?.branches)} / {business?.limits?.branch || "Unlimited"}</dd></div>}
              {workspaceMode(business) !== "branch-only" && <div><dt>{brandStructure(business) ? "Brands" : "Branches"}</dt><dd>{activeCount(business?.departments)} / {business?.limits?.department || "Unlimited"}</dd></div>}
              <div><dt>Business accounts</dt><dd>{accounts.length} / {business?.limits?.account || "Unlimited"}</dd></div>
            </dl>
            <p>Only a super administrator can change workspace limits.</p>
          </article>

          {admin && <article className="p-card p-settings p-business-settings-wide">
            <h2>Session control</h2>
            <p>Sign out other accounts in this workspace. Your current account remains active.</p>
            <button type="button" className="p-button danger" disabled={busy} onClick={() => {
              if (window.confirm("Revoke other workspace sessions?"))
                mutate(() => api(scoped("/api/portal/security/revoke"), "POST", {}));
            }}>Revoke other sessions</button>
          </article>}
        </div>
      );
    }
  };
  const add =
    tab === "Businesses"
      ? createBusiness
      : tab === "Branches" && admin
        ? onlyStructure(business) ? null : createBranch
        : tab === "Business accounts"
          ? createAccount
          : tab === "Branch staff" && admin
            ? createBranchStaff
          : tab === "Super admins" && global ? createSuperAdmin
          : null;
  return (
    <WorkspaceLocale.Provider value={ui}>
    <div className={`p-shell ${menu ? "menu-open" : ""}`} data-theme={theme} lang={language}>
      <button
        className="p-nav-shade"
        aria-label={ui("Close menu")}
        onClick={() => setMenu(false)}
      />
      <aside className="p-sidebar" id="workspace-navigation" ref={sidebarRef}
        inert={compactNavigation && !menu ? true : undefined}
        aria-hidden={compactNavigation && !menu ? true : undefined}>
        <a
          className="p-brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("Overview");
          }}
        >
          <JustConnectLogo theme={theme} />
          <small>
            {ui(global ? "Super administrator" : branchStaff ? "Branch staff workspace" : "Business workspace")}
          </small>
        </a>
        <div className="p-workspace-chip">
          <Icon name={global ? "security" : "business"} />
          <div>
            <b>{global ? "Platform control" : business?.name || ui("Workspace")}</b>
            {branchStaff && branchStaffBranch && <small className="p-workspace-assignment">
              {onlyStructure(business) ? branchStaffBranch.name : `${ui("Department")}: ${branchStaffLocationName} · ${branchStaffBranch.name}`}
            </small>}
            <small>
              {global
                ? `${businesses.length} business workspaces`
                : ui(business?.status || "Business account")}
            </small>
          </div>
        </div>
        <small className="p-nav-label">
          {ui(global ? "PLATFORM MANAGEMENT" : "WORKSPACE MANAGEMENT")}
        </small>
        <nav>
          {nav.map(([name, icon]) => (
            <button
              key={name}
              type="button"
              className={tab === name ? "active" : ""}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => navigate(name)}
            >
              <Icon name={icon} />
              <span>{ui(name === "Branches" ? onlyStructure(business) ? "Branches" : "Departments & Branches" : name)}</span>
            </button>
          ))}
        </nav>
        <div className="p-sidebar-account">
          <span className="p-avatar">
            {session.user.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <b>{session.user.name}</b>
            <small>
              {ui(session.user.role === "business"
                ? "Business owner"
                : branchStaff ? "Branch staff" : session.user.role)}
            </small>
          </div>
          <button onClick={onLogout} aria-label={ui("Sign out")} title={ui("Sign out")}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main className="p-main" inert={compactNavigation && menu ? true : undefined}>
        <header className="p-topbar">
          <div>
            <button
              className="p-icon-button p-menu"
              ref={menuButtonRef}
              aria-expanded={menu}
              aria-controls="workspace-navigation"
              onClick={() => setMenu(!menu)}
              aria-label={ui("Open navigation")}
            >
              <Icon name="menu" />
            </button>
            <span className="p-breadcrumb">
              {global ? "Platform" : business?.name || ui("Business")}
              <i>/</i>
              <b>{ui(tab === "Branches" ? "Departments & Branches" : tab)}</b>
            </span>
          </div>
          <div>
            <button className="p-icon-button p-theme-toggle" type="button"
              role="switch" aria-checked={theme === "dark"} aria-label={ui("Dark mode")}
              title={ui(theme === "dark" ? "Switch to light mode" : "Switch to dark mode")}
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>
              <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
            </button>
            {!global && <select
              aria-label={ui("Language")}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="te">తెలుగు</option>
            </select>}
            <button className="p-button small" onClick={onLogout}>
              <Icon name="logout" />
              {ui("Sign out")}
            </button>
          </div>
        </header>
        {platformAdmin && workspaceId && (
          <div className="p-workspace-banner">
            <span>
              <Icon name="security" />
              You are managing the {business?.name || "selected"} business
              workspace.
            </span>
            <button onClick={() => openWorkspace("")}>
              Return to super admin <Icon name="arrow" size={14} />
            </button>
          </div>
        )}
        <div className="p-content">
          {tab !== "Overview" && (
            <div className="p-page-heading">
              <div>
                <span className="p-eyebrow">
                  {global ? "PLATFORM CONTROL" : business?.name}
                </span>
                <h1>{ui(tab === "Branches" ? onlyStructure(business) ? "Branches" : "Departments & Branches" : tab)}</h1>
              </div>
              <div className="p-heading-actions">
              {!global && canCreate && tab === "Campaigns" && (
                <button className="p-button primary" onClick={() => navigate("Create scratch card")}>
                  <Icon name="plus" />{ui("Create scratch card")}
                </button>
              )}
              {global && tab === "Businesses" && (
                <button className="p-button danger" disabled={busy || loading || !businesses.length} onClick={deleteAllBusinesses}>
                  Delete all businesses
                </button>
              )}
              {admin && tab === "Branches" && (
                <button className="p-button" onClick={createDepartmentHierarchy}
                  disabled={hierarchyCreationDisabled}
                  title={hierarchyCreationDisabled ? ui("Department or branch limit reached") : undefined}>
                  <Icon name="plus" />
                  {global ? "Add structure" : onlyStructure(business)
                    ? workspaceMode(business) === "brand-only" ? "Add brand" : "Add branch"
                    : ui("Add departments & branches")}
                </button>
              )}
              {add && (
                <button className="p-button primary" onClick={add}
                  disabled={(tab === "Branches" && branchCreationDisabled)
                    || (tab === "Branch staff" && !branches.some((branch) => branch.status === "active"))}
                  title={tab === "Branches" && branchCreationDisabled
                    ? ui("Branch limit reached")
                    : tab === "Branch staff" && !branches.some((branch) => branch.status === "active")
                      ? ui("Create an active business branch first")
                      : undefined}>
                  <Icon name="plus" />
                  {ui(tab === "Businesses"
                    ? "Create business"
                    : tab === "Branches"
                      ? "Add branch"
                      : tab === "Branch staff" ? "Add branch staff"
                      : tab === "Super admins" ? "Create super admin" : "Add account")}
                </button>
              )}
              </div>
            </div>
          )}
          {notice && (
            <div className="p-alert p-alert-success" role="status">
              <Icon name="check" size={20} />
              <span>{ui(notice)}</span>
              <button type="button" aria-label={ui("Dismiss notification")} onClick={() => setNotice("")}>
                <Icon name="close" size={18} />
              </button>
            </div>
          )}
          {error && (
            <div className="p-alert error" role="alert">
              {ui(error)}
              <button onClick={refresh}>{ui("Retry")}</button>
            </div>
          )}
          {![
            "Overview",
            "Create scratch card",
            "Security",
            "Card image settings",
            "Platform settings",
          ].includes(tab) && (
            <div className="p-toolbar">
              <div className="p-search">
                <Icon name="search" />
                <input
                  placeholder={ui("Search {section}…", { section: tab.toLowerCase() })}
                  aria-label={ui("Search {section}", { section: tab })}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div>
                {global && ["Campaigns", "Scratch cards", "Branches", "Branch staff"].includes(tab) && (
                  <select aria-label="Filter by business" value={businessFilter}
                    onChange={(event) => {
                      setBusinessFilter(event.target.value);
                      setCouponFilters((current) => ({ ...current, branch: "", campaign: "" }));
                    }}>
                    <option value="">All businesses</option>
                    {businesses.map((item) => (
                      <option key={item.businessId} value={item.businessId}>{item.name}</option>
                    ))}
                  </select>
                )}
                {(tab === "Branches" || (tab === "Branch staff" && admin)) && <>
                  <select className="p-structure-filter" aria-label={ui("Filter by department")} value={locationFilter}
                    onChange={(event) => {
                      setLocationFilter(event.target.value);
                      setDepartmentFilter("");
                    }}>
                    <option value="">{ui("All departments")}</option>
                    <option value="unassigned">{ui("Unassigned")}</option>
                    {locationOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select className="p-structure-filter" aria-label={ui("Filter by branch")} value={departmentFilter}
                    onChange={(event) => setDepartmentFilter(event.target.value)}>
                    <option value="">{ui("All branches")}</option>
                    {departmentOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </>}
                {tab === "Campaigns" && (
                  <button className="p-button" disabled={busy || loading || !campaignRows.length} onClick={exportCampaigns}>
                    <Icon name="download" />{busy ? ui("Working…") : ui("Export campaigns")}
                  </button>
                )}
                {tab === "Branches" && (
                  <button className="p-button" disabled={busy || loading || !visibleBranches.length} onClick={exportBranches}>
                    <Icon name="download" />{busy ? ui("Working…") : ui("Export branches")}
                  </button>
                )}
                {["Coupons", "Scratch cards"].includes(tab) && (
                  <>
                    <select
                      aria-label={ui("Coupon status")}
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      {[
                        "all",
                        "available",
                        "opened",
                        "scratched",
                        "redeemed",
                        "disabled",
                        "expired",
                        ...(platformAdmin ? ["deleted"] : []),
                      ].map((value) => (
                        <option key={value} value={value}>
                          {ui(value === "all" ? "All statuses" : value)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="p-button"
                      disabled={busy || !visibleCards.length}
                      onClick={exportCards}
                    >
                      <Icon name="download" />
                      {busy ? ui("Working…") : t("exportExcel")}
                    </button>
                    {admin && <button type="button" className="p-button danger p-coupon-delete-all"
                      disabled={busy || loading || !couponDeletionBusiness || !couponDeletionCount}
                      onClick={() => requestDeleteAllCoupons(couponDeletionBusiness, couponDeletionRows)}>
                      {ui("Delete matching coupons ({count})", { count: couponDeletionCount })}
                      {" · "}{couponDeletionBusiness?.name || ui("Select a business")}
                    </button>}
                  </>
                )}
                <button
                  className="p-icon-button"
                  onClick={refresh}
                  aria-label={ui("Refresh data")}
                >
                  <Icon name="refresh" />
                </button>
              </div>
            </div>
          )}
          {couponSection && (
            <section className="p-card p-coupon-filters" aria-label={ui("Coupon filters")}>
              <div className="p-card-title">
                <h2>{ui("Coupon filters")}</h2>
                <button type="button" className="p-button small" onClick={clearCouponFilters}>
                  {ui("Clear filters")}
                </button>
              </div>
              <div className="p-coupon-type-switch" role="group" aria-label={ui("Coupon type")}>
                {[["all", "All coupons"], ["individual", "Individual coupons"], ["bulk", "Bulk coupons"]].map(([value, label]) => (
                  <button key={value} type="button" aria-label={ui(label)}
                    className={`p-button small${couponFilters.type === value ? " primary" : ""}`}
                    aria-pressed={couponFilters.type === value}
                    onClick={() => updateCouponFilter("type", value)}>
                    {ui(label)} <span>({managedCards.filter(card => value === "all"
                      || (value === "bulk" ? Boolean(card.batchKey) : !card.batchKey)).length})</span>
                  </button>
                ))}
              </div>
              <div className="p-coupon-filter-fields">
                <label>
                  {ui("Coupon code")}
                  <input type="search" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24}
                    aria-label={ui("Search coupon code")}
                    placeholder={ui("Enter coupon code…")}
                    value={couponFilters.code}
                    onChange={(event) => updateCouponFilter("code", event.target.value)} />
                </label>
                <label>
                  {ui("WhatsApp number")}
                  <input type="search" inputMode="tel" autoComplete="off"
                    aria-label={ui("Search WhatsApp number")}
                    placeholder={ui("Number or last digits…")}
                    value={couponFilters.number}
                    onChange={(event) => updateCouponFilter("number", event.target.value)} />
                </label>
                <label>
                  {ui("Branch")}
                  <select aria-label={ui("Filter by branch")} value={couponFilters.branch}
                    onChange={(event) => updateCouponFilter("branch", event.target.value)}>
                    <option value="">{ui("Any branch")}</option>
                    <option value="unassigned">{ui("No specific branch")}</option>
                    {[...couponBranchOptions.values()].sort((a, b) => a.name.localeCompare(b.name)).map((branch) => (
                      <option key={branch.key} value={branch.key}>{branch.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {ui("Branch staff")}
                  <select aria-label={ui("Filter by branch staff")} value={couponFilters.staff}
                    onChange={(event) => updateCouponFilter("staff", event.target.value)}>
                    <option value="">{ui("All branch staff")}</option>
                    {[...couponStaffOptions.values()].sort((a, b) => a.name.localeCompare(b.name)).map(staff => (
                      <option key={staff.key} value={staff.key}>{staff.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {ui("Campaign")}
                  <select aria-label={ui("Filter by campaign")} value={couponFilters.campaign}
                    onChange={(event) => updateCouponFilter("campaign", event.target.value)}>
                    <option value="">{ui("All campaigns")}</option>
                    {couponCampaignOptions.map((campaign) => (
                      <option key={campaign.key} value={campaign.key}>{campaign.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {ui("Created date range")}
                  <select aria-label={ui("Created date range")} value={couponFilters.dateRange}
                    onChange={(event) => setCouponFilters((current) => ({ ...current, dateRange: event.target.value, from: "", to: "" }))}>
                    {[["all", "All time"], ["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"], ["custom", "Custom dates"]].map(([value, label]) => (
                      <option key={value} value={value}>{ui(label)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {couponFilters.dateRange === "custom" && (
                <div className="p-coupon-custom-dates">
                  <label>{ui("Created from")}
                    <input type="date" aria-label={ui("Created from")} value={couponFilters.from}
                      onChange={(event) => updateCouponFilter("from", event.target.value)} />
                  </label>
                  <label>{ui("Created to")}
                    <input type="date" aria-label={ui("Created to")} value={couponFilters.to}
                      onChange={(event) => updateCouponFilter("to", event.target.value)} />
                  </label>
                </div>
              )}
              {couponDateError && <p className="error" role="alert">{ui(couponDateError)}</p>}
              <div className="p-coupon-filter-summary">
                <span>{ui("Date filters use the card creation date.")}</span>
                <span aria-live="polite">{ui("Showing {count} of {total} coupons", { count: visibleCards.length, total: managedCards.length })}</span>
              </div>
            </section>
          )}
          {loading ? (
            <div className="p-loading">
              <span />
              {ui("Loading workspace…")}
            </div>
          ) : (
            render()
          )}
        </div>
      </main>
      {couponManagerBusinessId && (() => {
        const managedBusiness = businesses.find((item) => item.businessId === couponManagerBusinessId);
        if (!managedBusiness) return null;
        const managedCoupons = cards.filter((card) => card.businessId === managedBusiness.businessId);
        return <CouponManagerDialog business={managedBusiness} cards={managedCoupons} busy={busy}
          onClose={() => setCouponManagerBusinessId("")}
          onPreview={setPreviewCard}
          onCopy={(card) => navigator.clipboard.writeText(scratchCardUrl(card.slug))
            .then(() => setNotice("Share link copied."))
            .catch(() => setError("Unable to copy. Open the card to copy its URL."))}
          onDeleteCoupon={(card) => requestDeleteCoupon(managedBusiness, card)}
          onRestoreCoupon={(card) => requestRestoreCoupon(managedBusiness, card)}
          onDeleteAll={(matching) => requestDeleteAllCoupons(managedBusiness, matching)} />;
      })()}
      {editor && (
        <Editor
          key={editor.title}
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={saved}
        />
      )}
      {departmentEditor && <DepartmentBranchEditor businesses={businesses}
        initialBusinessId={workspaceId} language={language} onClose={() => setDepartmentEditor(false)} onSave={saveDepartmentHierarchy} />}
      {previewCard && (
        <CardPreviewDialog
          card={previewCard}
          ScratchCard={ScratchCard}
          t={previewCard.language ? cardTranslator(previewCard.language) : t}
          onClose={() => setPreviewCard(null)}
        />
      )}
      {credentials && <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />}
      {staffToDelete && <DeleteConfirmationDialog title="Delete staff account?"
        message="Delete staff account for {name}? They will lose login access immediately. Coupon redemption history will be kept."
        values={{ name: staffToDelete.name }} confirmLabel="Delete staff" onClose={() => setStaffToDelete(null)}
        onDelete={async () => {
          await api(`/api/portal/users/${staffToDelete.id}`, "DELETE", { confirmName: staffToDelete.name });
          setStaffToDelete(null);
          setNotice("Staff account deleted.");
          await refresh();
        }} />}
      {structureToDelete && <DeleteConfirmationDialog
        title={structureToDelete.resource === "departments" ? "Delete department?" : "Delete branch?"}
        message={structureToDelete.resource === "departments"
          ? "Delete department “{name}” and all branches under it? They will be removed from this workspace and archived for super administrators."
          : "Delete branch “{name}”? It will be removed from this workspace and archived for super administrators."}
        values={{ name: structureToDelete.item.name }}
        confirmLabel={structureToDelete.resource === "departments" ? "Delete department" : "Delete branch"}
        onClose={() => setStructureToDelete(null)} onDelete={async () => {
          const { resource, item } = structureToDelete;
          await api(`/api/portal/businesses/${item.businessId}/${resource}/${resource === "departments" ? item.departmentId : item.branchId}`, "DELETE");
          setStructureToDelete(null);
          setNotice("Changes saved successfully.");
          await refresh();
        }} />}
      {redemptionFeedback && <RedemptionResultDialog feedback={redemptionFeedback} structureMode={workspaceMode(business)}
        onClose={() => setRedemptionFeedback(null)} />}
      {branchStaff && scannerOpen && <CouponScannerDialog
        onClose={() => setScannerOpen(false)} onScan={redeemScannedCoupon} />}
    </div>
    </WorkspaceLocale.Provider>
  );
}
