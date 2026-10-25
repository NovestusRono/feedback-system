// Role definitions used by the UI. This only decides what to SHOW. Real enforcement
// is in the database (RLS + SECURITY DEFINER functions), never in this file.

export const ROLES = ["customer", "administrator", "manager", "employee"];
export const STAFF_ROLES = ["administrator", "manager", "employee"];

// Landing page for each role (relative to the site root).
export const ROLE_HOME = {
  customer: "customer/dashboard.html",
  administrator: "admin/dashboard.html",
  manager: "manager/dashboard.html",
  employee: "employee/dashboard.html",
};

export const ROLE_LABEL = {
  customer: "Customer",
  administrator: "Administrator",
  manager: "Manager",
  employee: "Employee",
};

// What each role may do in the UI (mirrors the master prompt permission matrix).
export const CAN = {
  submitFeedback: ["customer"],
  trackOwnFeedback: ["customer"],
  viewAllFeedback: ["administrator", "manager"],
  assignFeedback: ["manager"],
  viewAssignedFeedback: ["employee"],
  resolveFeedback: ["employee"],
  viewReports: ["administrator"],
  manageUsers: ["administrator"],
  viewAuditLogs: ["administrator"],
};

export const can = (role, action) => (CAN[action] || []).includes(role);
