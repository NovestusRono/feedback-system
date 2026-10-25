// Edge Function entrypoint: set-account-status. Deploy with:
//   supabase functions deploy set-account-status
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handle } from "./handler.ts";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
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
    async setStatus(id, status) {
      const { error } = await service.from("profiles").update({ account_status: status }).eq("id", id);
      return !error ? null : /only active administrator/i.test(error.message) ? "You cannot deactivate or demote the only active administrator." : "Could not update the account.";
    },
    async setBan(id, banned) {
      const { error } = await service.auth.admin.updateUserById(id, { ban_duration: banned ? "876000h" : "none" });
      return !error;
    },
    async audit(row) { await service.from("audit_logs").insert(row); },
  })
);
