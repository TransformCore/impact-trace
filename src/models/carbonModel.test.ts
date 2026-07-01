import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCarbon } from './carbonModel.js';
import type { CarbonMetric } from '../types/index.js';

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('greenHostingFactor only affects data-center operational carbon', () => {
  const metrics: CarbonMetric[] = [
    {
      source: 'network',
      timestampStart: 0,
      timestampEnd: 1,
      networkBytes: 5_000_000,
      metadata: { url: 'https://example.com/main.css', runLabel: 'single-run' },
    },
  ];

  const baseline = estimateCarbon(metrics, { greenHostingFactor: 0 });
  const adjusted = estimateCarbon(metrics, { greenHostingFactor: 0.5 });

  approxEqual(
    adjusted.swdmSegments.dataCenters.operationalCarbonGrams,
    baseline.swdmSegments.dataCenters.operationalCarbonGrams * 0.5,
  );

  approxEqual(
    adjusted.swdmSegments.dataCenters.embodiedCarbonGrams,
    baseline.swdmSegments.dataCenters.embodiedCarbonGrams,
  );
  approxEqual(
    adjusted.swdmSegments.networks.operationalCarbonGrams,
    baseline.swdmSegments.networks.operationalCarbonGrams,
  );
  approxEqual(
    adjusted.swdmSegments.networks.embodiedCarbonGrams,
    baseline.swdmSegments.networks.embodiedCarbonGrams,
  );
  approxEqual(
    adjusted.swdmSegments.userDevices.operationalCarbonGrams,
    baseline.swdmSegments.userDevices.operationalCarbonGrams,
  );
  approxEqual(
    adjusted.swdmSegments.userDevices.embodiedCarbonGrams,
    baseline.swdmSegments.userDevices.embodiedCarbonGrams,
  );
});