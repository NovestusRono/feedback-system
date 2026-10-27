// Anonymous feedback: no account, no login. The server stores nothing that identifies the sender
// (no IP address, no email, no account) and returns only a reference number.
import { sb } from "./supabase-client.js";
import { validateFeedback, DEFAULT_CATEGORIES } from "./feedback.js";

/** { enabled, categories }. If the lookup fails the form stays usable with no categories. */
export async function loadAnonymousOptions() {
  try {
    // A slow or unreachable backend must not leave the page on "Loading...": give up after 6 seconds.
    const { data, error } = await Promise.race([sb.rpc("anonymous_form_options"), new Promise((res) => setTimeout(() => res({ data: null, error: { message: "timeout" } }), 6000))]);
    if (error || !data) return { enabled: true, categories: DEFAULT_CATEGORIES };
    return { enabled: data.enabled !== false, categories: Array.isArray(data.categories) ? data.categories.map(String) : [] };
  } catch (_) { return { enabled: true, categories: DEFAULT_CATEGORIES }; }
}

function mapError(error) {
  const m = `${error?.message || ""}`;
  if (/switched off/i.test(m)) return "Anonymous feedback is currently unavailable.";
  if (/too many/i.test(m)) return "We are receiving a lot of anonymous feedback right now. Please try again in a little while.";
  if (/already submitted/i.test(m)) return "You already sent this feedback a moment ago.";
  if (/staff accounts/i.test(m)) return "Staff accounts cannot submit feedback.";
  if (/Subject|Description|Rating|Choose a feedback type|optional field/i.test(m)) return m;
  return "We could not submit your feedback. Please try again.";
}

/** Validation is the same as the signed-in form (response method does not apply). */
export const validateAnonymous = (f) => validateFeedback({ ...f, method: "" });

const clean = (v, max) => { const t = (v || "").trim(); return t ? t.slice(0, max) : null; };

/** Returns { ok, reference } or { ok:false, message }. `website` is a honeypot field real people leave empty. */
export async function submitAnonymous(f, website = "") {
  const { data, error } = await sb.rpc("submit_anonymous_feedback", {
    p_type: f.type, p_subject: f.subject.trim(), p_description: f.description.trim(), p_rating: Number(f.rating),
    p_category: clean(f.category, 80), p_product_name: clean(f.productName, 150), p_purchase_reference: clean(f.purchaseRef, 100),
    p_website: website || null,
  });
  if (error || typeof data !== "string") return { ok: false, message: mapError(error) };
  return { ok: true, reference: data };
}
