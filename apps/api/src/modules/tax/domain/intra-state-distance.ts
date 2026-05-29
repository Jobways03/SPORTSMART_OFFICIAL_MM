// Phase 29 — E-Way Bill intra-state distance helper.
//
// Indian CBIC Rule 138 requires an EWB on consignments above
// ₹50,000. Several state notifications (and Sportsmart's HSN spec)
// add a further intra-state exemption when the goods movement
// stays within ~10km of the consignor's place of business. Per the
// spec doc, EWB is required iff:
//
//   consignmentValue > ₹50,000  AND  ( inter-state  OR  intra-state-distance > 10km )
//
// Distance is determined from pincode coordinates: we look up
// `PostOffice.latitude / longitude` for both ends and compute the
// great-circle distance via the haversine formula. Road distance
// can differ, but for the 10km gate the geodesic distance is the
// industry-standard approximation (any reasonable road route is at
// most ~30% longer; well under the threshold for typical cases
// where 10km matters).
//
// Pure function — no DB. The service layer is responsible for
// looking up coords; this helper just does the math + decision.

const EARTH_RADIUS_KM = 6371; // mean Earth radius (km)

/**
 * Haversine great-circle distance between two coordinates in
 * kilometres. Accepts decimal degrees.
 *
 * Returns NaN if any input is non-finite — the caller checks before
 * using the result.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Number.NaN;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface IntraStateExemptInput {
  fromStateCode: string | null;
  toStateCode: string | null;
  /** Geodesic distance in km. May be null/undefined when pincode
   *  geo data wasn't available — in which case the helper returns
   *  `exempt=false` (pessimistic; EWB stays required). */
  distanceKm: number | null | undefined;
  thresholdKm: number;
}

export interface IntraStateExemptResult {
  /** True only when we have ENOUGH info to conclude the consignment
   *  is intra-state AND the distance is at or below the threshold. */
  exempt: boolean;
  /** True when both state codes are present and equal. The caller
   *  uses this to log "intra-state but distance unknown — staying
   *  required" cases distinctly from inter-state. */
  isIntraState: boolean;
  /** True when state info was insufficient to make a determination
   *  (one or both codes null). Caller logs this distinctly. */
  stateInfoMissing: boolean;
  /** True when distance was missing — flagged so the caller can
   *  emit an admin-task to backfill coordinates if many rows lack
   *  this data. */
  distanceMissing: boolean;
}

/**
 * Decide whether the consignment qualifies for the intra-state
 * sub-threshold-distance EWB exemption. The decision is conservative
 * — any missing input keeps `exempt=false`.
 */
export function isIntraStateUnderThreshold(
  input: IntraStateExemptInput,
): IntraStateExemptResult {
  const stateInfoMissing = !input.fromStateCode || !input.toStateCode;
  const isIntraState =
    !stateInfoMissing && input.fromStateCode === input.toStateCode;

  if (!isIntraState) {
    return {
      exempt: false,
      isIntraState: false,
      stateInfoMissing,
      distanceMissing: false,
    };
  }

  const distanceMissing =
    input.distanceKm === null ||
    input.distanceKm === undefined ||
    !Number.isFinite(input.distanceKm);

  if (distanceMissing) {
    return {
      exempt: false,
      isIntraState: true,
      stateInfoMissing: false,
      distanceMissing: true,
    };
  }

  const exempt = (input.distanceKm as number) <= input.thresholdKm;
  return {
    exempt,
    isIntraState: true,
    stateInfoMissing: false,
    distanceMissing: false,
  };
}
