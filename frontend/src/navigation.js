const REDIRECT_NOTICE_KEY = "p11_portal_redirect_notice";

export function isInternalContext(context = null) {
  return ["internal", "admin"].includes(context?.portal_role || "");
}

export function setRedirectNotice(message) {
  if (!message) return;
  try {
    sessionStorage.setItem(REDIRECT_NOTICE_KEY, message);
  } catch (_error) {
    // Non-fatal: navigation should continue even when storage is unavailable.
  }
}

export function consumeRedirectNotice() {
  try {
    const message = sessionStorage.getItem(REDIRECT_NOTICE_KEY) || "";
    if (message) sessionStorage.removeItem(REDIRECT_NOTICE_KEY);
    return message;
  } catch (_error) {
    return "";
  }
}

export function renderNotice(message, { tone = "info", after = "header" } = {}) {
  if (!message) return;
  const anchor = document.querySelector(after) || document.body.firstElementChild;
  if (!anchor) return;

  let notice = document.getElementById("portalNotice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "portalNotice";
    notice.className = "portal-notice";
    anchor.insertAdjacentElement("afterend", notice);
  }
  notice.className = `portal-notice ${tone}`;
  notice.textContent = message;
}

export function applyRoleChrome(context = null, options = {}) {
  const isInternal = isInternalContext(context);
  document.body.classList.toggle("internal-user", isInternal);

  const homeLink = options.homeLinkId
    ? document.getElementById(options.homeLinkId)
    : document.querySelector(".home-link");
  if (homeLink) {
    homeLink.setAttribute("href", isInternal ? "/internal.html" : "/client-home.html");
    homeLink.classList.toggle("internal-home-link-active", isInternal);
  }

  let banner = document.getElementById("internalViewingBanner");
  if (!isInternal) {
    banner?.remove();
    return isInternal;
  }

  const text =
    options.internalBannerText ||
    "Internal view: you are viewing this client onboarding flow with staff access.";
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "internalViewingBanner";
    banner.className = "role-viewing-banner";
    const anchor = document.querySelector(".client-bar") || document.querySelector("header");
    anchor?.insertAdjacentElement("afterend", banner);
  }
  if (banner) banner.textContent = text;
  return isInternal;
}
