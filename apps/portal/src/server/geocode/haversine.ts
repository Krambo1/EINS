/**
 * Great-circle distance between two WGS84 coordinates, in kilometres.
 *
 * Standard Haversine formula with R = 6371 km (mean Earth radius). Good to
 * within ~0.5% — fine for the "is this lead within driving distance of the
 * praxis" axis of the lead scorer.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

const R_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
