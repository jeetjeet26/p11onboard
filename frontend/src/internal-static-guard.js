import { getCurrentSession, getInternalPortalContext, signOutUser } from "./api.js";
import { setRedirectNotice } from "./navigation.js";

function bindInternalLogout() {
  document.querySelectorAll(".internal-logout").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      try {
        await signOutUser();
      } finally {
        window.location.replace("/internal.html");
      }
    });
  });
}

async function guardInternalPage() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      setRedirectNotice("Please log in with an internal account to view that page.");
      window.location.replace("/internal.html");
      return;
    }

    const context = await getInternalPortalContext();
    if (!context) {
      setRedirectNotice("That page is for internal users. You have been sent to your client home.");
      window.location.replace("/client-home.html");
      return;
    }

    document.body.classList.remove("auth-gate-pending");
    bindInternalLogout();
  } catch (_error) {
    setRedirectNotice("We could not verify internal access. Please log in again.");
    window.location.replace("/client-home.html");
  }
}

document.addEventListener("DOMContentLoaded", guardInternalPage);
