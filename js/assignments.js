// Manager assignment helpers. The database function assign_feedback() is the only way to
// assign; it re-checks that the caller is an active manager and the target an active employee.
import { sb } from "./supabase-client.js";

/** Active employees with their number of open (not Resolved) cases. */
export async function loadAssignableEmployees() {
  const { data, error } = await sb.rpc("list_assignable_employees");
  if (error) return { ok: false, rows: [] };
  return { ok: true, rows: (data || []).map((e) => ({ id: e.id, name: `${e.first_name || ""} ${e.last_name || ""}`.trim(), open: Number(e.open_cases) || 0 })) };
}

function mapError(error) {
  const m = error?.message || "";
  if (/already assigned/i.test(m)) return "This case is already assigned to that employee.";
  if (/Resolved feedback/i.test(m)) return "Resolved cases cannot be assigned.";
  if (/active employee/i.test(m)) return "Choose an active employee.";
  if (/too long/i.test(m)) return "The note is too long (500 characters at most).";
  if (/Only managers|not allowed|permission/i.test(m)) return "Only managers can assign feedback.";
  if (/not found/i.test(m)) return "That feedback no longer exists.";
  return "We could not assign this case. Please try again.";
}

export async function assignFeedback(feedbackId, employeeId, note) {
  const { error } = await sb.rpc("assign_feedback", { p_feedback_id: feedbackId, p_employee_id: employeeId, p_note: (note || "").trim() || null });
  return error ? { ok: false, message: mapError(error) } : { ok: true };
}

// ---------------------------------------------------------------------------
// Employee side: only cases currently assigned to the signed-in employee come back (RLS).
// ---------------------------------------------------------------------------
const ORDER = { Pending: 0, "In Progress": 1, Resolved: 2 };

export async function listAssignedToMe() {
  const { data, error } = await sb
    .from("feedback")
    .select("id, reference_number, feedback_type, subject, status, created_at, customer_id, service_rating")
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return { ok: false, rows: [] };
  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.customer_id))];
  const names = {};
  if (ids.length) {
    const { data: people } = await sb.from("profiles").select("id, first_name, last_name").in("id", ids);
    for (const p of people || []) names[p.id] = `${p.first_name || ""} ${p.last_name || ""}`.trim();
  }
  rows.forEach((r) => { r.customer_name = names[r.customer_id] || "Customer"; });
  // Cases that need action first (Pending, then In Progress), oldest first inside each group.
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || new Date(a.created_at) - new Date(b.created_at));
  return { ok: true, rows };
}
