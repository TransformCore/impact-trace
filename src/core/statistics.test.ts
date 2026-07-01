import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateReportsForRepeats, normalizeTrimPercent } from './statistics.js';
import type { ImpactTraceReport, SwdmReportBreakdown } from '../types/index.js';

function makeSwdm(totalCarbon: number): SwdmReportBreakdown {
  const operationalCarbon = totalCarbon * 0.75;
  const embodiedCarbon = totalCarbon * 0.25;
  const operationalEnergy = operationalCarbon / 300;
  const embodiedEnergy = embodiedCarbon / 300;

  return {
    total: {
      carbonGrams: totalCarbon,
      energyKwh: (totalCarbon / 300),
    },
    operational: {
      total: {
        carbonGrams: operationalCarbon,
        energyKwh: operationalEnergy,
      },
      dataCenters: {
        carbonGrams: operationalCarbon * 0.2,
        energyKwh: operationalEnergy * 0.2,
        sourceId: 'co2-transfer',
      },
      networks: {
        carbonGrams: operationalCarbon * 0.4,
        energyKwh: operationalEnergy * 0.4,
        sourceId: 'co2-transfer',
      },
      userDevices: {
        carbonGrams: operationalCarbon * 0.4,
        energyKwh: operationalEnergy * 0.4,
        sourceId: 'browser-cpu-profiler',
      },
    },
    embodied: {
      total: {
        carbonGrams: embodiedCarbon,
        energyKwh: embodiedEnergy,
      },
      dataCenters: {
        carbonGrams: embodiedCarbon * 0.2,
        energyKwh: embodiedEnergy * 0.2,
        sourceId: 'co2-transfer',
      },
      networks: {
        carbonGrams: embodiedCarbon * 0.6,
        energyKwh: embodiedEnergy * 0.6,
        sourceId: 'co2-transfer',
      },
      userDevices: {
        carbonGrams: embodiedCarbon * 0.2,
        energyKwh: embodiedEnergy * 0.2,
        sourceId: 'co2-transfer',
      },
    },
  };
}

function makeReport(totalCarbonGrams: number): ImpactTraceReport {
  return {
    swdm: makeSwdm(totalCarbonGrams),
    cpu: {
      timeMs: totalCarbonGrams,
      energyKwh: totalCarbonGrams / 300,
      carbonGrams: totalCarbonGrams / 4,
      sourceId: 'browser-cpu-profiler',
    },
    sources: {
      'browser-cpu-profiler': { kind: 'cpu-profiler' },
      'co2-transfer': { kind: 'transfer-model' },
    },
    networkBytes: totalCarbonGrams * 100,
    topResources: [
      {
        url: 'https://example.com/app.js',
        resourceType: 'script',
        networkBytes: totalCarbonGrams * 10,
        energyKwh: totalCarbonGrams / 500,
        carbonGrams: totalCarbonGrams / 5,
      },
    ],
    suggestions: [
      {
        rule: 'js-splitting',
        message: 'Split large bundles.',
      },
    ],
    modelInputs: {
      returnVisitorRatio: 0.75,
      newVisitorRatio: 0.25,
    },
  };
}

test('aggregateReportsForRepeats computes mean and appends repeat metadata', () => {
  const reports = [makeReport(10), makeReport(20), makeReport(30)];

  const aggregated = aggregateReportsForRepeats(
    reports,
    { mode: 'mean', trimPercent: 0.2 },
    {
      repeat: 3,
      warmup: 1,
      averageMode: 'mean',
      trimPercent: 0.2,
      sampleCount: 3,
    },
  );

  assert.equal(aggregated.swdm.total.carbonGrams, 20);
  assert.equal(aggregated.networkBytes, 2000);
  assert.equal(aggregated.topResources[0].carbonGrams, 4);
  assert.deepEqual(aggregated.modelInputs?.repeatAveraging, {
    repeat: 3,
    warmup: 1,
    averageMode: 'mean',
    trimPercent: 0.2,
    sampleCount: 3,
  });
});

test('aggregateReportsForRepeats supports median and trimmed mean', () => {
  const reports = [makeReport(10), makeReport(15), makeReport(200), makeReport(20), makeReport(25)];

  const median = aggregateReportsForRepeats(
    reports,
    { mode: 'median', trimPercent: 0 },
    {
      repeat: 5,
      warmup: 0,
      averageMode: 'median',
      trimPercent: 0,
      sampleCount: 5,
    },
  );

  const trimmed = aggregateReportsForRepeats(
    reports,
    { mode: 'trimmed-mean', trimPercent: 0.2 },
    {
      repeat: 5,
      warmup: 0,
      averageMode: 'trimmed-mean',
      trimPercent: 0.2,
      sampleCount: 5,
    },
  );

  assert.equal(median.swdm.total.carbonGrams, 20);
  assert.equal(trimmed.swdm.total.carbonGrams, 20);
});

