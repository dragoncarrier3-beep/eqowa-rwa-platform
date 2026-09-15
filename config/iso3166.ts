/**
 * ISO 3166-1 mappings for Sumsub country fields.
 *
 * Sumsub sends alpha-2 or alpha-3. T-REX stores the numeric code on the
 * identity registry. Only the 82 allow-list countries plus the United States
 * (explicitly blocked) are mapped; anything else is unknown.
 */

export type IsoCountry = {
  numeric: number;
  alpha2: string;
  alpha3: string;
};

export const ISO_COUNTRIES: readonly IsoCountry[] = [
  { numeric: 12, alpha2: 'DZ', alpha3: 'DZA' },
  { numeric: 24, alpha2: 'AO', alpha3: 'AGO' },
  { numeric: 40, alpha2: 'AT', alpha3: 'AUT' },
  { numeric: 56, alpha2: 'BE', alpha3: 'BEL' },
  { numeric: 72, alpha2: 'BW', alpha3: 'BWA' },
  { numeric: 100, alpha2: 'BG', alpha3: 'BGR' },
  { numeric: 108, alpha2: 'BI', alpha3: 'BDI' },
  { numeric: 120, alpha2: 'CM', alpha3: 'CMR' },
  { numeric: 132, alpha2: 'CV', alpha3: 'CPV' },
  { numeric: 140, alpha2: 'CF', alpha3: 'CAF' },
  { numeric: 148, alpha2: 'TD', alpha3: 'TCD' },
  { numeric: 174, alpha2: 'KM', alpha3: 'COM' },
  { numeric: 178, alpha2: 'CG', alpha3: 'COG' },
  { numeric: 180, alpha2: 'CD', alpha3: 'COD' },
  { numeric: 191, alpha2: 'HR', alpha3: 'HRV' },
  { numeric: 196, alpha2: 'CY', alpha3: 'CYP' },
  { numeric: 203, alpha2: 'CZ', alpha3: 'CZE' },
  { numeric: 204, alpha2: 'BJ', alpha3: 'BEN' },
  { numeric: 208, alpha2: 'DK', alpha3: 'DNK' },
  { numeric: 226, alpha2: 'GQ', alpha3: 'GNQ' },
  { numeric: 231, alpha2: 'ET', alpha3: 'ETH' },
  { numeric: 232, alpha2: 'ER', alpha3: 'ERI' },
  { numeric: 233, alpha2: 'EE', alpha3: 'EST' },
  { numeric: 246, alpha2: 'FI', alpha3: 'FIN' },
  { numeric: 250, alpha2: 'FR', alpha3: 'FRA' },
  { numeric: 262, alpha2: 'DJ', alpha3: 'DJI' },
  { numeric: 266, alpha2: 'GA', alpha3: 'GAB' },
  { numeric: 270, alpha2: 'GM', alpha3: 'GMB' },
  { numeric: 276, alpha2: 'DE', alpha3: 'DEU' },
  { numeric: 288, alpha2: 'GH', alpha3: 'GHA' },
  { numeric: 300, alpha2: 'GR', alpha3: 'GRC' },
  { numeric: 324, alpha2: 'GN', alpha3: 'GIN' },
  { numeric: 348, alpha2: 'HU', alpha3: 'HUN' },
  { numeric: 372, alpha2: 'IE', alpha3: 'IRL' },
  { numeric: 380, alpha2: 'IT', alpha3: 'ITA' },
  { numeric: 384, alpha2: 'CI', alpha3: 'CIV' },
  { numeric: 404, alpha2: 'KE', alpha3: 'KEN' },
  { numeric: 426, alpha2: 'LS', alpha3: 'LSO' },
  { numeric: 428, alpha2: 'LV', alpha3: 'LVA' },
  { numeric: 430, alpha2: 'LR', alpha3: 'LBR' },
  { numeric: 434, alpha2: 'LY', alpha3: 'LBY' },
  { numeric: 440, alpha2: 'LT', alpha3: 'LTU' },
  { numeric: 442, alpha2: 'LU', alpha3: 'LUX' },
  { numeric: 450, alpha2: 'MG', alpha3: 'MDG' },
  { numeric: 454, alpha2: 'MW', alpha3: 'MWI' },
  { numeric: 466, alpha2: 'ML', alpha3: 'MLI' },
  { numeric: 470, alpha2: 'MT', alpha3: 'MLT' },
  { numeric: 478, alpha2: 'MR', alpha3: 'MRT' },
  { numeric: 480, alpha2: 'MU', alpha3: 'MUS' },
  { numeric: 504, alpha2: 'MA', alpha3: 'MAR' },
  { numeric: 508, alpha2: 'MZ', alpha3: 'MOZ' },
  { numeric: 516, alpha2: 'NA', alpha3: 'NAM' },
  { numeric: 528, alpha2: 'NL', alpha3: 'NLD' },
  { numeric: 562, alpha2: 'NE', alpha3: 'NER' },
  { numeric: 566, alpha2: 'NG', alpha3: 'NGA' },
  { numeric: 616, alpha2: 'PL', alpha3: 'POL' },
  { numeric: 620, alpha2: 'PT', alpha3: 'PRT' },
  { numeric: 624, alpha2: 'GW', alpha3: 'GNB' },
  { numeric: 642, alpha2: 'RO', alpha3: 'ROU' },
  { numeric: 646, alpha2: 'RW', alpha3: 'RWA' },
  { numeric: 678, alpha2: 'ST', alpha3: 'STP' },
  { numeric: 686, alpha2: 'SN', alpha3: 'SEN' },
  { numeric: 690, alpha2: 'SC', alpha3: 'SYC' },
  { numeric: 694, alpha2: 'SL', alpha3: 'SLE' },
  { numeric: 703, alpha2: 'SK', alpha3: 'SVK' },
  { numeric: 705, alpha2: 'SI', alpha3: 'SVN' },
  { numeric: 706, alpha2: 'SO', alpha3: 'SOM' },
  { numeric: 710, alpha2: 'ZA', alpha3: 'ZAF' },
  { numeric: 716, alpha2: 'ZW', alpha3: 'ZWE' },
  { numeric: 724, alpha2: 'ES', alpha3: 'ESP' },
  { numeric: 728, alpha2: 'SS', alpha3: 'SSD' },
  { numeric: 729, alpha2: 'SD', alpha3: 'SDN' },
  { numeric: 748, alpha2: 'SZ', alpha3: 'SWZ' },
  { numeric: 752, alpha2: 'SE', alpha3: 'SWE' },
  { numeric: 768, alpha2: 'TG', alpha3: 'TGO' },
  { numeric: 788, alpha2: 'TN', alpha3: 'TUN' },
  { numeric: 800, alpha2: 'UG', alpha3: 'UGA' },
  { numeric: 818, alpha2: 'EG', alpha3: 'EGY' },
  { numeric: 826, alpha2: 'GB', alpha3: 'GBR' },
  { numeric: 834, alpha2: 'TZ', alpha3: 'TZA' },
  { numeric: 840, alpha2: 'US', alpha3: 'USA' },
  { numeric: 854, alpha2: 'BF', alpha3: 'BFA' },
  { numeric: 894, alpha2: 'ZM', alpha3: 'ZMB' },
];

const BY_NUMERIC = new Map(ISO_COUNTRIES.map((row) => [row.numeric, row]));
const BY_ALPHA2 = new Map(ISO_COUNTRIES.map((row) => [row.alpha2, row]));
const BY_ALPHA3 = new Map(ISO_COUNTRIES.map((row) => [row.alpha3, row]));

/** Parse a Sumsub country field (numeric, alpha-2 or alpha-3) to ISO 3166-1 numeric. */
export function parseCountryCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && BY_NUMERIC.has(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return BY_NUMERIC.has(numeric) ? numeric : null;
  }

  const code = trimmed.toUpperCase();
  if (code.length === 2) {
    return BY_ALPHA2.get(code)?.numeric ?? null;
  }
  if (code.length === 3) {
    return BY_ALPHA3.get(code)?.numeric ?? null;
  }

  return null;
}
