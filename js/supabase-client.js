// Supabase browser client. The URL and ANON key are public by design: Row Level
// Security protects the data. NEVER put the service-role key in this repository.
// Replace the two placeholders below with your project's values (Supabase > Project Settings > API).
const SUPABASE_URL = "https://gqzblcpytfzzbvpgtkux.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxemJsY3B5dGZ6emJ2cGd0a3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDEwODEsImV4cCI6MjEwOTA3NzA4MX0.o9JTnw9euXDcHzsGQg9MyZIVYk17gG5j0t08uLVpPtk";

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
