import {
  getCurrentSession,
  getInternalSignupInvite,
  onAuthStateChange,
  redeemInternalSignupInvite,
  signInUser,
  signUpUser,
} from "./api.js";

const state = {
  inviteToken: null,
  inviteDetails: null,
  redeeming: false,
};

function setMessage(message = "", kind = "") {
  const target = document.getElementById("inviteMessage");
  if (!target) return;
  target.className = `auth-message${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function setStatusText(text = "") {
  const target = document.getElementById("inviteStatus");
  if (!target) return;
  target.textContent = text;
}

function setInviteLockedState(isLocked) {
  document.getElementById("inviteShell")?.classList.toggle("hide", isLocked);
  document.getElementById("inviteErrorCard")?.classList.toggle("show", isLocked);
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function populateInviteDetails(invite) {
  const email = invite?.invited_email || "";
  const fullName = invite?.invited_full_name || "";
  const role = invite?.portal_role || "internal";

  const invitedEmail = document.getElementById("invitedEmail");
  const invitedRole = document.getElementById("invitedRole");
  const invitedExpires = document.getElementById("invitedExpires");
  if (invitedEmail) invitedEmail.textContent = email || "Unknown";
  if (invitedRole) invitedRole.textContent = role;
  if (invitedExpires) invitedExpires.textContent = formatDateTime(invite?.expires_at);

  const signupEmail = document.getElementById("signupEmail");
  const loginEmail = document.getElementById("loginEmail");
  const signupFullName = document.getElementById("signupFullName");
  if (signupEmail && email) signupEmail.value = email;
  if (loginEmail && email) loginEmail.value = email;
  if (signupFullName && fullName && !signupFullName.value.trim()) signupFullName.value = fullName;
}

function getInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("invite")?.trim() || null;
}

async function validateInviteToken() {
  state.inviteToken = getInviteTokenFromUrl();
  if (!state.inviteToken) {
    setInviteLockedState(true);
    setStatusText("Missing invite token.");
    setMessage("This invite link is missing the token.", "error");
    return false;
  }

  try {
    const invite = await getInternalSignupInvite(state.inviteToken);
    if (!invite || invite.status !== "ok") {
      setInviteLockedState(true);
      setStatusText("Invite is not valid.");
      setMessage("This invite link is invalid or already used.", "error");
      return false;
    }

    state.inviteDetails = invite;
    populateInviteDetails(invite);
    setInviteLockedState(false);
    setStatusText("Invite verified.");
    return true;
  } catch (error) {
    setInviteLockedState(true);
    setStatusText("Invite validation failed.");
    setMessage(error.message, "error");
    return false;
  }
}

async function tryRedeemInvite(fullNameFallback = null) {
  if (!state.inviteToken || state.redeeming) return false;

  const session = await getCurrentSession();
  if (!session) return false;

  state.redeeming = true;
  try {
    const fullName =
      fullNameFallback ||
      document.getElementById("signupFullName")?.value?.trim() ||
      state.inviteDetails?.invited_full_name ||
      null;

    await redeemInternalSignupInvite({
      inviteToken: state.inviteToken,
      fullName,
    });
    setMessage("Internal access granted. Redirecting to internal portal...", "success");
    setTimeout(() => {
      window.location.href = "/internal.html";
    }, 900);
    return true;
  } catch (error) {
    setMessage(error.message, "error");
    return false;
  } finally {
    state.redeeming = false;
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("signupSubmit");
  const fullName = document.getElementById("signupFullName")?.value?.trim();
  const email = document.getElementById("signupEmail")?.value?.trim();
  const password = document.getElementById("signupPassword")?.value || "";

  if (!fullName || !email || !password) {
    setMessage("Full name, email, and password are required.", "error");
    return;
  }

  try {
    setMessage("");
    if (submitBtn) submitBtn.disabled = true;
    const result = await signUpUser({ email, password, fullName });
    if (!result.session) {
      setMessage(
        "Account created. Verify your email, then return to this invite link and log in.",
        "success"
      );
      return;
    }
    await tryRedeemInvite(fullName);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("loginSubmit");
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value || "";

  try {
    setMessage("");
    if (submitBtn) submitBtn.disabled = true;
    await signInUser({ email, password });
    await tryRedeemInvite();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function bindHandlers() {
  document.getElementById("signupForm")?.addEventListener("submit", handleSignupSubmit);
  document.getElementById("loginForm")?.addEventListener("submit", handleLoginSubmit);
}

async function initialize() {
  bindHandlers();

  const hasValidInvite = await validateInviteToken();
  if (!hasValidInvite) return;

  const session = await getCurrentSession();
  if (session) {
    await tryRedeemInvite();
  }

  onAuthStateChange(async (_event, nextSession) => {
    if (!nextSession) return;
    await tryRedeemInvite();
  });
}

document.addEventListener("DOMContentLoaded", initialize);
