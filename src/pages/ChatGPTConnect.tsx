import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { connectorOrigin, connectorRequest } from '@/lib/chatgptConnector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ConsentRequest { client_id: string; scopes: string[]; expires_at: string }
const scopeLabels: Record<string, string> = {
  'marketing:read': 'Read your offerings, campaigns, content, stored performance metrics and prospects.',
  'drafts:write': 'Save pending content drafts that require your approval in Scroll Marketer.',
};

export default function ChatGPTConnect() {
  const [params] = useSearchParams();
  const request = params.get('request') || '';
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const configured = !!connectorOrigin();
  const valid = /^[A-Za-z0-9_-]{43}$/.test(request);
  const consent = useQuery({ queryKey: ['chatgpt-consent', user?.id, request],
    queryFn: () => connectorRequest<ConsentRequest>(`/oauth/request/${request}`),
    enabled: configured && valid && !!user, retry: false });
  async function respond(approve: boolean) {
    setBusy(true); setActionError('');
    try {
      const result = await connectorRequest<{ redirect: string }>('/oauth/consent', {
        method: 'POST', body: JSON.stringify({ request, approve }) });
      const url = new URL(result.redirect);
      if (url.protocol !== 'https:') throw new Error('Invalid connection response.');
      window.location.assign(url.toString());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to connect.'); setBusy(false);
    }
  }
  return <main className="flex min-h-screen items-center justify-center p-6">
    <Card className="w-full max-w-lg">
      <CardHeader><CardTitle>Connect Scroll Marketer to ChatGPT</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!configured ? <p>The ChatGPT connection has not been configured yet.</p>
          : !valid ? <p>Start this connection from ChatGPT to request access.</p>
          : loading ? <p role="status">Checking your account…</p>
          : !user ? <div className="space-y-3"><p>Sign in to Scroll Marketer, then return to this tab.</p>
            <a className="underline" href="/auth" target="_blank" rel="noopener noreferrer">Open sign in</a></div>
          : consent.isPending ? <p role="status">Loading requested permissions…</p>
          : consent.error ? <p role="alert">{consent.error.message}</p>
          : consent.data ? <>
            <p>Account: <strong>{user.email}</strong></p>
            <p>Client: <strong>{consent.data.client_id}</strong></p>
            <ul className="list-disc space-y-2 pl-5">{consent.data.scopes.map(scope =>
              <li key={scope}>{scopeLabels[scope] || scope}</li>)}</ul>
            <p>Approval gives this connection access for up to 30 days. You can revoke it in Settings → ChatGPT.</p>
            <div className="flex gap-3"><Button disabled={busy} onClick={() => void respond(true)}>Allow access</Button>
              <Button variant="outline" disabled={busy} onClick={() => void respond(false)}>Decline</Button></div>
          </> : null}
        {actionError ? <p role="alert">{actionError}</p> : null}
      </CardContent>
    </Card>
  </main>;
}
