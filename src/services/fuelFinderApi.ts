export type FuelFinderConfig = {
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
  apiUrl: string;
  fuelPricesUrl: string;
};

type OAuthTokenResponse = {
  data?: {
    access_token?: unknown;
    expires_in?: unknown;
  };
  success?: unknown;
};

const config: FuelFinderConfig = {
  clientId: process.env.EXPO_PUBLIC_FUEL_FINDER_CLIENT_ID ?? '',
  clientSecret: process.env.EXPO_PUBLIC_FUEL_FINDER_CLIENT_SECRET ?? '',
  scope: process.env.EXPO_PUBLIC_FUEL_FINDER_SCOPE || 'fuelfinder.read',
  tokenUrl: process.env.EXPO_PUBLIC_FUEL_FINDER_TOKEN_URL
    || 'https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token',
  apiUrl: process.env.EXPO_PUBLIC_FUEL_FINDER_API_URL
    || 'https://www.fuel-finder.service.gov.uk/api/v1/pfs',
  fuelPricesUrl: process.env.EXPO_PUBLIC_FUEL_FINDER_PRICES_API_URL
    || 'https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices',
};

export function createFuelFinderClient(
  clientConfig: FuelFinderConfig,
  fetchImpl: typeof fetch = fetch,
) {
  let token: string | undefined;
  let tokenExpiresAt = 0;

  async function getAccessToken(): Promise<string> {
    if (!clientConfig.clientId || !clientConfig.clientSecret) {
      throw new Error('Configure EXPO_PUBLIC_FUEL_FINDER_CLIENT_ID and EXPO_PUBLIC_FUEL_FINDER_CLIENT_SECRET for this POC. These values are visible in the app bundle.');
    }
    if (token && Date.now() < tokenExpiresAt - 30_000) return token;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret,
      scope: clientConfig.scope,
    });
    const response = await fetchImpl(clientConfig.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (response.status !== 200) {
      throw new Error(`OAuth token request failed (${response.status}). Check the POC credentials and scope.`);
    }

    const result = await response.json() as OAuthTokenResponse;
    if (result.success !== 'true' && result.success !== true) {
      throw new Error('OAuth token request was not successful.');
    }

    const accessToken = result.data?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('OAuth token response did not contain a valid access_token.');
    }

    const expiresIn = Number(result.data?.expires_in);
    token = accessToken;
    tokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300) * 1000;
    return accessToken;
  }

  async function getResource(resourceUrl: string, batchNumber: string): Promise<Response> {
    const url = new URL(resourceUrl);
    url.searchParams.set('batch-number', batchNumber);

    let accessToken = await getAccessToken();
    let response = await fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      token = undefined;
      tokenExpiresAt = 0;
      accessToken = await getAccessToken();
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      });
    }

    return response;
  }

  function getStations(batchNumber = '1'): Promise<Response> {
    return getResource(clientConfig.apiUrl, batchNumber);
  }

  function getFuelPrices(batchNumber = '1'): Promise<Response> {
    return getResource(clientConfig.fuelPricesUrl, batchNumber);
  }

  return { getAccessToken, getStations, getFuelPrices };
}

const fuelFinderClient = createFuelFinderClient(config);

export function getFuelStations(batchNumber = '1'): Promise<Response> {
  return fuelFinderClient.getStations(batchNumber);
}

export function getFuelPrices(batchNumber = '1'): Promise<Response> {
  return fuelFinderClient.getFuelPrices(batchNumber);
}