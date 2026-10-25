// Administrator user management. Account creation and (de)activation go through Edge Functions
// (service-role key stays on the server). Role changes are direct profile updates that RLS and the
// profiles_guard trigger allow only for administrators, and that are audited by the trigger.
import { sb } from "./supabase-client.js";
import { isEmail, validateName, validatePhone } from "./validation.js";

export const STAFF_ROLE_LABEL = { administrator: "Administrator", manager: "Manager", employee: "Employee", customer: "Customer" };
export const CREATABLE_ROLES = ["employee", "manager", "administrator"];

export async function listUsers({ search = "", role = "", status = "", page = 1, size = 10 }) {
  const { data, error } = await sb.rpc("list_users", {
    p_search: search.trim() || null, p_role: role || null, p_status: status || null,
    p_limit: size, p_offset: (page - 1) * size,
  });
  if (error) return { ok: false, rows: [], total: 0 };
  return { ok: true, rows: data || [], total: data?.length ? Number(data[0].total_count) : 0 };
}

export function validateNewUser(f) {
  const e = {};
  const fn = validateName(f.first_name, "First name"); if (fn) e.first_name = fn;
  const ln = validateName(f.last_name, "Last name"); if (ln) e.last_name = ln;
  if (!isEmail((f.email || "").trim())) e.email = "Enter a valid work email.";
  const ph = validatePhone(f.phone); if (ph) e.phone = ph;
  if (!CREATABLE_ROLES.includes(f.role)) e.role = "Choose a role.";
  const p = f.temporary_password || "";
  if (p.length < 10 || p.length > 72 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) e.temporary_password = "Use 10 to 72 characters with at least one letter and one number.";
  return e;
}

async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = "";
    try { const j = await error.context?.json?.(); msg = j?.error || ""; } catch (_) { /* not json */ }
    return { ok: false, message: msg || "The request failed. Please try again." };
  }
  if (data?.error) return { ok: false, message: String(data.error) };
  return { ok: true, data };
}

export const createStaffUser = (f) => callFunction("create-staff-user", {
  email: f.email.trim(), first_name: f.first_name.trim(), last_name: f.last_name.trim(),
  phone: (f.phone || "").trim(), role: f.role, temporary_password: f.temporary_password,
});

export const setAccountStatus = (userId, status) => callFunction("set-account-status", { user_id: userId, status });

export async function changeRole(userId, role) {
  const { error } = await sb.from("profiles").update({ role }).eq("id", userId);
  if (!error) return { ok: true };
  const m = error.message || "";
  if (/only active administrator/i.test(m)) return { ok: false, message: "The only active administrator cannot be demoted." };
  if (/not allowed|row-level|permission/i.test(m)) return { ok: false, message: "You are not allowed to change this role." };
  return { ok: false, message: "We could not change the role. Please try again." };
}

export async function listAuditLogs({ action = "", page = 1, size = 20 }) {
  const { data, error } = await sb.rpc("list_audit_logs", { p_action: action || null, p_limit: size, p_offset: (page - 1) * size });
  if (error) return { ok: false, rows: [], total: 0 };
  return { ok: true, rows: data || [], total: data?.length ? Number(data[0].total_count) : 0 };
}
