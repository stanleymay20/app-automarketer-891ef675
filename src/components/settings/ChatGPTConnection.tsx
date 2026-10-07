import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { connectorOrigin, connectorRequest } from '@/lib/chatgptConnector';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Connection { id: string; scopes: string[]; expires_at: string; revoked_at: string | null }

export function ChatGPTConnection() {
  const { user } = useAuth();
  const client = useQueryClient();
  const origin = connectorOrigin();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['chatgpt-connections', user?.id],
    queryFn: () => connectorRequest<{ connections: Connection[] }>('/oauth/connections'),
    enabled: !!origin && !!user, retry: false });
  async function revoke(id: string) {
    setBusy(id); setError('');
    try {
      await connectorRequest(`/oauth/connections/${id}`, { method: 'DELETE' });
      await client.invalidateQueries({ queryKey: ['chatgpt-connections', user?.id] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to revoke.'); }
    finally { setBusy(null); }
  }
  return <Card><CardHeader><CardTitle>ChatGPT connection</CardTitle>
    <CardDescription>Connect your marketing workspace and manage its access.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {!origin ? <p>The ChatGPT connection is not configured yet.</p> : <>
        <p>In ChatGPT on the web, add a custom MCP server using this address:</p>
        <code className="block break-all rounded bg-muted p-3">{origin}/mcp</code>
        <p>Choose OAuth and use the client ID provided by your administrator. Review the requested permissions when you sign in.</p>
        {query.isPending ? <p role="status">Loading connections…</p> : null}
        {query.error ? <p role="alert">{query.error.message}</p> : null}
        {query.data?.connections.length === 0 ? <p>No connections yet.</p> : null}
        {query.data?.connections.map(connection => <div key={connection.id} className="flex items-center justify-between gap-4 rounded border p-3">
          <div><p className="font-medium">ChatGPT</p><p className="text-sm">{connection.scopes.join(', ')}</p>
            <p className="text-sm">{connection.revoked_at ? 'Revoked' : `Expires ${new Date(connection.expires_at).toLocaleString()}`}</p></div>
          <Button variant="outline" disabled={!!connection.revoked_at || !!busy} onClick={() => void revoke(connection.id)}>
            {busy === connection.id ? 'Revoking…' : 'Revoke'}</Button>
        </div>)}
      </>}
      {error ? <p role="alert">{error}</p> : null}
    </CardContent></Card>;
}
