/**
 * Exact WGS84 Transverse Mercator UTM projection (USGS / Karney formulation)
 * and UTM zone detection with Norway/Svalbard irregular exceptions.
 */

export interface UtmCoordinates {
  easting: number;
  northing: number;
  zone: number;
  isNorthern: boolean;
  epsg: string;
}

export interface UtmZoneInfo {
  epsg: string;
  epsgCode: number;
  zone: number;
  isNorthern: boolean;
  description: string;
}

/**
 * Calculates the exact UTM zone EPSG code and description for a lat/lon point,
 * including the official Norway and Svalbard irregular zone bounds.
 */
export function calculateUtmZone(lat: number, lon: number): UtmZoneInfo {
  if (lat < -80.0 || lat > 84.0) {
    throw new Error(
      "UTM is only defined between 80°S and 84°N (use UPS for polar regions)."
    );
  }
  if (lon < -180.0 || lon > 180.0) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  let zone = Math.min(60, Math.floor((lon + 180.0) / 6) + 1);

  // South-west Norway exception
  if (lat >= 56.0 && lat < 64.0 && lon >= 3.0 && lon < 12.0) {
    zone = 32;
  }
  // Svalbard exceptions
  else if (lat >= 72.0 && lat <= 84.0 && lon >= 0.0) {
    if (lon < 9.0) zone = 31;
    else if (lon < 21.0) zone = 33;
    else if (lon < 33.0) zone = 35;
    else if (lon < 42.0) zone = 37;
  }

  const isNorthern = lat >= 0;
  const epsgCode = (isNorthern ? 32600 : 32700) + zone;
  const lonMin = (zone - 1) * 6 - 180;

  const fmt = (val: number) => `${Math.abs(val)}°${val >= 0 ? "E" : "W"}`;
  const description = `Zone ${zone} (${fmt(lonMin)} - ${fmt(lonMin + 6)} - ${
    isNorthern ? "Northern" : "Southern"
  } Hemisphere)`;

  return {
    epsg: `EPSG:${epsgCode}`,
    epsgCode,
    zone,
    isNorthern,
    description,
  };
}

/**
 * Converts Latitude/Longitude to Transverse Mercator Easting & Northing in meters.
 */
export function latLonToUtm(
  lat: number,
  lon: number,
  zoneNumber?: number,
  isNorthern?: boolean
): UtmCoordinates {
  if (zoneNumber === undefined || isNorthern === undefined) {
    const zoneInfo = calculateUtmZone(lat, lon);
    zoneNumber = zoneInfo.zone;
    isNorthern = zoneInfo.isNorthern;
  }

  const a = 6378137.0; // WGS84 semi-major axis
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ePrime2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);
  const centralLon = ((zoneNumber - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = ePrime2 * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - centralLon);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) *
        Math.sin(4 * latRad) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * latRad));

  const easting =
    500000 +
    k0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ePrime2) * Math.pow(A, 5)) / 120);

  let northing =
    k0 *
    (M +
      N *
        Math.tan(latRad) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ePrime2) * Math.pow(A, 6)) /
            720));

  if (!isNorthern) {
    northing += 10000000.0;
  }

  const epsgCode = (isNorthern ? 32600 : 32700) + zoneNumber;

  return {
    easting: Math.round(easting),
    northing: Math.round(northing),
    zone: zoneNumber,
    isNorthern,
    epsg: `EPSG:${epsgCode}`,
  };
}
