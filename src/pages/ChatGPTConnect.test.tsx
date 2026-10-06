import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatGPTConnect from './ChatGPTConnect';

const mocks = vi.hoisted(() => ({ user: { id: 'owner', email: 'owner@example.com' } as { id: string; email: string } | null,
  request: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock('@/lib/chatgptConnector', () => ({ connectorOrigin: () => 'https://connector.example.com',
  connectorRequest: mocks.request }));
const request = 'A'.repeat(43);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/chatgpt-connect?request=${request}`]}>
    <ChatGPTConnect /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  mocks.user = { id: 'owner', email: 'owner@example.com' };
  mocks.request.mockReset();
});
afterEach(cleanup);

describe('ChatGPT account consent', () => {
  it('keeps the request page available while the user signs in in another tab', () => {
    mocks.user = null; mount();
    const link = screen.getByRole('link', { name: 'Open sign in' });
    expect(link).toHaveAttribute('href', '/auth');
    expect(link).toHaveAttribute('target', '_blank');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Allow access' })).not.toBeInTheDocument();
  });
  it('shows the signed-in identity and consented draft permissions; approval failures remain reviewable', async () => {
    mocks.request.mockResolvedValueOnce({ client_id: 'scrollmarketer-chatgpt', scopes: ['marketing:read', 'drafts:write'] })
      .mockRejectedValueOnce(new Error('Connection request expired.'));
    mount();
    const allow = await screen.findByRole('button', { name: 'Allow access' });
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Save pending content drafts/)).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(allow);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/oauth/consent', {
      method: 'POST', body: JSON.stringify({ request, approve: true }) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection request expired.');
    expect(allow).not.toBeDisabled();
  });
});
