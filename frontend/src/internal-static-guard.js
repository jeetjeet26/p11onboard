import { getCurrentSession, getInternalPortalContext } from "./api.js";

async function guardInternalPage() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      window.location.replace("/internal.html");
      return;
    }

    const context = await getInternalPortalContext();
    if (!context) {
      window.location.replace("/client-home.html");
      return;
    }

    document.body.classList.remove("auth-gate-pending");
  } catch (_error) {
    window.location.replace("/client-home.html");
  }
}

document.addEventListener("DOMContentLoaded", guardInternalPage);
