// Customer feedback submission: options, validation, insert, attachment upload.
// Client checks are for usability; the database enforces every rule again.
import { sb } from "./supabase-client.js";

export const DEFAULT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxFiles: 3, types: ["image/jpeg", "image/png", "application/pdf"] };
export const DEFAULT_CATEGORIES = [];
export const TYPES = ["complaint", "compliment", "suggestion"];
export const METHODS = ["email", "phone", "sms", "whatsapp"];
const EXT = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** Employees for "served by", categories and attachment limits. Falls back to safe defaults. */
export async function loadFormOptions() {
  const out = { employees: [], categories: DEFAULT_CATEGORIES, limits: { ...DEFAULT_LIMITS } };
  try {
    const { data } = await sb.rpc("list_servable_employees");
    if (Array.isArray(data)) out.employees = data.map((e) => ({ id: e.id, first_name: e.first_name }));
  } catch (_) { /* optional field */ }
  try {
    const { data } = await sb
      .from("system_settings")
      .select("key, value")
      .in("key", ["feedback_categories", "attachment_max_bytes", "attachment_allowed_mime_types", "attachments_max_per_feedback"]);
    for (const row of data || []) {
      if (row.key === "feedback_categories" && Array.isArray(row.value)) out.categories = row.value.map(String);
      if (row.key === "attachment_max_bytes" && Number(row.value) > 0) out.limits.maxBytes = Number(row.value);
      if (row.key === "attachments_max_per_feedback" && Number(row.value) > 0) out.limits.maxFiles = Number(row.value);
      if (row.key === "attachment_allowed_mime_types" && Array.isArray(row.value)) out.limits.types = row.value.map(String);
    }
  } catch (_) { /* keep defaults */ }
  return out;
}

/** Returns { field: message } for every invalid field (empty object when valid). */
export function validateFeedback(f) {
  const e = {};
  if (!TYPES.includes(f.type)) e.type = "Choose a feedback type.";
  const subject = (f.subject || "").trim();
  if (subject.length < 3) e.subject = "Subject must be at least 3 characters.";
  else if (subject.length > 150) e.subject = "Subject must be 150 characters or fewer.";
  const desc = (f.description || "").trim();
  if (desc.length < 10) e.description = "Please describe your feedback in at least 10 characters.";
  else if (desc.length > 4000) e.description = "Description must be 4000 characters or fewer.";
  const r = Number(f.rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) e.rating = "Please rate our service from 1 to 5.";
  if (f.method && !METHODS.includes(f.method)) e.method = "Choose a valid response method.";
  if ((f.productName || "").trim().length > 150) e.productName = "Product name must be 150 characters or fewer.";
  if ((f.purchaseRef || "").trim().length > 100) e.purchaseRef = "Purchase reference must be 100 characters or fewer.";
  return e;
}

const SIGNATURES = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
};

/** Returns an error message or "" if the file may be uploaded. Checks type, size and file signature. */
export async function checkFile(file, limits) {
  if (!limits.types.includes(file.type) || !EXT[file.type]) return `${file.name}: only JPG, PNG or PDF files are allowed.`;
  if (file.size <= 0) return `${file.name}: the file is empty.`;
  if (file.size > limits.maxBytes) return `${file.name}: larger than ${Math.round(limits.maxBytes / 1048576)} MB.`;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const ok = SIGNATURES[file.type].some((sig) => sig.every((b, i) => head[i] === b));
    if (!ok) return `${file.name}: the file content does not match its type.`;
  } catch (_) { return `${file.name}: could not read the file.`; }
  return "";
}

function mapInsertError(error) {
  const m = `${error?.message || ""}`;
  if (/already submitted/i.test(m)) return "You already sent this feedback a moment ago. Check My Feedback.";
  if (/not available|served/i.test(m)) return "The staff member you chose is not available. Choose another or leave it blank.";
  if (/row-level security|permission denied|not allowed/i.test(m)) return "Your account is not allowed to submit feedback.";
  return "We could not submit your feedback. Please try again.";
}

const clean = (v, max) => { const t = (v || "").trim(); return t ? t.slice(0, max) : null; };
const safeName = (n) => String(n || "file").split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "file";

/**
 * Submits feedback, then uploads attachments. Returns
 * { ok, id, reference, attachmentErrors[] } or { ok:false, message }.
 */
