// Read-only rendering of one case for staff (administrator and manager). Everything is escaped.
import { esc } from "./validation.js";
import { url } from "./auth.js";
import { attachmentLink } from "./feedback.js";
import { TYPE_LABEL, METHOD_LABEL, statusBadge, fmtDateTime, stars } from "./dashboard.js";

const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");

export function renderCaseDetail(d) {
  const f = d.feedback, cur = d.assignments.find((a) => !a.unassigned_at);
  const events = [
    ...d.history.map((h) => ({ at: h.changed_at, t: `${h.previous_status ? `Status: ${h.previous_status} → ${h.new_status}` : `Submitted (${h.new_status})`} by ${d.name(h.changed_by)}${h.change_note ? ` – ${h.change_note}` : ""}` })),
    ...d.assignments.map((a) => ({ at: a.assigned_at, t: `Assigned to ${d.name(a.assigned_employee_id)} by ${d.name(a.assigned_by_manager_id)}${a.assignment_note ? ` – ${a.assignment_note}` : ""}${a.unassigned_at ? ` (until ${fmtDateTime(a.unassigned_at)})` : ""}` })),
  ].sort((x, y) => new Date(x.at) - new Date(y.at));
  return `
    <div class="ne-panel mb-3">
      <dl class="ne-detail">
        <dt>Reference Number:</dt><dd id="ref">${esc(f.reference_number)}</dd>
        <dt>Customer:</dt><dd>${esc(d.name(f.customer_id))}${d.customer?.email ? ` <span class="text-muted-ne fw-normal">(${esc(d.customer.email)}${d.customer.phone ? ", " + esc(d.customer.phone) : ""})</span>` : ""}</dd>
        <dt>Feedback Type:</dt><dd>${esc(TYPE_LABEL[f.feedback_type] || f.feedback_type)}</dd>
        <dt>Subject:</dt><dd>${esc(f.subject)}</dd>
        <dt>Status:</dt><dd id="status">${statusBadge(f.status)}</dd>
        <dt>Assigned To:</dt><dd id="assignee">${cur ? esc(d.name(cur.assigned_employee_id)) : '<span class="text-muted-ne">Unassigned</span>'}</dd>
        <dt>Service rating:</dt><dd>${esc(stars(f.service_rating))}</dd>
        ${row("Served by:", f.served_by_employee_id ? d.name(f.served_by_employee_id) : "")}${row("Category:", f.product_service_category)}${row("Product:", f.product_name)}${row("Receipt / order no.:", f.purchase_reference)}
        ${row("Preferred response:", METHOD_LABEL[f.preferred_response_method])}${row("Submitted:", fmtDateTime(f.created_at))}
      </dl>
      <span class="ne-label">Description:</span><div class="ne-box mb-3" id="desc">${esc(f.description)}</div>
      ${d.attachments.length ? `<span class="ne-label">Attachments:</span><ul class="ne-file-list" id="atts">${d.attachments.map((a) => `<li><span>${esc(a.file_name)}</span><button type="button" class="btn-view" data-path="${esc(a.storage_path)}">Open</button></li>`).join("")}</ul>` : ""}
    </div>
    <div id="actionPanel"></div>
    ${f.status === "Resolved" ? `<div class="ne-panel mb-3"><span class="ne-label">Resolution by ${esc(d.name(f.resolved_by))} (${esc(fmtDateTime(f.resolved_at))}):</span><div class="ne-box" id="resolution">${esc(f.resolution_details)}</div></div>` : ""}
    <div class="ne-panel mb-3"><span class="ne-label">Responses and notes:</span>
      ${d.responses.length ? d.responses.map((r) => `<div class="ne-box mb-2"><small class="text-muted-ne d-block">${esc(d.name(r.author_id))} &middot; ${esc(fmtDateTime(r.created_at))} &middot; <strong>${r.visibility === "internal" ? "Internal note" : "Visible to customer"}</strong></small>${esc(r.response_text)}</div>`).join("") : `<p class="text-muted-ne mb-0">No responses yet.</p>`}
    </div>
    <div class="ne-panel mb-3"><span class="ne-label">History:</span>
      <ul class="ne-timeline" id="history">${events.map((e) => `<li><small>${esc(fmtDateTime(e.at))}</small>${esc(e.t)}</li>`).join("")}</ul></div>`;
}

/** Wires the "Open" buttons of the attachment list to short-lived signed links. */
export function bindAttachments(root = document) {
  const list = (root.getElementById ? root : document).getElementById("atts");
  list?.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-path]"); if (!b) return;
    b.disabled = true; const link = await attachmentLink(b.dataset.path); b.disabled = false;
    if (link) window.open(link, "_blank", "noopener,noreferrer"); else b.textContent = "Unavailable";
  });
}

export const closeButton = (href) => `<a class="btn-ne-secondary" id="closeBtn" href="${esc(url(href))}">Close</a>`;
