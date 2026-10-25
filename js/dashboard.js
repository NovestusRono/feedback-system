// Shared display helpers for dashboards and lists (all output is escaped by callers or here).
import { esc } from "./validation.js";

export const TYPE_LABEL = { complaint: "Complaint", compliment: "Compliment", suggestion: "Suggestion" };
export const STATUSES = ["Pending", "In Progress", "Resolved"];
export const METHOD_LABEL = { email: "Email", phone: "Phone call", sms: "SMS", whatsapp: "WhatsApp" };

export const statusBadge = (s) =>
  `<span class="ne-badge ${esc(String(s).toLowerCase().replace(/\s+/g, "-"))}">${esc(s)}</span>`;

const fmt = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", year: "numeric" });
export const fmtDateTime = (iso) => (iso ? fmt.format(new Date(iso)) : "");
export const fmtDate = (iso) => (iso ? fmtDay.format(new Date(iso)) : "");

export const stars = (n) => "★".repeat(Number(n) || 0) + "☆".repeat(5 - (Number(n) || 0));

// ---------------------------------------------------------------------------
// Data access shared by administrator and manager pages
// ---------------------------------------------------------------------------
import { sb } from "./supabase-client.js";
import { url } from "./auth.js";

/** Headline numbers + 30-day trend from the database (admin/manager only; the database enforces it). */
export async function loadStats() {
  const { data, error } = await sb.rpc("dashboard_stats");
  return error || !data ? null : data;
}

