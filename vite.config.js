import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const ACCESS_COOKIE_KEY = "p11_access_token";
const INTERNAL_DOC_ROUTES = new Set([
  "/p11-onboarding-automation-flow.html",
  "/p11-onboarding-project-brief.html",
]);

function parseCookieHeader(rawCookie = "") {
  return rawCookie
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex < 0) return acc;
      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      try {
        acc[key] = decodeURIComponent(value);
      } catch (_error) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function createRouteGuardMiddleware({ supabaseUrl, supabaseAnonKey }) {
  const cache = new Map();

  async function isInternalAccessToken(accessToken) {
    if (!supabaseUrl || !supabaseAnonKey || !accessToken) return false;
    const now = Date.now();
    const cached = cache.get(accessToken);
    if (cached && cached.expiresAt > now) return cached.isInternal;

    try {
      const response = await fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/get_internal_portal_context`,
        {
          method: "POST",
          headers: {
            apikey: supabaseAnonKey,
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        }
      );
      if (!response.ok) {
        cache.set(accessToken, { isInternal: false, expiresAt: now + 30000 });
        return false;
      }
      const payload = await response.json();
      const isInternal = Boolean(payload);
      cache.set(accessToken, { isInternal, expiresAt: now + 30000 });
      return isInternal;
    } catch (_error) {
      cache.set(accessToken, { isInternal: false, expiresAt: now + 30000 });
      return false;
    }
  }

  function redirect(res, location) {
    res.statusCode = 302;
    res.setHeader("Location", location);
    res.end();
  }

  return async function routeGuard(req, res, next) {
    const rawPath = (req.url || "").split("?")[0] || "/";
    const pathname = rawPath === "" ? "/" : rawPath;
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const cookieMap = parseCookieHeader(req.headers.cookie || "");
    const accessToken = cookieMap[ACCESS_COOKIE_KEY] || "";

    if (pathname === "/" || pathname === "/index.html") {
      if (!accessToken) {
        redirect(res, "/client-home.html");
        return;
      }
      const isInternal = await isInternalAccessToken(accessToken);
      redirect(res, isInternal ? "/internal.html" : "/client-home.html");
      return;
    }

    if (pathname === "/internal.html") {
      if (!accessToken) {
        next();
        return;
      }
      const isInternal = await isInternalAccessToken(accessToken);
      if (!isInternal) {
        redirect(res, "/client-home.html");
        return;
      }
      next();
      return;
    }

    if (pathname === "/client-home.html") {
      if (!accessToken) {
        next();
        return;
      }
      const isInternal = await isInternalAccessToken(accessToken);
      if (isInternal) {
        redirect(res, "/internal.html");
        return;
      }
      next();
      return;
    }

    if (INTERNAL_DOC_ROUTES.has(pathname)) {
      if (!accessToken) {
        redirect(res, "/client-home.html");
        return;
      }
      const isInternal = await isInternalAccessToken(accessToken);
      if (!isInternal) {
        redirect(res, "/client-home.html");
        return;
      }
      next();
      return;
    }

    next();
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const routeGuard = createRouteGuardMiddleware({
    supabaseUrl: env.VITE_SUPABASE_URL || "",
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || "",
  });

  const guardedPlugin = {
    name: "p11-route-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        routeGuard(req, res, next).catch(() => next());
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        routeGuard(req, res, next).catch(() => next());
      });
    },
  };

  return {
    plugins: [guardedPlugin],
    server: {
      host: "localhost",
      port: 3000,
      strictPort: true,
    },
    preview: {
      host: "localhost",
      port: 3000,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: {
          home: path.resolve(rootDir, "index.html"),
          dashboard: path.resolve(rootDir, "p11-onboarding-dashboard.html"),
          accountAccess: path.resolve(rootDir, "p11-onboarding-account-access.html"),
          clientHome: path.resolve(rootDir, "client-home.html"),
          internal: path.resolve(rootDir, "internal.html"),
          internalSignup: path.resolve(rootDir, "internal-signup.html"),
          automationFlow: path.resolve(rootDir, "p11-onboarding-automation-flow.html"),
          projectBrief: path.resolve(rootDir, "p11-onboarding-project-brief.html"),
        },
      },
    },
  };
});
