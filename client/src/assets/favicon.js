// Follow the browser/system theme, not the dashboard's independent theme switch.
// Some browsers cache an SVG favicon's rasterization across preference changes.
// Swapping fixed-color assets gives them a new icon to load without a page refresh.
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
let appliedTheme;

function syncFavicon() {
  const theme = colorScheme.matches ? "dark" : "light";
  if (theme === appliedTheme) return;

  const current = document.getElementById("app-favicon");
  const variant = document.querySelector(`link[data-favicon-theme="${theme}"]`);
  if (!current || !variant) return;

  const next = variant.cloneNode();
  next.id = "app-favicon";
  next.removeAttribute("data-favicon-theme");
  // Retain the media condition: the native light/dark links can still be selected
  // while this tab is in the background and script execution is suspended.
  current.replaceWith(next);
  appliedTheme = theme;
}

// Do not gate theme updates on document visibility or requestAnimationFrame.
// Check again on restore in case the browser froze this tab and deferred events.
colorScheme.addEventListener("change", syncFavicon);
window.addEventListener("pageshow", syncFavicon);
window.addEventListener("focus", syncFavicon);
document.addEventListener("visibilitychange", syncFavicon);
document.addEventListener("resume", syncFavicon);
syncFavicon();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    colorScheme.removeEventListener("change", syncFavicon);
    window.removeEventListener("pageshow", syncFavicon);
    window.removeEventListener("focus", syncFavicon);
    document.removeEventListener("visibilitychange", syncFavicon);
    document.removeEventListener("resume", syncFavicon);
  });
}
