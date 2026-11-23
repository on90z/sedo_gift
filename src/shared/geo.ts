export interface Coordinates {
  lat: number;
  lng: number;
}

export function calculateDistanceMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c);
}

export interface ProximityCheckInput {
  userCoords: Coordinates;
  storeCoords: Coordinates | null;
  radiusMeters: number;
  proximityEnabled: boolean;
  locationConsent: boolean;
  notificationConsent: boolean;
  lastTriggeredAtMs: number | null;
  cooldownHours: number;
  nowMs?: number;
}

export function evaluateProximityAlert(input: ProximityCheckInput): {
  shouldTrigger: boolean;
  distanceMeters: number | null;
  reason: string;
} {
  if (!input.proximityEnabled || !input.locationConsent || !input.notificationConsent) {
    return { shouldTrigger: false, distanceMeters: null, reason: 'consent_or_feature_disabled' };
  }
  if (!input.storeCoords) {
    return { shouldTrigger: false, distanceMeters: null, reason: 'store_coordinates_unset' };
  }

  const distanceMeters = calculateDistanceMeters(input.userCoords, input.storeCoords);
  if (distanceMeters > input.radiusMeters) {
    return { shouldTrigger: false, distanceMeters, reason: 'outside_radius' };
  }

  const now = input.nowMs ?? Date.now();
  const cooldownMs = Math.max(1, input.cooldownHours) * 3600 * 1000;
  if (input.lastTriggeredAtMs !== null && now - input.lastTriggeredAtMs < cooldownMs) {
    return { shouldTrigger: false, distanceMeters, reason: 'cooldown_active' };
  }

  return { shouldTrigger: true, distanceMeters, reason: 'within_radius' };
}
