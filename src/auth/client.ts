import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Missing cloud settings leave the local writing preview usable. */
export const cloudConfigured = Boolean(url && publicKey);
export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(url!, publicKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

export function requireCloud(): SupabaseClient {
  if (!supabase)
    throw new Error('Cloud accounts are not configured in this preview.');
  return supabase;
}
