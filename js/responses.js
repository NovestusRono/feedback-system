// Employee actions on an assigned case. The database functions re-check that the case is
// assigned to the caller and that the status allows the action.
import { sb } from "./supabase-client.js";

export async function loadMinResolutionLength() {
  try {
    const { data } = await sb.from("system_settings").select("key, value").in("key", ["min_resolution_details_length"]);
    const v = Number((data || []).find((r) => r.key === "min_resolution_details_length")?.value);
    return Number.isInteger(v) && v >= 1 ? v : 10;
  } catch (_) { return 10; }
}

function mapError(error) {
  const m = error?.message || "";
  if (/assigned to you/i.test(m)) return "This case is not assigned to you (it may have been reassigned). Refresh the page.";
  if (/Only Pending/i.test(m)) return "This case has already been started.";
  if (/already resolved/i.test(m)) return "This case is already resolved.";
  if (/Start the case/i.test(m)) return "Start the case before resolving it.";
  if (/resolution details/i.test(m)) return m.replace(/\.$/, "") + ".";
  if (/Enter a message/i.test(m)) return "Enter a message of up to 4000 characters.";
  if (/too long/i.test(m)) return "That text is too long.";
  return "We could not save that. Please try again.";
}

export async function startCase(feedbackId, note) {
  const { error } = await sb.rpc("start_feedback", { p_feedback_id: feedbackId, p_note: (note || "").trim() || null });
  return error ? { ok: false, message: mapError(error) } : { ok: true };
}

export async function addResponse(feedbackId, text, visibility) {
  const { error } = await sb.rpc("add_feedback_response", { p_feedback_id: feedbackId, p_text: text, p_visibility: visibility });
  return error ? { ok: false, message: mapError(error) } : { ok: true };
}

export async function resolveCase(feedbackId, { details, customerResponse, internalNote }) {
  const { error } = await sb.rpc("resolve_feedback", {
    p_feedback_id: feedbackId, p_resolution_details: details,
    p_customer_response: (customerResponse || "").trim() || null, p_internal_note: (internalNote || "").trim() || null,
  });
  return error ? { ok: false, message: mapError(error) } : { ok: true };
}
