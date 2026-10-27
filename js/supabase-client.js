// Supabase browser client. The URL and ANON key are public by design: Row Level
// Security protects the data. NEVER put the service-role key in this repository.
// Replace the two placeholders below with your project's values (Supabase > Project Settings > API).
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

window.__nyotaLoaded = true;   // tells assets/boot-check.js that ES modules work

export const isConfigured = !SUPABASE_URL.includes("YOUR-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");

// supabase-js v2 is loaded as a classic script (window.supabase) before this module.
export const sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/** Show a blocking banner when the backend is not configured or the SDK failed to load. */
export function backendProblem() {
  if (!sb) return "The app could not load its backend library. Check your connection and reload.";
  if (!isConfigured) return "The backend is not configured yet. Add the Supabase URL and anon key in js/supabase-client.js.";
  return "";
}
