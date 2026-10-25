// Edge Function entrypoint: create-staff-user. Deploy with:
//   supabase functions deploy create-staff-user
// Required secrets (Supabase sets URL/ANON/SERVICE_ROLE automatically):
//   ALLOWED_ORIGINS="https://<user>.github.io"   (comma separated; no wildcard)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handle } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);

Deno.serve((req) =>
  handle(req, {
    allowedOrigins,
    async getCallerId(token) {
      const { data, error } = await service.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    async getProfile(id) {
      const { data } = await service.from("profiles").select("role, account_status").eq("id", id).maybeSingle();
      return data;
    },
    async createAuthUser({ email, password, meta }) {
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
      if (error) return { error: /already|exists|registered/i.test(error.message) ? "exists" : "other" };
      return { id: data.user.id };
    },
    async deleteAuthUser(id) { await service.auth.admin.deleteUser(id); },
    async setRole(id, role) {
      const { error } = await service.from("profiles").update({ role }).eq("id", id);
      return !error;
    },
    async audit(row) { await service.from("audit_logs").insert(row); },
  })
);
