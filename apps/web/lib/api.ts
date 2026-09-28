import { API_ROUTES, type AssetSummaryDto, type AssetsResponse, type ApiError } from '@config/api';

/** Seconds a server-rendered page reuses live figures. Matches the API's own cache. */
export const LIVE_REVALIDATE_SECONDS = 15;

/**
 * Listed assets from the API, read on the server. Null when the API is not
 * configured or not reachable, so pages can fall back to the offering's fixed
 * figures instead of failing.
 */
export async function fetchAssets(): Promise<AssetSummaryDto[] | null> {
  const base = process.env.API_INTERNAL_URL;
  if (!base) {
    return null;
  }
  try {
    const response = await fetch(new URL(API_ROUTES.assets, base), {
      next: { revalidate: LIVE_REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as AssetsResponse | ApiError;
    return body.ok ? body.assets : null;
  } catch {
    return null;
  }
}
