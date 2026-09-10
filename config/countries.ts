/**
 * Production country allow-list for EQOWAG.
 *
 * Confirmed by the client on 8 September 2026: 54 African Union states, EU27
 * and GB. The United States is excluded. Western Sahara / SADR (732) is
 * omitted so the African count stays at 54, matching that confirmation.
 *
 * Codes are ISO 3166-1 numeric. That is what T-REX stores on the identity
 * registry and what CountryAllowlistModule compares against.
 */

/** Chunk size for `batchAllowCountries`. Keeps each factory action well under the Amoy block gas limit. */
export const COUNTRY_ALLOW_BATCH_SIZE = 25;

/** 54 African Union member states, excluding Western Sahara / SADR. */
export const AFRICAN_UNION_COUNTRIES = [
  12, // Algeria
  24, // Angola
  204, // Benin
  72, // Botswana
  854, // Burkina Faso
  108, // Burundi
  120, // Cameroon
  132, // Cabo Verde
  140, // Central African Republic
  148, // Chad
  174, // Comoros
  178, // Congo
  180, // Democratic Republic of the Congo
  384, // Côte d'Ivoire
  262, // Djibouti
  818, // Egypt
  226, // Equatorial Guinea
  232, // Eritrea
  748, // Eswatini
  231, // Ethiopia
  266, // Gabon
  270, // Gambia
  288, // Ghana
  324, // Guinea
  624, // Guinea-Bissau
  404, // Kenya
  426, // Lesotho
  430, // Liberia
  434, // Libya
  450, // Madagascar
  454, // Malawi
  466, // Mali
  478, // Mauritania
  480, // Mauritius
  504, // Morocco
  508, // Mozambique
  516, // Namibia
  562, // Niger
  566, // Nigeria
  646, // Rwanda
  678, // Sao Tome and Principe
  686, // Senegal
  690, // Seychelles
  694, // Sierra Leone
  706, // Somalia
  710, // South Africa
  728, // South Sudan
  729, // Sudan
  834, // Tanzania
  768, // Togo
  788, // Tunisia
  800, // Uganda
  894, // Zambia
  716, // Zimbabwe
] as const;

/** EU27 member states. */
export const EU27_COUNTRIES = [
  40, // Austria
  56, // Belgium
  100, // Bulgaria
  191, // Croatia
  196, // Cyprus
  203, // Czechia
  208, // Denmark
  233, // Estonia
  246, // Finland
  250, // France
  276, // Germany
  300, // Greece
  348, // Hungary
  372, // Ireland
  380, // Italy
  428, // Latvia
  440, // Lithuania
  442, // Luxembourg
  470, // Malta
  528, // Netherlands
  616, // Poland
  620, // Portugal
  642, // Romania
  703, // Slovakia
  705, // Slovenia
  724, // Spain
  752, // Sweden
] as const;

export const UNITED_KINGDOM = 826;
export const UNITED_STATES = 840;

/**
 * Full production allow-list: 54 AU + EU27 + GB = 82 countries.
 * Deduplicated and sorted so tests can assert an exact set.
 */
export const ALLOWED_COUNTRIES: readonly number[] = Array.from(
  new Set<number>([...AFRICAN_UNION_COUNTRIES, ...EU27_COUNTRIES, UNITED_KINGDOM]),
).sort((left, right) => left - right);

/** Split a country list into batches the factory can apply one call at a time. */
export function chunkCountries(
  countries: readonly number[],
  batchSize: number = COUNTRY_ALLOW_BATCH_SIZE,
): number[][] {
  if (batchSize <= 0) {
    throw new Error('Country batch size must be positive');
  }

  const chunks: number[][] = [];

  for (let index = 0; index < countries.length; index += batchSize) {
    chunks.push(countries.slice(index, index + batchSize));
  }

  return chunks;
}
