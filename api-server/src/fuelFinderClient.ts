export type FuelFinderConfig = {
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
  apiUrl: string;
  fuelPricesUrl: string;
  requestTimeoutMs?: number;
};

type OAuthTokenResponse = {
  data?: {
    access_token?: unknown;
    expires_in?: unknown;
  };
  success?: unknown;
};

export function createFuelFinderClient(
  config: FuelFinderConfig,
  fetchImpl: typeof fetch = fetch,
) {
  const requestTimeoutMs = config.requestTimeoutMs ?? 60_000;
  let token: string | undefined;
  let tokenExpiresAt = 0;
  let tokenRequest: Promise<string> | undefined;

  async function requestToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope,
    });
    const response = await fetchImpl(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) throw new Error(`OAuth token request failed (${response.status}).`);

    const result = await response.json() as OAuthTokenResponse;
    const accessToken = result.data?.access_token;
    if ((result.success !== 'true' && result.success !== true)
      || typeof accessToken !== 'string'
      || accessToken.length === 0) {
      throw new Error('OAuth token response did not contain a valid access token.');
    }

    const expiresIn = Number(result.data?.expires_in);
    token = accessToken;
    tokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300) * 1000;
    return accessToken;
  }

  async function getAccessToken(): Promise<string> {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Set FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET in the API server environment.');
    }
    if (token && Date.now() < tokenExpiresAt - 30_000) return token;
    if (!tokenRequest) {
      tokenRequest = requestToken().finally(() => {
        tokenRequest = undefined;
      });
    }
    return tokenRequest;
  }

  async function getResource(resourceUrl: string, resourceName: string, batchNumber: string): Promise<Response> {
    const url = new URL(resourceUrl);
    url.searchParams.set('batch-number', batchNumber);

    let accessToken = await getAccessToken();
    const fetchResource = async () => {
      try {
        return await fetchImpl(url, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new Error(`${resourceName} batch ${batchNumber} timed out after ${requestTimeoutMs} ms.`, { cause: error });
        }
        throw error;
      }
    };

    let response = await fetchResource();

    if (response.status === 401 || response.status === 403) {
      token = undefined;
      tokenExpiresAt = 0;
      accessToken = await getAccessToken();
      response = await fetchResource();
    }

    return response;
  }

  return {
    getAccessToken,
    getStations: (batchNumber: string) => getResource(config.apiUrl, 'Station', batchNumber),
    getFuelPrices: (batchNumber: string) => getResource(config.fuelPricesUrl, 'Fuel-price', batchNumber),
  };
}