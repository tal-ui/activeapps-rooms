import { createClient } from "@supabase/supabase-js";

// AA CRM project (Supabase). The anon key is a publishable client key; every
// row is protected by RLS (see supabase/migrations/*_room_rls.sql).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly in dev; in prod Vercel env vars are required.
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy env.example to .env");
}

export const supabase = createClient(SUPABASE_URL ?? "http://localhost", SUPABASE_ANON_KEY ?? "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin;
export const CRM_URL = (import.meta.env.VITE_CRM_URL as string | undefined) ?? "https://crm.activeapps.io";
