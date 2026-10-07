import React, { useCallback, useEffect, useRef, useState } from "react";
import "./portal.css";
import "./portal-theme.css";
import { WorkspaceLocale, useWorkspaceText, workspaceTranslator } from "./workspace-i18n.js";
import { summarizeCampaigns } from "./campaigns.js";
import { scratchCardUrl } from "../../shared/urls.js";
import { EMPTY_COUPON_FILTERS, couponBranchKey, couponCampaignKey, couponDateBounds, filterCouponCards } from "./coupon-filters.js";

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

export async function portalApi(url, token, method = "GET", body) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const content = await response.text();
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error(
      "The Scratch-card API did not respond. Restart npm run dev and open the URL printed in the terminal.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 && token)
      window.dispatchEvent(new Event("scratch:expired"));
    throw Object.assign(new Error(result.message || "Unable to complete request."), { status: response.status, savedCount: result.savedCount });
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
  {
    key: "accountLimit",
    label: "Business account limit",
    type: "number",
    required: true,
  },
];
const businessPayload = (values) => ({
  name: values.name,
  website: values.website,
  status: values.status,
  limits: {
    card: Number(values.cardLimit),
    branch: Number(values.branchLimit),
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
    platformName: "Lucky Drop",
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
            Create memorable rewards, manage every branch, and see how your
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
            <span>Scratch cards • Branches • Insights</span>
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
    [error, setError] = useState("");
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
        <div className="p-editor-fields">
          {editor.fields.map((field) => (
            <label key={field.key}>
              {ui(field.label)}
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
                      {field.key === "status" || field.key === "role" ? ui(option.label) : option.label}
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
              ) : (
                <input
                  type={field.type || "text"}
                  min={field.type === "number" ? 0 : undefined}
                  minLength={
                    field.type === "password" && field.key !== "currentPassword"
                      ? 10
                      : undefined
                  }
                  maxLength={field.type === "password" ? 200 : undefined}
                  autoComplete={
                    field.type === "password" ? "new-password" : undefined
                  }
                  required={field.required}
                  readOnly={field.readOnly}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                />
              )}
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
          "--page-color": card.pageColor || "#0b0c1c",
          "--text-color": card.textColor || "#ffffff",
          "--accent": card.accentColor || "#ffb33f",
        }}
      >
        <div className="p-preview-brand">✦ {card.senderName}</div>
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
  Creator,
  ScratchCard,
  cardTranslator,
  language: businessLanguage,
  setLanguage,
}) {
  const platformAdmin = session.user.role === "super-admin";
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
  const ui = workspaceTranslator(language);
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
    [couponFilters, setCouponFilters] = useState(() => ({ ...EMPTY_COUPON_FILTERS })),
    [editor, setEditor] = useState(null),
    [credentials, setCredentials] = useState(null),
    [previewCard, setPreviewCard] = useState(null),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false);
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
  const business = businesses.find((item) => item.businessId === workspaceId);
  useEffect(() => {
    setCouponFilters({ ...EMPTY_COUPON_FILTERS });
    setBusinessFilter("");
  }, [tab, workspaceId]);
  const admin = ["super-admin", "business", "admin"].includes(
    session.user.role,
  );
  const canCreate = session.user.role !== "viewer";
  const nav = global
    ? [
        ["Overview", "overview"],
        ["Businesses", "business"],
        ["Campaigns", "campaign"],
        ["Scratch cards", "cards"],
        ["Branches", "branches"],
        ["Business accounts", "team"],
        ["Super admins", "security"],
        ["Analytics", "analytics"],
        ["Security", "security"],
        ["Audit", "audit"],
        ["Platform settings", "settings"],
      ]
    : [
        ["Overview", "overview"],
        ...(canCreate ? [["Create scratch card", "plus"]] : []),
        ["Campaigns", "campaign"],
        ["Coupons", "cards"],
        ["Branches", "branches"],
      ];
  useEffect(() => {
    if (!nav.some(([name]) => name === tab)) setTab("Overview");
  }, [global, canCreate, tab]);
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
          global
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
    [api, scoped, global],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!["Overview", "Coupons", "Scratch cards", "Campaigns", "Analytics"].includes(tab)) return;
    let stopped = false, pending = false;
    const updateActivity = async () => {
      if (stopped || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await api(scoped("/api/portal/cards"));
        if (!stopped) setCards(result.cards);
      } catch (err) {
        if (!stopped) setError(err.message);
      } finally {
        pending = false;
      }
    };
    updateActivity();
    const interval = window.setInterval(updateActivity, 10000);
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
  const saved = async (values) => {
    const savedEditor = editor;
    const result = await savedEditor.save(values);
    setEditor(null);
    if (result?.credentials) setCredentials({ ...result.credentials, name: result.business?.name || result.user?.name });
    setNotice(savedEditor.successMessage || "Changes saved successfully.");
    savedEditor.onSaved?.(result);
    await refresh(savedEditor.quietRefresh === true);
  };
  const match = (value) =>
    `${JSON.stringify(value)} ${ui(value.status || "")} ${value.defaultName || ("campaignName" in value && !value.campaignName) ? ui("General rewards") : ""}`
      .toLowerCase().includes(search.toLowerCase());
  const couponSection = ["Coupons", "Scratch cards"].includes(tab);
  const inSelectedBusiness = (item) => !global || !businessFilter || item.businessId === businessFilter;
  const managedCards = cards.filter(inSelectedBusiness);
  const visibleCards = filterCouponCards(managedCards.filter(
    (item) => match(item) && (status === "all" || item.status === status),
  ), couponSection ? couponFilters : EMPTY_COUPON_FILTERS);
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
        businessId: item.businessId,
        businessName: item.name,
      })),
    );
  const options = businesses.map((item) => ({
    value: item.businessId,
    label: item.name,
  }));
  const visibleBranches = branches.filter((branch) => inSelectedBusiness(branch) && match(branch));
  const couponBranchOptions = new Map(branches.filter(inSelectedBusiness).map((branch) => [couponBranchKey(branch), {
    key: couponBranchKey(branch),
    name: global ? `${branch.businessName} · ${branch.name}` : branch.name,
  }]));
  // Retain options for older cards whose assigned branch no longer appears in management.
  for (const card of managedCards) {
    if (!card.branchId || couponBranchOptions.has(couponBranchKey(card))) continue;
    const name = card.branchName || card.branchId;
    couponBranchOptions.set(couponBranchKey(card), {
      key: couponBranchKey(card), name: global ? `${card.senderName} · ${name}` : name,
    });
  }
  const couponCampaignOptions = [...new Map(managedCards.map((card) => [couponCampaignKey(card.campaignName), {
    key: couponCampaignKey(card.campaignName), name: card.campaignName || ui("General rewards"),
  }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const businessSelect = {
    key: "businessId",
    label: "Business",
    type: "select",
    required: true,
    options,
  };
  const createBusiness = () =>
    setEditor({
      title: "Create business workspace",
      wide: true,
      fields: [...businessFields, ...businessLimitFields],
      description:
        "Choose the total scratch cards, branches and login accounts allowed for this business. The account limit includes the owner login. Use 0 for unlimited. A random login ID and password will be generated automatically and shown after creation.",
      values: {
        cardLimit: config?.defaultLimits?.card ?? 100,
        branchLimit: config?.defaultLimits?.branch ?? 2,
        accountLimit: config?.defaultLimits?.account ?? 1,
      },
      save: (values) =>
        api("/api/portal/businesses", "POST", { ...businessPayload(values), generateCredentials: true }),
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
        "Limits apply to this business only. The account limit includes its owner. Use 0 for unlimited. Lowering a limit keeps existing records and prevents additional creation when the limit is reached.",
      fields: [
        businessFields[0],
        businessFields[1],
        { key: "loginId", label: "Owner login ID", readOnly: true },
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
        loginId: item.loginId || item.loginEmail,
        cardLimit: item.limits.card,
        branchLimit: item.limits.branch,
        accountLimit: item.limits.account,
      },
      save: (values) =>
        api(
          `/api/portal/businesses/${item.businessId}`,
          "PATCH",
          businessPayload(values),
        ),
    });
  const createBranch = (inline = false, onSaved) =>
    setEditor({
      title: "Add branch",
      fields: [...(global ? [businessSelect] : []), ...branchFields],
      values: { businessId: workspaceId },
      quietRefresh: inline === true,
      onSaved: typeof onSaved === "function" ? onSaved : undefined,
      save: async (values) => {
        const result = await api(
          `/api/portal/businesses/${values.businessId}/branches`,
          "POST",
          values,
        );
        // The response confirms persistence. Update this workspace without
        // unmounting its draft form, even if a later background refresh fails.
        if (inline === true && result.branch) setBusinesses((current) => current.map((item) =>
          item.businessId === values.businessId ? { ...item, branches: [
            ...(item.branches || []).filter((branch) => branch.branchId !== result.branch.branchId), result.branch,
          ] } : item));
        return result;
      },
    });
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
      ],
      values: { businessId: workspaceId, role: "editor" },
      description: "A random login ID and password will be generated automatically and shown after creation.",
      save: (values) => api("/api/portal/users", "POST", { ...values, generateCredentials: true }),
    });
  const createSuperAdmin = () => setEditor({
    title: "Create super-admin account",
    fields: [{ key: "name", label: "Full name", required: true }],
    description: "This account will have full platform access. A random login ID and password will be generated and shown after creation.",
    save: (values) => api("/api/portal/super-admins", "POST", values),
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
  const exportCards = async () => {
    setBusy(true);
    setError("");
    try {
      const { default: write } = await import("write-excel-file/universal");
      const labels = [...t("excelHeaders"), ui("Expiry date"), ui("WhatsApp number")],
        rows = visibleCards.map((item) =>
          [
            item.couponCode,
            item.offerTitle,
            item.senderName,
            item.used
              ? t("used")
              : item.status === "available"
                ? t("waiting")
                : {
                    hi: { expired: "समाप्त", disabled: "निष्क्रिय" },
                    te: {
                      expired: "గడువు ముగిసింది",
                      disabled: "నిలిపివేయబడింది",
                    },
                  }[language]?.[item.status] || item.status,
            item.createdAt
              ? new Date(item.createdAt).toLocaleString(`${language}-IN`)
              : "—",
            item.redeemedAt
              ? new Date(item.redeemedAt).toLocaleString(`${language}-IN`)
              : "—",
            scratchCardUrl(item.slug),
            item.expiresAt ? localizedDate(item.expiresAt) : ui("No expiry"),
            item.customerPhone || "—",
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
  const used = cards.filter((item) => item.used).length,
    available = cards.filter((item) => item.status === "available").length;
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
      const labels = ["Branch", ...(global ? ["Business"] : []), "Scratch cards", "Redeemed", "Conversion", "Address", "Access"].map((label) => ui(label));
      const rows = visibleBranches.map((branch) => {
        const activity = branchActivity(branch);
        return [
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
      link.download = `branches-${language}-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
      caption: "Ready to be scratched",
      icon: "cards",
    },
    {
      title: "Redeemed coupons",
      value: used,
      caption: "One-time rewards unlocked",
      icon: "security",
    },
    {
      title: "Redemption rate",
      value: `${cards.length ? Math.round((used / cards.length) * 100) : 0}%`,
      caption: ui("{used} of {total} scratch cards", { used, total: cards.length }),
      icon: "analytics",
    },
  ];
  const cardsTable = (rows, showPhone = false) => (
    <Table
      columns={[
        "Reward & coupon",
        ...(showPhone ? ["WhatsApp number"] : []),
        ...(global ? ["Business", "Branch"] : ["Branch"]),
        "Campaign",
        "Status",
        "Created",
        ...(showPhone ? ["Expiry date"] : []),
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
          <td>
            {global
              ? businesses.find((value) => value.businessId === item.businessId)
                  ?.name || item.senderName
              : branches.find((value) => value.branchId === item.branchId)
                  ?.name || ui("All branches")}
          </td>
          {global && <td>{branches.find((value) =>
            value.businessId === item.businessId && value.branchId === item.branchId)
              ?.name || item.branchName || ui("All branches")}</td>}
          <td>{item.campaignName || ui("General rewards")}</td>
          <td>
            <Badge status={item.status} />
          </td>
          <td>{localizedDate(item.createdAt)}</td>
          {showPhone && <td>{item.expiresAt ? localizedDate(item.expiresAt) : ui("No expiry")}</td>}
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
              {canCreate && !item.used && (
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
  const overview = (
    <>
      <div className="p-welcome-row">
        <div>
          <span className="p-eyebrow">
            {ui(global ? "PLATFORM OVERVIEW" : "BUSINESS OVERVIEW")}
          </span>
          <h1>
            {global
              ? "Your rewards platform, at a glance."
              : ui("{name} workspace", { name: business?.name || session.user.name })}
          </h1>
          <p>{ui("Manage rewards, monitor activity, and keep your team in sync.")}</p>
        </div>
        <button
          className="p-button primary"
          onClick={
            global ? createBusiness : () => navigate("Create scratch card")
          }
          disabled={!global && !canCreate}
        >
          <Icon name="plus" />
          {ui(global ? "New business" : "Create scratch card")}
        </button>
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
                  item.redeemedAt &&
                  new Date(item.redeemedAt).toDateString() ===
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
            <button onClick={() => navigate("Branches")}>{ui("View")}</button>
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
            <button onClick={() => navigate("Campaigns")}>{ui("View")}</button>
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
    if (tab === "Overview") return overview;
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
            onCreateBranch={admin ? (onSaved) => createBranch(true, onSaved) : undefined}
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
          </div>
          <Table
            columns={[
              "Business",
              "Owner login ID",
              "Business limits",
              "Branches",
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
                  <small>{item.limits.branch || "Unlimited"} branches</small>
                  <small>
                    {item.limits.account || "Unlimited"} business accounts
                  </small>
                </td>
                <td>{item.branches?.length || 0}</td>
                <td>
                  <Badge status={item.status} />
                </td>
                <td>
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
                    <button onClick={() => openWorkspace(item.businessId)}>
                      Open workspace <Icon name="arrow" size={14} />
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
      const rows = visibleBranches;
      return (
        <article className="p-card">
          {global && <div className="p-info">
            Platform control shows branches across every business. Filter by business, review coupon performance, change access, or open the business workspace directly.
          </div>}
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
                      <button
                        onClick={() =>
                          setEditor({
                            title: "Edit branch",
                            fields: branchFields,
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
                      </button>
                      <button
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
                      </button>
                      {global && <button onClick={() => openWorkspace(item.businessId, "Branches")}>
                        Manage business
                      </button>}
                    </div>
                  )}
                </td>
              </tr>;
            })}
          </Table>
        </article>
      );
    }
    if (tab === "Business accounts") {
      const rows = accounts.filter(match);
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
              ? "Platform control compares campaign performance across businesses and branches. Filter by business or open its workspace for card creation and detailed management."
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
          <div className="p-metrics">
            {stats.map((item) => (
              <article key={item.title}>
                <span>{item.title}</span>
                <strong>{item.value}</strong>
                <small>{item.caption}</small>
              </article>
            ))}
          </div>
          <article className="p-card">
            <div className="p-card-title">
              <h2>Branch performance</h2>
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
                  <b>{item.action}</b>
                </td>
                <td>{item.actor}</td>
                <td>
                  {businesses.find(
                    (value) => value.businessId === item.businessId,
                  )?.name || "Platform"}
                </td>
                <td>{item.detail || "—"}</td>
                <td>{date(item.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </article>
      );
    }
    if (tab === "Security")
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
            <button
              className="p-button"
              onClick={() =>
                setEditor({
                  title: "Change your password",
                  fields: [
                    {
                      key: "currentPassword",
                      label: "Current password",
                      type: "password",
                      required: true,
                    },
                    {
                      key: "password",
                      label: "New password (10+ characters)",
                      type: "password",
                      required: true,
                    },
                  ],
                  save: (values) =>
                    api("/api/portal/security/password", "POST", values),
                })
              }
            >
              Change password
            </button>
          </article>
          {admin && (
            <article className="p-card">
              <h2>Session control</h2>
              <p>
                Force other {global ? "business and super-admin" : "workspace"} accounts to sign
                in again. Your current account remains signed in.
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
              <p>Account suspension takes effect on their next API request.</p>
            </article>
          )}
        </div>
      );
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
                {[["card", "Default scratch-card limit"], ["branch", "Default branch limit"], ["account", "Default business account limit"]].map(([key, label]) => (
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
    if (tab === "Brand settings")
      return (
        <article className="p-card p-settings">
          <h2>{business?.name} brand defaults</h2>
          <p>
            Your business name is managed by the super admin and locked on
            scratch cards.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              mutate(() =>
                api(`/api/portal/businesses/${workspaceId}`, "PATCH", {
                  website: form.get("website"),
                  brand: {
                    pageColor: form.get("pageColor"),
                    textColor: form.get("textColor"),
                    accentColor: form.get("accentColor"),
                  },
                }),
              );
            }}
          >
            <label>
              Business name
              <input value={business?.name || ""} disabled />
            </label>
            <label>
              Website
              <input
                key={business?.website}
                name="website"
                type="url"
                defaultValue={business?.website || ""}
              />
            </label>
            {[
              ["pageColor", "Page background", "#0b0c1c"],
              ["textColor", "Message text", "#ffffff"],
              ["accentColor", "Scratch card", "#ffb33f"],
            ].map(([key, label, fallback]) => (
              <label key={`${key}:${business?.brand?.[key]}`}>
                {label}
                <input
                  name={key}
                  type="color"
                  defaultValue={business?.brand?.[key] || fallback}
                />
              </label>
            ))}
            <button className="p-button primary" disabled={busy}>
              Save brand settings
            </button>
          </form>
        </article>
      );
  };
  const add =
    tab === "Businesses"
      ? createBusiness
      : tab === "Branches" && admin
        ? createBranch
        : tab === "Business accounts"
          ? createAccount
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
            {ui(global ? "Super administrator" : "Business workspace")}
          </small>
        </a>
        <div className="p-workspace-chip">
          <Icon name={global ? "security" : "business"} />
          <div>
            <b>{global ? "Platform control" : business?.name || ui("Workspace")}</b>
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
              className={tab === name ? "active" : ""}
              onClick={() => navigate(name)}
            >
              <Icon name={icon} />
              <span>{ui(name)}</span>
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
                : session.user.role)}
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
              <b>{ui(tab)}</b>
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
                <h1>{ui(tab)}</h1>
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
              {add && (
                <button className="p-button primary" onClick={add}>
                  <Icon name="plus" />
                  {ui(tab === "Businesses"
                    ? "Create business"
                    : tab === "Branches"
                      ? "Add branch"
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
            "Brand settings",
            "Platform settings",
          ].includes(tab) && (
            <div className="p-toolbar">
              <div className="p-search">
                <Icon name="search" />
                <input
                  placeholder={ui("Search {section}…", { section: language === "en" ? tab.toLowerCase() : ui(tab) })}
                  aria-label={ui("Search {section}", { section: ui(tab) })}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div>
                {global && ["Campaigns", "Scratch cards", "Branches"].includes(tab) && (
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
                        "redeemed",
                        "disabled",
                        "expired",
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
              <div className="p-coupon-filter-fields">
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
      {editor && (
        <Editor
          key={editor.title}
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={saved}
        />
      )}
      {previewCard && (
        <CardPreviewDialog
          card={previewCard}
          ScratchCard={ScratchCard}
          t={previewCard.language ? cardTranslator(previewCard.language) : t}
          onClose={() => setPreviewCard(null)}
        />
      )}
      {credentials && <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />}
    </div>
    </WorkspaceLocale.Provider>
  );
}
