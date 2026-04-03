import { getCurrentSession, getInternalPortalContext } from "./api.js";

async function initialize() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      document.body.classList.remove("route-checking");
      return;
    }

    try {
      const internalContext = await getInternalPortalContext();
      if (internalContext) {
        window.location.replace("/internal.html");
        return;
      }
    } catch (_error) {
      // Non-internal users are expected to fail this RPC check.
    }

    window.location.replace("/client-home.html");
  } catch (_error) {
    document.body.classList.remove("route-checking");
  }
}

document.addEventListener("DOMContentLoaded", initialize);
