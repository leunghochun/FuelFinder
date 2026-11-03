export async function readBatchResponse(response: Response): Promise<unknown> {
  if (response.status === 401 || response.status === 403) {
    throw new Error('Fuel Finder rejected the access token. Check the POC credentials and scope.');
  }
  if (response.status === 204 || response.status === 404) return { data: [] };
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') detail = ` ${body.error}`;
    } catch {
      // The API may return a non-JSON error.
    }
    throw new Error(`Fuel data request failed (${response.status}).${detail}`);
  }
  return response.json() as Promise<unknown>;
}