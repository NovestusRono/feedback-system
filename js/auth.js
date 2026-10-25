// Authentication and page guards. Guards here are a usability layer: a user who
// bypasses them still cannot read or change anything the database does not allow.
import { sb } from "./supabase-client.js";
import { ROLE_HOME, STAFF_ROLES } from "./permissions.js";

// Site root, computed from this file's location so it works under any GitHub Pages base path.
export const ROOT = new URL("../", import.meta.url).href;
export const url = (p) => new URL(p, ROOT).href;

const LOGIN = { customer: "customer/login.html", staff: "staff/login.html" };

const MESSAGES = {
  invalid: "Incorrect email or password.",
  banned: "This account has been deactivated. Contact an administrator.",
  unconfirmed: "Please confirm your email address first. Check your inbox.",
  rate: "Too many attempts. Please wait a minute and try again.",
  generic: "Something went wrong. Please try again.",
};

function mapAuthError(error) {
  const m = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if (m.includes("invalid_credentials") || m.includes("invalid login")) return MESSAGES.invalid;
  if (m.includes("banned")) return MESSAGES.banned;
  if (m.includes("email_not_confirmed") || m.includes("not confirmed")) return MESSAGES.unconfirmed;
  if (m.includes("rate") || error?.status === 429) return MESSAGES.rate;
  return MESSAGES.generic;
}

/** Current user's profile (RLS lets everyone read their own row) or null. */
export async function getProfile() {
  const { data: { session } = {} } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("id, first_name, last_name, email, phone, role, account_status")
    .eq("id", session.user.id)
    .maybeSingle();
  return error || !data ? null : data;
}

/** Only same-site relative .html paths are accepted as a post-login destination. */
export function safeNext(raw) {
  if (!raw || typeof raw !== "string") return null;
  if (!/^[A-Za-z0-9_\-\/]+\.html$/.test(raw) || raw.includes("//") || raw.startsWith("/")) return null;
  const u = new URL(raw, ROOT);
  return u.href.startsWith(ROOT) ? raw : null;
}

/**
 * Sign in through a portal. portal = "customer" | "staff".
 * Wrong-portal and deactivated accounts are signed straight back out.
 */
export async function signIn(email, password, portal) {
  const { error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) return { ok: false, message: mapAuthError(error) };

  const profile = await getProfile();
  if (!profile) {
    await sb.auth.signOut();
    return { ok: false, message: "Your account is not set up correctly. Contact an administrator." };
  }
  if (profile.account_status !== "active") {
    await sb.auth.signOut();
    return { ok: false, message: MESSAGES.banned };
  }
  if (portal === "customer" && profile.role !== "customer") {
    await sb.auth.signOut();
    return { ok: false, message: "Staff accounts must sign in through the staff portal." };
  }
  if (portal === "staff" && !STAFF_ROLES.includes(profile.role)) {
    await sb.auth.signOut();
    return { ok: false, message: "Customers sign in through the customer portal." };
  }
  return { ok: true, profile };
}

/** Customer self-registration. The database always creates a role of "customer". */
export async function signUpCustomer({ firstName, lastName, email, phone, password }) {
  const { data, error } = await sb.auth.signUp({
    email: String(email).trim(),
    password,
    options: {
      data: { first_name: firstName.trim(), last_name: lastName.trim(), phone: (phone || "").trim() },
      emailRedirectTo: url(LOGIN.customer),
    },
  });
  if (error) {
    const m = `${error.code || ""} ${error.message || ""}`.toLowerCase();
    if (m.includes("weak") || m.includes("password")) return { ok: false, message: "That password is too weak. Use a longer, less common password." };
    if (m.includes("rate") || error.status === 429) return { ok: false, message: MESSAGES.rate };
    return { ok: false, message: "We could not create your account. If you already registered, sign in instead." };
  }
  // With email confirmation on, there is no session yet. An empty identities list means the
  // address is already registered; we show the same neutral message either way.
  return { ok: true, needsConfirmation: !data.session };
}

export async function requestPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: url("reset-password.html") });
  // Never reveal whether the address exists. Only surface rate limiting.
  if (error && (error.status === 429 || /rate/i.test(error.message || ""))) return { ok: false, message: MESSAGES.rate };
  return { ok: true };
}

export async function signOutAndGo(to = "index.html") {
  try { await sb.auth.signOut(); } catch (_) { /* ignore: leaving anyway */ }
  location.replace(url(to));
}

/**
 * Guard for protected pages. Resolves to the profile when the signed-in, active user has
 * one of the allowed roles; otherwise redirects (and never resolves with a profile).
 */
export async function requireRole(allowed) {
  const profile = await getProfile();
  const portal = allowed.length === 1 && allowed[0] === "customer" ? "customer" : "staff";

  if (!profile || profile.account_status !== "active") {
    if (profile) await sb.auth.signOut();
    const here = location.href.startsWith(ROOT) ? location.href.slice(ROOT.length).split(/[?#]/)[0] : "";
    const next = safeNext(here);
    location.replace(url(LOGIN[portal] + (next ? `?next=${encodeURIComponent(next)}` : "")));
    return new Promise(() => {});
  }
  if (!allowed.includes(profile.role)) {
    const home = ROLE_HOME[profile.role];
    if (home) location.replace(url(home)); else await signOutAndGo("index.html");
    return new Promise(() => {});
  }

  // If the session ends elsewhere (sign-out in another tab, expiry), leave the page.
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.replace(url(LOGIN[portal]));
  });
  document.body.classList.remove("guard-pending");
  return profile;
}

/** For login/register pages: send already signed-in users to their own dashboard. */
export async function redirectIfSignedIn() {
  const profile = await getProfile();
  if (profile && profile.account_status === "active" && ROLE_HOME[profile.role]) {
    location.replace(url(ROLE_HOME[profile.role]));
    return new Promise(() => {});
  }
  return null;
}
