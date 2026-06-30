import type { CarbonEstimate, CarbonMetric, ResourceImpact } from '../types/index.js';
import { co2 as Co2Model } from '@tgwf/co2';

export const ENERGY_PER_GB = 0.1;
export const CARBON_INTENSITY = 300;
export const DEFAULT_CPU_WATTS = 20;

const BYTES_PER_GB = 1024 * 1024 * 1024;
const MS_PER_HOUR = 1000 * 60 * 60;
const WATTS_PER_KILOWATT = 1000;
const co2Model = new Co2Model({ model: 'swd', version: 4, results: 'segment' });

interface SegmentedCo2Result {
  total?: number;
  dataCenterCO2e?: number;
  networkCO2e?: number;
  consumerDeviceCO2e?: number;
}

export function bytesToKwh(bytes: number): number {
  return (bytes / BYTES_PER_GB) * ENERGY_PER_GB;
}

export function kwhToCarbonGrams(kwh: number): number {
  return kwh * CARBON_INTENSITY;
}

function bytesToNetworkCarbonGramsWithoutDevice(bytes: number): number {
  if (bytes <= 0) {
    return 0;
  }

  try {
    const trace = co2Model.perByteTrace(bytes, false);
    const co2 = trace?.co2 as number | SegmentedCo2Result | undefined;

    if (typeof co2 === 'number') {
      return co2;
    }

    const dataCenter = co2?.dataCenterCO2e ?? 0;
    const network = co2?.networkCO2e ?? 0;
    const segmentedWithoutDevice = dataCenter + network;
    if (segmentedWithoutDevice > 0) {
      return segmentedWithoutDevice;
    }

    return co2?.total ?? 0;
  } catch {
    // Keep deterministic fallback behavior if co2.js trace fails unexpectedly.
    return kwhToCarbonGrams(bytesToKwh(bytes));
  }
}

export function cpuMsToKwh(cpuTimeMs: number, cpuWatts: number): number {
  return (cpuTimeMs / MS_PER_HOUR) * (cpuWatts / WATTS_PER_KILOWATT);
}

export interface EstimateCarbonOptions {
  cpuWatts?: number;
}

export function estimateCarbon(metrics: CarbonMetric[], options: EstimateCarbonOptions = {}): CarbonEstimate {
  const cpuWatts = options.cpuWatts ?? DEFAULT_CPU_WATTS;
  const networkMetrics = metrics.filter((metric) => (metric.networkBytes ?? 0) > 0);
  const cpuMetrics = metrics.filter((metric) => (metric.cpuTimeMs ?? 0) > 0);

  const networkBytes = networkMetrics.reduce((sum, metric) => sum + (metric.networkBytes ?? 0), 0);
  const totalNetworkCarbonGrams = bytesToNetworkCarbonGramsWithoutDevice(networkBytes);
  const totalNetworkEnergyKwh = totalNetworkCarbonGrams / CARBON_INTENSITY;

  const totalCpuTimeMs = cpuMetrics.reduce((sum, metric) => sum + (metric.cpuTimeMs ?? 0), 0);
  const totalCpuEnergyKwh = cpuMsToKwh(totalCpuTimeMs, cpuWatts);
  const totalCpuCarbonGrams = kwhToCarbonGrams(totalCpuEnergyKwh);

  const totalEnergyKwh = totalNetworkEnergyKwh + totalCpuEnergyKwh;
  const totalCarbonGrams = totalNetworkCarbonGrams + totalCpuCarbonGrams;

  const resourceMap = new Map<string, ResourceImpact>();

  for (const metric of networkMetrics) {
    const url = metric.metadata?.url;
    if (!url) {
      continue;
    }

    const bytes = metric.networkBytes ?? 0;
    if (bytes <= 0) {
      continue;
    }

    const key = `${url}::${metric.metadata?.resourceType ?? 'unknown'}`;
    const existing = resourceMap.get(key);

    if (existing) {
      existing.networkBytes += bytes;
      existing.carbonGrams = bytesToNetworkCarbonGramsWithoutDevice(existing.networkBytes);
      existing.energyKwh = existing.carbonGrams / CARBON_INTENSITY;
      existing.cached = existing.cached ?? metric.metadata?.cached;
      continue;
    }

    const carbonGrams = bytesToNetworkCarbonGramsWithoutDevice(bytes);
    const energyKwh = carbonGrams / CARBON_INTENSITY;
    resourceMap.set(key, {
      url,
      resourceType: metric.metadata?.resourceType,
      networkBytes: bytes,
      energyKwh,
      carbonGrams,
      cached: metric.metadata?.cached,
    });
  }

  return {
    totalEnergyKwh,
    totalCarbonGrams,
    totalNetworkEnergyKwh,
    totalNetworkCarbonGrams,
    totalCpuTimeMs,
    totalCpuEnergyKwh,
    totalCpuCarbonGrams,
    networkBytes,
    resourceImpacts: [...resourceMap.values()].sort((a, b) => b.carbonGrams - a.carbonGrams),
  };
}
