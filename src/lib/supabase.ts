import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://yllmfdldimwvgqkbbegu.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsbG1mZGxkaW13dmdxa2JiZWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3Njg1NjYsImV4cCI6MjExMDM0NDU2Nn0.YVn-CLRyL9mHPkBwnC15rzUD9QAoBt_EFd84rRJBZ0Q';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
  },
});

/**
 * Obtiene la hora exacta del servidor de Supabase a través de las cabeceras HTTP
 * del endpoint REST de Supabase. Si falla la lectura de cabecera, usa la hora actual ISO.
 */
export async function getSupabaseServerTimestamp(): Promise<string> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        apikey: supabaseAnonKey,
      },
      cache: 'no-store',
    });
    const serverDateHeader = response.headers.get('date');
    if (serverDateHeader) {
      const parsed = new Date(serverDateHeader);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  } catch {
    // Fallback below
  }
  return new Date().toISOString();
}
