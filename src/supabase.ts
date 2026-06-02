import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rdprkqfxznajegttfsbg.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkcHJrcWZ4em5hamVndHRmc2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjkzOTYsImV4cCI6MjA5MDQ0NTM5Nn0.yX-vvx3WDNYCNDTx1GGecxYAs2IVZ_5_aLEMdfjLpYE';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Supabase credentials missing from environment. Using hardcoded fallbacks.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
