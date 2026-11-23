import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDistanceMeters, evaluateProximityAlert } from './geo.ts';
import { SEED_SETTINGS } from './seedCatalog.ts';

test('Haversine distance computes realistic meters in Karbala', () => {
  const store = { lat: 32.616, lng: 44.0249 };
  const nearby = { lat: 32.618, lng: 44.0255 };
  const d = calculateDistanceMeters(store, nearby);
  assert.ok(d > 150 && d < 350, `Expected ~230m, got ${d}`);
});

test('Default store proximity radius is configured to 2000 meters (2 km)', () => {
  assert.equal(SEED_SETTINGS.proximityRadiusMeters, 2000);
});

test('Proximity alert triggers only with consent, within radius, and outside cooldown', () => {
  const store = { lat: 32.616, lng: 44.0249 };
  const inside = { lat: 32.617, lng: 44.025 };
  const around1500m = { lat: 32.6295, lng: 44.0249 }; // ~1501m north
  const around2500m = { lat: 32.6385, lng: 44.0249 }; // ~2502m north
  const far = { lat: 32.7, lng: 44.1 };

  const ok = evaluateProximityAlert({
    userCoords: inside,
    storeCoords: store,
    radiusMeters: 2000,
    proximityEnabled: true,
    locationConsent: true,
    notificationConsent: true,
    lastTriggeredAtMs: null,
    cooldownHours: 24,
    nowMs: 1_000_000,
  });
  assert.equal(ok.shouldTrigger, true);

  const okAt1500m = evaluateProximityAlert({
    userCoords: around1500m,
    storeCoords: store,
    radiusMeters: SEED_SETTINGS.proximityRadiusMeters,
    proximityEnabled: true,
    locationConsent: true,
    notificationConsent: true,
    lastTriggeredAtMs: null,
    cooldownHours: 24,
    nowMs: 1_000_000,
  });
  assert.equal(okAt1500m.shouldTrigger, true);
  assert.ok(okAt1500m.distanceMeters !== null && okAt1500m.distanceMeters <= 2000);

  const outsideAt2500m = evaluateProximityAlert({
    userCoords: around2500m,
    storeCoords: store,
    radiusMeters: SEED_SETTINGS.proximityRadiusMeters,
    proximityEnabled: true,
    locationConsent: true,
    notificationConsent: true,
    lastTriggeredAtMs: null,
    cooldownHours: 24,
    nowMs: 1_000_000,
  });
  assert.equal(outsideAt2500m.shouldTrigger, false);
  assert.equal(outsideAt2500m.reason, 'outside_radius');
  assert.ok(outsideAt2500m.distanceMeters !== null && outsideAt2500m.distanceMeters > 2000);

  const cooldownBlocked = evaluateProximityAlert({
    userCoords: inside,
    storeCoords: store,
    radiusMeters: 2000,
    proximityEnabled: true,
    locationConsent: true,
    notificationConsent: true,
    lastTriggeredAtMs: 900_000,
    cooldownHours: 24,
    nowMs: 1_000_000,
  });
  assert.equal(cooldownBlocked.shouldTrigger, false);
  assert.equal(cooldownBlocked.reason, 'cooldown_active');

  const outside = evaluateProximityAlert({
    userCoords: far,
    storeCoords: store,
    radiusMeters: 2000,
    proximityEnabled: true,
    locationConsent: true,
    notificationConsent: true,
    lastTriggeredAtMs: null,
    cooldownHours: 24,
  });
  assert.equal(outside.shouldTrigger, false);
  assert.equal(outside.reason, 'outside_radius');
});
