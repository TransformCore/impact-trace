import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDataCacheRatio, buildRepresentativeVisit } from './runner.js';
import { estimateCarbon } from '../models/carbonModel.js';
import type { CarbonMetric } from '../types/index.js';

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('deriveDataCacheRatio handles edge cases and clamps output', () => {
  approxEqual(deriveDataCacheRatio(100, 20), 0.8);
  approxEqual(deriveDataCacheRatio(100, 0), 1);
  approxEqual(deriveDataCacheRatio(100, 120), 0);
  approxEqual(deriveDataCacheRatio(0, 10), 0);
  approxEqual(deriveDataCacheRatio(Number.NaN, 10), 0);
});

test('buildRepresentativeVisit returns weighted totals for scalar and SWDM fields', () => {
  const firstMetrics: CarbonMetric[] = [
    {
      source: 'network',
      timestampStart: 0,
      timestampEnd: 1,
      networkBytes: 1000,
      metadata: { runLabel: 'new-user', url: 'https://example.com/a.js' },
    },
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1,
      cpuTimeMs: 1200,
      metadata: { runLabel: 'new-user' },
    },
  ];

  const returningMetrics: CarbonMetric[] = [
    {
      source: 'network',
      timestampStart: 0,
      timestampEnd: 1,
      networkBytes: 400,
      metadata: { runLabel: 'returning-user', url: 'https://example.com/a.js' },
    },
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1,
      cpuTimeMs: 400,
      metadata: { runLabel: 'returning-user' },
    },
  ];

  const firstEstimate = estimateCarbon(firstMetrics, { cpuWatts: 20 });
  const returningEstimate = estimateCarbon(returningMetrics, { cpuWatts: 20 });

  const newVisitorRatio = 0.4;
  const returnVisitorRatio = 0.6;
  const representative = buildRepresentativeVisit(
    firstEstimate,
    returningEstimate,
    newVisitorRatio,
    returnVisitorRatio,
  );
  assert.ok(representative);

  approxEqual(
    representative.swdm.total.carbonGrams,
    firstEstimate.totalCarbonGrams * newVisitorRatio + returningEstimate.totalCarbonGrams * returnVisitorRatio,
  );
  approxEqual(
    representative.swdm.total.energyKwh,
    firstEstimate.totalEnergyKwh * newVisitorRatio + returningEstimate.totalEnergyKwh * returnVisitorRatio,
  );
  approxEqual(
    representative.networkBytes,
    firstEstimate.networkBytes * newVisitorRatio + returningEstimate.networkBytes * returnVisitorRatio,
  );

  approxEqual(
    representative.swdm.operational.dataCenters.carbonGrams,
    firstEstimate.swdmSegments.dataCenters.operationalCarbonGrams * newVisitorRatio +
      returningEstimate.swdmSegments.dataCenters.operationalCarbonGrams * returnVisitorRatio,
  );
  approxEqual(
    representative.swdm.embodied.networks.carbonGrams,
    firstEstimate.swdmSegments.networks.embodiedCarbonGrams * newVisitorRatio +
      returningEstimate.swdmSegments.networks.embodiedCarbonGrams * returnVisitorRatio,
  );
  approxEqual(
    representative.cpu.carbonGrams,
    firstEstimate.totalCpuCarbonGrams * newVisitorRatio + returningEstimate.totalCpuCarbonGrams * returnVisitorRatio,
  );
});