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

test('if-default CPU curve profile computes expected utilization, power factor, and energy', () => {
  const metrics: CarbonMetric[] = [
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1000,
      cpuTimeMs: 500,
      metadata: {
        runLabel: 'single-run',
        cpuMeasurementWindowMs: 1000,
      },
    },
  ];

  const estimate = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'if-default',
    cpuToDeviceEnergyFactor: 1,
    cpuActiveCores: 1,
  });

  approxEqual(estimate.cpuUtilizationPercent, 50);
  approxEqual(estimate.cpuPowerFactor, 0.75);
  approxEqual(estimate.totalCpuEnergyKwh, (1000 / 3_600_000) * (75 / 1000));
  approxEqual(estimate.totalCpuCarbonGrams, estimate.totalCpuEnergyKwh * 300);
});

test('linear CPU curve profile is proportional to utilization', () => {
  const metrics: CarbonMetric[] = [
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1000,
      cpuTimeMs: 500,
      metadata: {
        runLabel: 'single-run',
        cpuMeasurementWindowMs: 1000,
      },
    },
  ];

  const estimate = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'linear',
    cpuToDeviceEnergyFactor: 1,
    cpuActiveCores: 1,
  });

  approxEqual(estimate.cpuUtilizationPercent, 50);
  approxEqual(estimate.cpuPowerFactor, 0.5);
  approxEqual(estimate.totalCpuEnergyKwh, (1000 / 3_600_000) * (50 / 1000));
});

test('if-default profile interpolates correctly between curve points', () => {
  const metrics: CarbonMetric[] = [
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1000,
      cpuTimeMs: 300,
      metadata: {
        runLabel: 'single-run',
        cpuMeasurementWindowMs: 1000,
      },
    },
  ];

  const estimate = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'if-default',
    cpuToDeviceEnergyFactor: 1,
    cpuActiveCores: 1,
  });

  // Between x=10,y=0.32 and x=50,y=0.75 at x=30 => 0.535
  approxEqual(estimate.cpuUtilizationPercent, 30);
  approxEqual(estimate.cpuPowerFactor, 0.535);
});

test('cpuToDeviceEnergyFactor scales CPU/device energy linearly', () => {
  const metrics: CarbonMetric[] = [
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1000,
      cpuTimeMs: 500,
      metadata: {
        runLabel: 'single-run',
        cpuMeasurementWindowMs: 1000,
      },
    },
  ];

  const base = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'linear',
    cpuToDeviceEnergyFactor: 1,
    cpuActiveCores: 1,
  });

  const doubled = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'linear',
    cpuToDeviceEnergyFactor: 2,
    cpuActiveCores: 1,
  });

  approxEqual(doubled.totalCpuEnergyKwh, base.totalCpuEnergyKwh * 2);
  approxEqual(doubled.totalCpuCarbonGrams, base.totalCpuCarbonGrams * 2);
});

test('cpuActiveCores changes derived utilization under the same CPU time and window', () => {
  const metrics: CarbonMetric[] = [
    {
      source: 'browser',
      timestampStart: 0,
      timestampEnd: 1000,
      cpuTimeMs: 500,
      metadata: {
        runLabel: 'single-run',
        cpuMeasurementWindowMs: 1000,
      },
    },
  ];

  const oneCore = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'linear',
    cpuToDeviceEnergyFactor: 1,
    cpuActiveCores: 1,
  });

  const twoCores = estimateCarbon(metrics, {
    cpuWatts: 100,
    cpuCurveProfile: 'linear',
    cpuToDeviceEnergyFactor: 1,
    cpuActiveCores: 2,
  });

  approxEqual(oneCore.cpuUtilizationPercent, 50);
  approxEqual(twoCores.cpuUtilizationPercent, 25);
  assert.ok(oneCore.totalCpuEnergyKwh > twoCores.totalCpuEnergyKwh);
});