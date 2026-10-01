import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AdminDocuments } from '@/components/admin/admin-documents';
import { DocumentsList } from '@/components/documents-list';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body });
      const route = routes[`${method} ${url}`] ?? routes[url];
      return route ? Response.json(route.body, { status: route.status ?? 200 }) : Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOC = {
  id: 'd1',
  title: 'Offering memorandum',
  visibility: 'kyc' as const,
  status: 'ready' as const,
  filename: 'Offering memorandum.pdf',
  size: 2_400_000,
  sha256: 'ab'.repeat(32),
  updatedAt: '2026-09-30T12:00:00.000Z',
};

describe('DocumentsList', () => {
  it('says documents are coming soon until the first one is published', async () => {
    stubApi({ '/api/documents': { body: { ok: true, verified: false, documents: [] } } });
    renderWith(<DocumentsList />);
    expect(await screen.findByText('Documents coming soon.')).toBeTruthy();
  });

  it('offers public documents to everyone and asks others to verify for KYC-only ones', async () => {
    stubApi({
      '/api/documents': {
        body: {
          ok: true,
          verified: false,
          documents: [
            { ...DOC, available: false, sha256: null },
            { ...DOC, id: 'd2', title: 'Company profile', visibility: 'public', size: 300_000, available: true },
          ],
        },
      },
    });
    renderWith(<DocumentsList />);

    expect(await screen.findByText('Company profile')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/api/documents/d2/download');
    expect(screen.getByRole('link', { name: 'Verify your identity to download' })).toHaveAttribute('href', '/kyc');
    expect(screen.getByText('2.3 MB')).toBeTruthy();
    expect(screen.getByText('293 KB')).toBeTruthy();
  });
});

describe('AdminDocuments', () => {
  it('creates a KYC-only document by default and uploads its PDF', async () => {
    const calls = stubApi({
      'GET /api/admin/documents': {
        body: { ok: true, documents: [{ ...DOC, status: 'draft', filename: null, size: null, sha256: null }] },
      },
      'POST /api/admin/documents': { body: { ok: true, document: DOC } },
      'PUT /api/admin/documents/d1/file': { body: { ok: true, document: DOC } },
    });
    renderWith(<AdminDocuments canManage />);

    fireEvent.change(await screen.findByLabelText('Document title'), { target: { value: 'Annual report 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.method === 'POST')!.body))).toEqual({
      title: 'Annual report 2026',
      visibility: 'kyc',
    });

    const pdf = new File(['%PDF-1.7'], 'memorandum.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('PDF for Offering memorandum'), { target: { files: [pdf] } });
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    const upload = calls.find((call) => call.method === 'PUT')!;
    expect(upload.headers['content-type']).toBe('application/pdf');
    expect(upload.headers['x-filename']).toBe('memorandum.pdf');
    expect(upload.body).toBe(pdf);
  });

  it('refuses a file that is not a PDF before uploading anything', async () => {
    const calls = stubApi({
      'GET /api/admin/documents': { body: { ok: true, documents: [{ ...DOC, status: 'draft', filename: null }] } },
    });
    renderWith(<AdminDocuments canManage />);
    const exe = new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' });
    fireEvent.change(await screen.findByLabelText('PDF for Offering memorandum'), { target: { files: [exe] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PDF files');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('is read-only for roles without documents:manage', async () => {
    stubApi({ 'GET /api/admin/documents': { body: { ok: true, documents: [DOC] } } });
    renderWith(<AdminDocuments canManage={false} />);
    expect(await screen.findByText('Offering memorandum')).toBeTruthy();
    expect(screen.queryByText('New document')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
