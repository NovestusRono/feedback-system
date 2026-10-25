// Administrator reports: data access, CSV building (with formula-injection guard) and helpers.
// Only administrators can call these RPCs; the database refuses everyone else.
import { sb } from "./supabase-client.js";

const RANGE_ERR = /valid date range|366/i;

export const isoDay = (d) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
};

/** Start/end dates (YYYY-MM-DD, Nairobi time) for a preset report type. */
export function presetRange(type, today = new Date()) {
  const end = isoDay(today);
  const [y, m, d] = end.split("-").map(Number);
  const at = (yy, mm, dd) => isoDay(new Date(Date.UTC(yy, mm - 1, dd, 12)));
  if (type === "daily") return { from: end, to: end };
  if (type === "weekly") return { from: at(y, m, d - 6), to: end };
  if (type === "monthly") return { from: at(y, m, 1), to: end };
  if (type === "yearly") return { from: at(y, 1, 1), to: end };
  return null;                       // "custom"
}

export function validateRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return "Choose a start and end date.";
  if (from > to) return "The start date must be on or before the end date.";
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) return "The date range cannot exceed 366 days.";
  return "";
}

function mapErr(error) {
  const m = error?.message || "";
  if (RANGE_ERR.test(m)) return m;
  if (/not allowed|permission denied/i.test(m)) return "Only administrators can view reports.";
  return "We could not load the report. Please try again.";
}

export async function loadReport(from, to) {
  const { data, error } = await sb.rpc("report_summary", { p_from: from, p_to: to });
  if (error || !data) return { ok: false, message: mapErr(error) };
  return { ok: true, report: data };
}

export async function loadReportRows(from, to) {
  const { data, error } = await sb.rpc("report_rows", { p_from: from, p_to: to });
  if (error) return { ok: false, message: mapErr(error) };
  return { ok: true, rows: data || [] };
}

/** Best-effort audit entry; never blocks the user. */
export async function logReportEvent(action, from, to) {
  try { await sb.rpc("log_admin_event", { p_action: action, p_metadata: { from, to } }); } catch (_) { /* ignore */ }
}

/** Neutralise spreadsheet formulas: cells starting with = + - @ tab or CR get a leading apostrophe. */
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEAD = ["Reference", "Created (Nairobi)", "Type", "Status", "Subject", "Customer", "Category", "Rating", "Assigned to", "Resolved (Nairobi)", "Resolution hours"];

export function buildCsv(rows, fmtDateTime) {
  const lines = [CSV_HEAD.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([r.reference_number, fmtDateTime(r.created_at), r.feedback_type, r.status, r.subject, r.customer_name, r.category,
      r.service_rating, r.assigned_employee, fmtDateTime(r.resolved_at), r.resolution_hours].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
