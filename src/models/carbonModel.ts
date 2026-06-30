import type { CarbonEstimate, CarbonMetric, ResourceImpact } from '../types/index.js';

export const ENERGY_PER_GB = 0.1;
export const CARBON_INTENSITY = 300;

const BYTES_PER_GB = 1024 * 1024 * 1024;

export function bytesToKwh(bytes: number): number {
  return (bytes / BYTES_PER_GB) * ENERGY_PER_GB;
}

export function kwhToCarbonGrams(kwh: number): number {
  return kwh * CARBON_INTENSITY;
}

export function estimateCarbon(metrics: CarbonMetric[]): CarbonEstimate {
  const networkMetrics = metrics.filter((metric) => (metric.networkBytes ?? 0) > 0);

  const networkBytes = networkMetrics.reduce((sum, metric) => sum + (metric.networkBytes ?? 0), 0);
  const totalEnergyKwh = bytesToKwh(networkBytes);
  const totalCarbonGrams = kwhToCarbonGrams(totalEnergyKwh);

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
      existing.energyKwh = bytesToKwh(existing.networkBytes);
      existing.carbonGrams = kwhToCarbonGrams(existing.energyKwh);
      existing.cached = existing.cached ?? metric.metadata?.cached;
      continue;
    }

    const energyKwh = bytesToKwh(bytes);
    resourceMap.set(key, {
      url,
      resourceType: metric.metadata?.resourceType,
      networkBytes: bytes,
      energyKwh,
      carbonGrams: kwhToCarbonGrams(energyKwh),
      cached: metric.metadata?.cached,
    });
  }

  return {
    totalEnergyKwh,
    totalCarbonGrams,
    networkBytes,
    resourceImpacts: [...resourceMap.values()].sort((a, b) => b.carbonGrams - a.carbonGrams),
  };
}
