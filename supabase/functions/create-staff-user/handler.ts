// Creates a staff account (administrator, manager or employee). ADMIN ONLY.
// The service-role key lives only in the Edge Function environment, never in the browser.
import { bearer, corsHeaders, isEmail, json } from "../_shared/http.ts";

export interface Deps {
  allowedOrigins: string[];
  /** Verify the caller's JWT with Supabase Auth; returns the user id or null. */
  getCallerId(token: string): Promise<string | null>;
  /** Service-role operations. */
  getProfile(id: string): Promise<{ role: string; account_status: string } | null>;
  createAuthUser(a: { email: string; password: string; meta: Record<string, string> }): Promise<{ id?: string; error?: "exists" | "other" }>;
  deleteAuthUser(id: string): Promise<void>;
  setRole(id: string, role: string): Promise<boolean>;
  audit(row: { actor_id: string; action: string; entity_type: string; entity_id: string; metadata: Record<string, unknown> }): Promise<void>;
}

const ROLES = ["administrator", "manager", "employee"];

export async function handle(req: Request, d: Deps): Promise<Response> {
  const reply = (s: number, b: unknown) => json(req, d.allowedOrigins, s, b);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, d.allowedOrigins) });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  const token = bearer(req);
  const callerId = token ? await d.getCallerId(token) : null;
  if (!callerId) return reply(401, { error: "Sign in required." });
  const me = await d.getProfile(callerId);
  if (!me || me.role !== "administrator" || me.account_status !== "active") return reply(403, { error: "Only administrators can create staff accounts." });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Invalid request." }); }
  if (typeof b !== "object" || b === null) return reply(400, { error: "Invalid request." });

  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const first = typeof b.first_name === "string" ? b.first_name.trim() : "";
  const last = typeof b.last_name === "string" ? b.last_name.trim() : "";
  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  const role = b.role;
  const pw = b.temporary_password;

  if (!isEmail(email)) return reply(400, { error: "Enter a valid work email." });
  if (!first || first.length > 60 || !last || last.length > 60) return reply(400, { error: "First and last name are required (60 characters max)." });
  if (phone && !/^[+\d][\d\s\-()]{7,18}$/.test(phone)) return reply(400, { error: "Enter a valid phone number." });
  if (typeof role !== "string" || !ROLES.includes(role)) return reply(400, { error: "Role must be administrator, manager or employee." });
  if (typeof pw !== "string" || pw.length < 10 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return reply(400, { error: "Temporary password must be 10 to 72 characters with a letter and a number." });

  const created = await d.createAuthUser({ email, password: pw, meta: { first_name: first, last_name: last, phone } });
  if (created.error === "exists") return reply(409, { error: "An account with that email already exists." });
  if (!created.id) return reply(500, { error: "Could not create the account." });

  // The profile row is created by the handle_new_user trigger as a customer; promote it here.
  const ok = await d.setRole(created.id, role);
  if (!ok) {
    await d.deleteAuthUser(created.id);           // never leave a half-created account behind
    return reply(500, { error: "Could not assign the role. Nothing was created." });
  }
  await d.audit({ actor_id: callerId, action: "staff_created", entity_type: "profile", entity_id: created.id, metadata: { role, email } });
  return reply(201, { id: created.id, email, role });
}
