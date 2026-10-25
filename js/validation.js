// Client-side validation and escaping helpers. These are for usability only:
// the database enforces the real rules.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** Returns an error message, or "" when valid. */
export function validateName(v, label = "Name") {
  const t = (v || "").trim();
  if (t.length < 1) return `${label} is required.`;
  if (t.length > 60) return `${label} must be 60 characters or fewer.`;
  return "";
}

export function validatePassword(v) {
  if (typeof v !== "string" || v.length < 8) return "Password must be at least 8 characters.";
  if (v.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Password must include at least one letter and one number.";
  return "";
}

/** Phone is optional. Accepts digits, spaces, + - ( ) with 9 to 15 digits. */
export function validatePhone(v) {
  const t = (v || "").trim();
  if (!t) return "";
  if (!/^[+\d][\d\s\-()]*$/.test(t)) return "Enter a valid phone number.";
  const digits = t.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15 ? "" : "Enter a valid phone number.";
}

// ---- Small form helpers (shared by the auth pages) ----
export function showAlert(el, message, type = "danger") {
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;          // textContent: never HTML
  el.classList.toggle("d-none", !message);
}
export function setBusy(btn, busy, busyText = "Please wait...") {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = busyText; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
export function setFieldError(input, message) {
  input.classList.toggle("is-invalid", !!message);
  let fb = input.parentElement.querySelector(".invalid-feedback");
  if (!fb) { fb = document.createElement("div"); fb.className = "invalid-feedback"; input.parentElement.appendChild(fb); }
  fb.textContent = message || "";
}
