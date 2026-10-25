// Activates or deactivates any account (customer or staff). ADMIN ONLY.
// Deactivation does two things: marks the profile inactive (RLS then denies everything
// immediately) and bans the auth user so no new session or token refresh is possible.
import { bearer, corsHeaders, isUuid, json } from "../_shared/http.ts";

export interface Deps {
  allowedOrigins: string[];
  getCallerId(token: string): Promise<string | null>;
  getProfile(id: string): Promise<{ role: string; account_status: string } | null>;
  /** Returns an error message (e.g. last-administrator guard) or null on success. */
  setStatus(id: string, status: "active" | "inactive"): Promise<string | null>;
  /** Ban (inactive) or unban (active) the auth user. Returns true on success. */
  setBan(id: string, banned: boolean): Promise<boolean>;
  audit(row: { actor_id: string; action: string; entity_type: string; entity_id: string; metadata: Record<string, unknown> }): Promise<void>;
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  const reply = (s: number, b: unknown) => json(req, d.allowedOrigins, s, b);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, d.allowedOrigins) });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  const token = bearer(req);
  const callerId = token ? await d.getCallerId(token) : null;
  if (!callerId) return reply(401, { error: "Sign in required." });
  const me = await d.getProfile(callerId);
  if (!me || me.role !== "administrator" || me.account_status !== "active") return reply(403, { error: "Only administrators can change account status." });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Invalid request." }); }
  const id = b?.user_id, status = b?.status;
  if (!isUuid(id) || (status !== "active" && status !== "inactive")) return reply(400, { error: "Provide user_id and status (active or inactive)." });
  if (id === callerId) return reply(400, { error: "You cannot change your own account status." });

  const target = await d.getProfile(id);
  if (!target) return reply(404, { error: "User not found." });
  if (target.account_status === status) return reply(200, { id, status, changed: false });

  const previous = target.account_status as "active" | "inactive";
  const err = await d.setStatus(id, status);
  if (err) return reply(409, { error: err });
  if (!(await d.setBan(id, status === "inactive"))) {
    await d.setStatus(id, previous);   // roll back so profile and auth agree
    return reply(500, { error: "Could not update the sign-in state. No change was made." });
  }
  await d.audit({ actor_id: callerId, action: status === "inactive" ? "account_deactivated" : "account_activated", entity_type: "profile", entity_id: id, metadata: { role: target.role } });
  return reply(200, { id, status, changed: true });
}
