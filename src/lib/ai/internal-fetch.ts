// Calls the app's own REST API from server-side code (the chat tool-calling loop),
// authenticated by forwarding the inbound request's session cookie — the same routes
// the external MCP server wraps, just reusing the caller's session instead of an API key.

export interface InternalApiError extends Error {
  status: number;
  body: unknown;
}

function makeError(status: number, body: unknown): InternalApiError {
  const err = new Error(
    `Internal API error ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`
  ) as InternalApiError;
  err.status = status;
  err.body = body;
  return err;
}

async function parseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

export async function internalFetch(
  origin: string,
  cookieHeader: string,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const res = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
      ...init?.headers,
    },
  });
  const body = await parseBody(res);
  if (!res.ok) throw makeError(res.status, body);
  return body;
}

export async function internalUpload(
  origin: string,
  cookieHeader: string,
  path: string,
  form: FormData
): Promise<unknown> {
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
    body: form,
  });
  const body = await parseBody(res);
  if (!res.ok) throw makeError(res.status, body);
  return body;
}