export async function listFeedbackPage({ search = "", type = "", status = "", assignment = "", page = 1, size = 10 }) {
  const { data, error } = await sb.rpc("list_feedback", {
    p_search: search.trim() || null, p_type: type || null, p_status: status || null,
    p_limit: size, p_offset: (Math.max(1, page) - 1) * size, p_assignment: assignment || null,
  });
  if (error) return { ok: false, rows: [], total: 0 };
  const rows = data || [];
  return { ok: true, rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

/**
 * Feedback management screen (wireframe 2.2.7): search, Type/Status filters, server-side paging.
 * Used by administrators now and managers in Milestone 7. Filter state lives in the URL.
 */
export async function mountFeedbackManagement(main, { detailsPath, showAssignee = true, title = "FEEDBACK MANAGEMENT", defaultAssignment = "", lockAssignment = false }) {
  const PAGE = 10;
  const qs = new URLSearchParams(location.search);
  const state = { search: (qs.get("q") || "").slice(0, 100), type: qs.get("type") || "", status: qs.get("status") || "", assignment: lockAssignment ? defaultAssignment : (qs.get("assignment") || defaultAssignment), page: Math.max(1, parseInt(qs.get("page"), 10) || 1) };
  if (!["", "assigned", "unassigned"].includes(state.assignment)) state.assignment = "";
  if (!TYPE_LABEL[state.type]) state.type = "";
  if (!STATUSES.includes(state.status)) state.status = "";

  main.innerHTML = `
    <h1 class="ne-page-title">${esc(title)}</h1>
    <div id="alert" class="alert d-none" role="alert"></div>
    <div class="ne-panel">
      <form class="ne-filters" id="filters" role="search">
        <input class="form-control" id="q" type="search" placeholder="Search reference, subject or customer..." aria-label="Search" maxlength="100" style="min-width:260px" value="${esc(state.search)}">
        <button class="btn btn-ne py-2" type="submit">Search</button>
        <span><label for="fType">Type:</label><select class="form-select d-inline-block" id="fType"><option value="">All</option>${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${state.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></span>
        ${showAssignee && !lockAssignment ? `<span><label for="fAssign">Assignment:</label><select class="form-select d-inline-block" id="fAssign"><option value="">All</option><option value="unassigned" ${state.assignment === "unassigned" ? "selected" : ""}>Unassigned</option><option value="assigned" ${state.assignment === "assigned" ? "selected" : ""}>Assigned</option></select></span>` : ""}
        <span><label for="fStatus">Status:</label><select class="form-select d-inline-block" id="fStatus"><option value="">All</option>${STATUSES.map((s) => `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></span>
      </form>
      <div class="ne-table-wrap" id="tableWrap"><p class="ne-empty">Loading...</p></div>
      <div class="ne-pager" id="pager"></div>
    </div>`;
  const $ = (id) => document.getElementById(id);
  let token = 0;

  async function load() {
    const mine = ++token;
    history.replaceState(null, "", `?${new URLSearchParams({ ...(state.search && { q: state.search }), ...(state.type && { type: state.type }), ...(state.status && { status: state.status }), ...(state.assignment && !lockAssignment && { assignment: state.assignment }), ...(state.page > 1 && { page: state.page }) })}`.replace(/\?$/, location.pathname));
    $("tableWrap").innerHTML = `<p class="ne-empty">Loading...</p>`;
    const r = await listFeedbackPage({ ...state, size: PAGE });
    if (mine !== token) return;                       // a newer request replaced this one
    const alertEl = $("alert");
    alertEl.className = r.ok ? "d-none" : "alert alert-danger";
    if (!r.ok) { alertEl.textContent = "We could not load the feedback list. Please try again."; $("tableWrap").innerHTML = ""; $("pager").innerHTML = ""; return; }
    const pages = Math.max(1, Math.ceil(r.total / PAGE));
    if (state.page > pages) { state.page = 1; return load(); }
    if (!r.rows.length && state.page > 1) { state.page = 1; return load(); }   // page past the end
    if (!r.rows.length) {
      $("tableWrap").innerHTML = `<p class="ne-empty">${state.search || state.type || state.status || (state.assignment && !lockAssignment) ? "No feedback matches your filters." : lockAssignment && defaultAssignment === "unassigned" ? "Every case has been assigned. Nothing is waiting." : "No feedback has been submitted yet."}</p>`;
      $("pager").innerHTML = ""; return;
    }
    $("tableWrap").innerHTML = `<table class="ne-table"><thead><tr><th>Reference</th><th>Customer</th><th>Type</th><th>Status</th>${showAssignee ? "<th>Assigned To</th>" : ""}<th>Date</th><th>Action</th></tr></thead><tbody>${
      r.rows.map((x) => `<tr><td>${esc(x.reference_number)}</td><td>${esc(x.customer_name)}</td><td>${esc(TYPE_LABEL[x.feedback_type] || x.feedback_type)}</td><td>${statusBadge(x.status)}</td>${showAssignee ? `<td>${x.assigned_employee_name ? esc(x.assigned_employee_name) : '<span class="text-muted-ne">Unassigned</span>'}</td>` : ""}<td>${esc(fmtDate(x.created_at))}</td><td><a class="btn-view" href="${esc(url(detailsPath + "?id=" + encodeURIComponent(x.id)))}">View</a></td></tr>`).join("")}</tbody></table>`;
    $("pager").innerHTML = `<span class="text-muted-ne">${r.total} item${r.total === 1 ? "" : "s"}</span>${pages > 1 ? `<span><button class="btn btn-sm btn-ne-secondary" id="prev" ${state.page === 1 ? "disabled" : ""}>Previous</button> <span class="mx-2">Page ${state.page} of ${pages}</span> <button class="btn btn-sm btn-ne-secondary" id="next" ${state.page === pages ? "disabled" : ""}>Next</button></span>` : ""}`;
    $("prev")?.addEventListener("click", () => { state.page--; load(); });
    $("next")?.addEventListener("click", () => { state.page++; load(); });
  }
  const reset = () => { state.search = $("q").value; state.type = $("fType").value; state.status = $("fStatus").value; if ($("fAssign")) state.assignment = $("fAssign").value; state.page = 1; load(); };
  $("filters").addEventListener("submit", (e) => { e.preventDefault(); reset(); });
  $("fType").addEventListener("change", reset);
  $("fStatus").addEventListener("change", reset);
  $("fAssign")?.addEventListener("change", reset);
  await load();
}