export async function submitFeedback(uid, f, files = []) {
  const row = {
    customer_id: uid,
    feedback_type: f.type,
    subject: f.subject.trim(),
    description: f.description.trim(),
    service_rating: Number(f.rating),
    served_by_employee_id: f.servedBy || null,
    product_service_category: clean(f.category, 80),
    product_name: clean(f.productName, 150),
    purchase_reference: clean(f.purchaseRef, 100),
    preferred_response_method: f.method || null,
  };
  const { data, error } = await sb.from("feedback").insert(row).select("id, reference_number").single();
  if (error || !data) return { ok: false, message: mapInsertError(error) };

  const attachmentErrors = [];
  for (const file of files) {
    const path = `${uid}/${data.id}/${crypto.randomUUID()}.${EXT[file.type]}`;
    const up = await sb.storage.from("feedback-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { attachmentErrors.push(`${safeName(file.name)}: upload failed.`); continue; }
    const meta = await sb.from("feedback_attachments").insert({
      feedback_id: data.id, uploaded_by: uid, storage_path: path,
      file_name: safeName(file.name), mime_type: file.type, size_bytes: file.size,
    });
    if (meta.error) attachmentErrors.push(`${safeName(file.name)}: could not be attached.`);
  }
  return { ok: true, id: data.id, reference: data.reference_number, attachmentErrors };
}

// ---------------------------------------------------------------------------
// Tracking (customer's own feedback; RLS limits every query to the owner)
// ---------------------------------------------------------------------------
export async function listMyFeedback() {
  const { data, error } = await sb
    .from("feedback")
    .select("id, reference_number, feedback_type, subject, status, created_at, service_rating")
    .order("created_at", { ascending: false })
    .limit(500);
  return error ? { ok: false, rows: [] } : { ok: true, rows: data || [] };
}

export async function getMyFeedback(id) {
  const { data, error } = await sb
    .from("feedback")
    .select("id, reference_number, feedback_type, subject, description, service_rating, status, created_at, resolved_at, resolution_details, product_service_category, product_name, purchase_reference, preferred_response_method")
    .eq("id", id)
    .maybeSingle();
  return error ? null : data;
}

/** Only customer-visible responses (RLS also hides internal notes). Author names are never exposed. */
export async function listMyResponses(feedbackId) {
  const { data } = await sb
    .from("feedback_responses")
    .select("id, response_text, created_at")
    .eq("feedback_id", feedbackId)
    .eq("visibility", "customer")
    .order("created_at", { ascending: true });
  return data || [];
}

export async function listMyAttachments(feedbackId) {
  const { data } = await sb
    .from("feedback_attachments")
    .select("id, file_name, mime_type, size_bytes, storage_path")
    .eq("feedback_id", feedbackId)
    .order("created_at", { ascending: true });
  return data || [];
}

/** Short-lived signed link to a private attachment (storage RLS decides who may get one). */
export async function attachmentLink(path) {
  const { data, error } = await sb.storage.from("feedback-attachments").createSignedUrl(path, 60);
  return error || !data ? null : data.signedUrl;
}

export async function listUnreadUpdates() {
  const { data } = await sb
    .from("notifications")
    .select("id, feedback_id, message, created_at")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(10);
  return data || [];
}

/** Marks the user's own notifications read (all, or those for one feedback). */
export async function markUpdatesRead(feedbackId) {
  let q = sb.from("notifications").update({ is_read: true }).eq("is_read", false);
  if (feedbackId) q = q.eq("feedback_id", feedbackId);
  const { error } = await q;
  return !error;
}

// ---------------------------------------------------------------------------
// Staff view of one case (administrator now; manager in Milestone 7). RLS decides what comes back.
// ---------------------------------------------------------------------------
export async function getStaffFeedbackDetail(id) {
  const { data: f, error } = await sb.from("feedback").select("*").eq("id", id).maybeSingle();
  if (error || !f) return null;
  const [assignments, responses, history, attachments] = await Promise.all([
    sb.from("feedback_assignments").select("id, assigned_employee_id, assigned_by_manager_id, assigned_at, unassigned_at, assignment_note").eq("feedback_id", id).order("assigned_at", { ascending: true }),
    sb.from("feedback_responses").select("id, author_id, response_text, visibility, created_at").eq("feedback_id", id).order("created_at", { ascending: true }),
    sb.from("feedback_status_history").select("id, previous_status, new_status, changed_by, change_note, changed_at").eq("feedback_id", id).order("changed_at", { ascending: true }),
    sb.from("feedback_attachments").select("id, file_name, mime_type, size_bytes, storage_path").eq("feedback_id", id).order("created_at", { ascending: true }),
  ]);
  const A = assignments.data || [], R = responses.data || [], H = history.data || [];
  const ids = [...new Set([f.customer_id, f.served_by_employee_id, f.resolved_by,
    ...A.flatMap((a) => [a.assigned_employee_id, a.assigned_by_manager_id]), ...R.map((r) => r.author_id), ...H.map((h) => h.changed_by)].filter(Boolean))];
  const { data: people } = await sb.from("profiles").select("id, first_name, last_name, email, phone, role").in("id", ids);
  const byId = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const name = (pid) => { if (!pid) return f.is_anonymous ? "Anonymous User" : "Staff member"; const p = byId[pid]; return p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email : "Staff member"; };
  return { feedback: f, customer: byId[f.customer_id] || null, assignments: A, responses: R, history: H, attachments: attachments.data || [], name };
}