test('aggregateReportsForRepeats recomputes comparison deltas from averaged first and returning visits', () => {
  const one = makeReport(40);
  one.comparison = {
    firstVisit: {
      swdm: makeSwdm(40),
      cpu: { timeMs: 40, energyKwh: 0.1, carbonGrams: 10, sourceId: 'browser-cpu-profiler' },
      networkBytes: 4000,
      topResources: one.topResources,
    },
    returningVisit: {
      swdm: makeSwdm(20),
      cpu: { timeMs: 20, energyKwh: 0.05, carbonGrams: 5, sourceId: 'browser-cpu-profiler' },
      networkBytes: 2000,
      topResources: one.topResources,
    },
    representativeVisit: {
      weights: { newVisitorRatio: 0.25, returnVisitorRatio: 0.75 },
      swdm: makeSwdm(25),
      cpu: { timeMs: 25, energyKwh: 0.0625, carbonGrams: 6.25 },
      networkBytes: 2500,
    },
    delta: {
      absolute: {
        swdm: makeSwdm(-20),
        cpu: { timeMs: -20, energyKwh: -0.05, carbonGrams: -5 },
        networkBytes: -2000,
      },
      percent: {
        swdm: {
          total: { carbon: -50, energy: -50 },
          operational: {
            total: { carbon: -50, energy: -50 },
            dataCenters: { carbon: -50, energy: -50 },
            networks: { carbon: -50, energy: -50 },
            userDevices: { carbon: -50, energy: -50 },
          },
          embodied: {
            total: { carbon: -50, energy: -50 },
            dataCenters: { carbon: -50, energy: -50 },
            networks: { carbon: -50, energy: -50 },
            userDevices: { carbon: -50, energy: -50 },
          },
        },
        cpu: { time: -50, energy: -50, carbon: -50 },
        networkBytes: -50,
      },
    },
  };

  const two = makeReport(60);
  two.comparison = {
    firstVisit: {
      swdm: makeSwdm(60),
      cpu: { timeMs: 60, energyKwh: 0.15, carbonGrams: 15, sourceId: 'browser-cpu-profiler' },
      networkBytes: 6000,
      topResources: two.topResources,
    },
    returningVisit: {
      swdm: makeSwdm(30),
      cpu: { timeMs: 30, energyKwh: 0.075, carbonGrams: 7.5, sourceId: 'browser-cpu-profiler' },
      networkBytes: 3000,
      topResources: two.topResources,
    },
    representativeVisit: {
      weights: { newVisitorRatio: 0.25, returnVisitorRatio: 0.75 },
      swdm: makeSwdm(37.5),
      cpu: { timeMs: 37.5, energyKwh: 0.09375, carbonGrams: 9.375 },
      networkBytes: 3750,
    },
    delta: {
      absolute: {
        swdm: makeSwdm(-30),
        cpu: { timeMs: -30, energyKwh: -0.075, carbonGrams: -7.5 },
        networkBytes: -3000,
      },
      percent: {
        swdm: {
          total: { carbon: -50, energy: -50 },
          operational: {
            total: { carbon: -50, energy: -50 },
            dataCenters: { carbon: -50, energy: -50 },
            networks: { carbon: -50, energy: -50 },
            userDevices: { carbon: -50, energy: -50 },
          },
          embodied: {
            total: { carbon: -50, energy: -50 },
            dataCenters: { carbon: -50, energy: -50 },
            networks: { carbon: -50, energy: -50 },
            userDevices: { carbon: -50, energy: -50 },
          },
        },
        cpu: { time: -50, energy: -50, carbon: -50 },
        networkBytes: -50,
      },
    },
  };

  const aggregated = aggregateReportsForRepeats(
    [one, two],
    { mode: 'mean', trimPercent: 0 },
    {
      repeat: 2,
      warmup: 0,
      averageMode: 'mean',
      trimPercent: 0,
      sampleCount: 2,
    },
  );

  assert.equal(aggregated.comparison?.firstVisit.swdm.total.carbonGrams, 50);
  assert.equal(aggregated.comparison?.returningVisit.swdm.total.carbonGrams, 25);
  assert.equal(aggregated.comparison?.delta.absolute.swdm.total.carbonGrams, -25);
  assert.equal(aggregated.swdm.total.carbonGrams, 50);
});

test('normalizeTrimPercent clamps invalid values', () => {
  assert.equal(normalizeTrimPercent(Number.NaN), 0.2);
  assert.equal(normalizeTrimPercent(-1), 0);
  assert.equal(normalizeTrimPercent(0.25), 0.25);
  assert.equal(normalizeTrimPercent(1), 0.5);
});
