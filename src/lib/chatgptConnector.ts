import { supabase } from '@/integrations/supabase/client';

export function connectorOrigin(): string | null {
  const value = import.meta.env.VITE_SCROLLMARKETER_CONNECTOR_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
      ? url.origin : null;
  } catch { return null; }
}

export async function connectorRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const origin = connectorOrigin();
  if (!origin) throw new Error('The ChatGPT connection is not configured yet.');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in to Scroll Marketer to continue.');
  const response = await fetch(`${origin}${path}`, { ...options, credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error(response.status === 410
    ? 'This connection request has expired. Start again in ChatGPT.'
    : 'The connection could not be updated. Please try again.');
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
