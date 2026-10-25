// Role-based navigation shell (navy sidebar + top bar, per the staff wireframes).
// Items marked ready:false are shown disabled until their milestone ships, so there are no dead links.
import { url, signOutAndGo } from "./auth.js";
import { ROLE_LABEL } from "./permissions.js";
import { esc } from "./validation.js";

export const NAV = {
  administrator: [
    { key: "dashboard", label: "Dashboard", href: "admin/dashboard.html", ready: true },
    { key: "feedback", label: "Feedback", href: "admin/feedback.html", ready: true },
    { key: "users", label: "Users", href: "admin/users.html", ready: true },
    { key: "reports", label: "Reports", href: "admin/reports.html", ready: true },
    { key: "audit", label: "Audit Logs", href: "admin/audit.html", ready: true },
  ],
  manager: [
    { key: "dashboard", label: "Dashboard", href: "manager/dashboard.html", ready: true },
    { key: "feedback", label: "All Feedback", href: "manager/feedback.html", ready: true },
    { key: "assignments", label: "Assignments", href: "manager/assignments.html", ready: true },
  ],
  employee: [
    { key: "dashboard", label: "Dashboard", href: "employee/dashboard.html", ready: true },
    { key: "assigned", label: "My Assigned Feedback", href: "employee/assigned.html", ready: true },
  ],
  customer: [
    { key: "dashboard", label: "My Feedback", href: "customer/dashboard.html", ready: true },
    { key: "submit", label: "Submit Feedback", href: "customer/submit.html", ready: true },
  ],
};

/**
 * Builds the shell inside #shell-root and returns the <main> element to fill.
 * Every dynamic value is escaped.
 */
export function mountShell(profile, activeKey) {
  const items = (NAV[profile.role] || [])
    .map((i) =>
      i.ready
        ? `<a href="${esc(url(i.href))}" class="${i.key === activeKey ? "active" : ""}">${esc(i.label)}</a>`
        : `<span class="disabled-item" aria-disabled="true">${esc(i.label)}<span class="soon">soon</span></span>`
    )
    .join("");
  const name = `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || profile.email;
  document.getElementById("shell-root").innerHTML = `
    <div class="ne-app">
      <aside class="ne-sidebar" id="sidebar">
        <div class="d-flex align-items-center justify-content-between">
          <div class="brand">NYOTA ELECTRONICS</div>
          <button class="ne-menu-toggle" type="button" id="menuToggle" aria-label="Toggle menu">Menu</button>
        </div>
        <nav class="items" aria-label="Main">${items}</nav>
      </aside>
      <div class="ne-main">
        <header class="ne-topbar">
          <div class="who">${esc(name)}<span class="role-badge">${esc(ROLE_LABEL[profile.role] || profile.role)}</span></div>
          <button class="btn-logout" type="button" id="logoutBtn">Log out</button>
        </header>
        <main class="ne-content" id="content"></main>
      </div>
    </div>`;
  document.getElementById("logoutBtn").addEventListener("click", () => signOutAndGo(profile.role === "customer" ? "customer/login.html" : "staff/login.html"));
  document.getElementById("menuToggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  return document.getElementById("content");
}
