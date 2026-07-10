import type {
  CarbonEstimate,
  CpuCurveProfileId,
  CarbonMetric,
  GridIntensityConfig,
  ResolvedGridIntensity,
  ResourceImpact,
  SwdmCategoryTotals,
  SwdmSegmentsTotals,
  TransferSegmentTotals,
} from '../types/index.js';
import { co2 as Co2Model } from '@tgwf/co2';

export const CARBON_INTENSITY = 300;
export const DEFAULT_CPU_WATTS = 20;
export const DEFAULT_CPU_CURVE_PROFILE: CpuCurveProfileId = 'if-default';
export const DEFAULT_CPU_CURVE_POINTS: Record<CpuCurveProfileId, { x: number[]; y: number[] }> = {
  'if-default': {
    x: [0, 10, 50, 100],
    y: [0.12, 0.32, 0.75, 1.02],
  },
  linear: {
    x: [0, 100],
    y: [0, 1],
  },
};
export const DEFAULT_CPU_TO_DEVICE_ENERGY_FACTOR = 1;
export const DEFAULT_CPU_ACTIVE_CORES = 1;

const BYTES_PER_GB = 1024 * 1024 * 1024;
const MS_PER_HOUR = 1000 * 60 * 60;
const WATTS_PER_KILOWATT = 1000;
const co2Model = new Co2Model({ model: 'swd', version: 4, results: 'segment' });

interface SegmentedCo2Result {
  total?: number;
  dataCenterCO2e?: number;
  networkCO2e?: number;
  consumerDeviceCO2e?: number;
  dataCenterOperationalCO2e?: number;
  networkOperationalCO2e?: number;
  consumerDeviceOperationalCO2e?: number;
  dataCenterEmbodiedCO2e?: number;
  networkEmbodiedCO2e?: number;
  consumerDeviceEmbodiedCO2e?: number;
  totalOperationalCO2e?: number;
  totalEmbodiedCO2e?: number;
}

interface PerByteTraceVariables {
  gridIntensity?: {
    device?: { value?: number };
    network?: { value?: number };
    dataCenter?: { value?: number };
  };
}

export function kwhToCarbonGrams(kwh: number): number {
  return kwh * CARBON_INTENSITY;
}

function bytesToNetworkCarbonGramsWithoutDevice(
  bytes: number,
  gridIntensity?: GridIntensityConfig,
  greenHostingFactor = 0,
): number {
  const segments = applyGreenHostingFactorToSwdmSegments(
    bytesToSwdmSegments(bytes, gridIntensity),
    greenHostingFactor,
  );
  return (
    segments.dataCenters.operationalCarbonGrams +
    segments.dataCenters.embodiedCarbonGrams +
    segments.networks.operationalCarbonGrams +
    segments.networks.embodiedCarbonGrams
  );
}

function emptyTransferSegmentTotals(): TransferSegmentTotals {
  return {
    deviceCarbonGrams: 0,
    networkCarbonGrams: 0,
    dataCenterCarbonGrams: 0,
    deviceEnergyKwh: 0,
    networkEnergyKwh: 0,
    dataCenterEnergyKwh: 0,
  };
}

function emptySwdmCategoryTotals(): SwdmCategoryTotals {
  return {
    operationalCarbonGrams: 0,
    embodiedCarbonGrams: 0,
    operationalEnergyKwh: 0,
    embodiedEnergyKwh: 0,
  };
}

function emptySwdmSegmentsTotals(): SwdmSegmentsTotals {
  return {
    dataCenters: emptySwdmCategoryTotals(),
    networks: emptySwdmCategoryTotals(),
    userDevices: emptySwdmCategoryTotals(),
  };
}

function bytesToSwdmSegments(
  bytes: number,
  gridIntensity?: GridIntensityConfig,
): SwdmSegmentsTotals {
  if (bytes <= 0) {
    return emptySwdmSegmentsTotals();
  }

  const traceOptions = gridIntensity ? { gridIntensity } : undefined;
  const trace = traceOptions
    ? co2Model.perByteTrace(bytes, false, traceOptions)
    : co2Model.perByteTrace(bytes, false);
  const co2 = trace?.co2 as number | SegmentedCo2Result | undefined;

  if (typeof co2 === 'number') {
    const energyKwh = co2 / CARBON_INTENSITY;
    return {
      ...emptySwdmSegmentsTotals(),
      networks: {
        ...emptySwdmCategoryTotals(),
        operationalCarbonGrams: co2,
        operationalEnergyKwh: energyKwh,
      },
    };
  }

  const operationalDataCenter = co2?.dataCenterOperationalCO2e ?? 0;
  const operationalNetwork = co2?.networkOperationalCO2e ?? 0;
  const operationalDevice = co2?.consumerDeviceOperationalCO2e ?? 0;
  const operationalWithoutDevice = operationalDataCenter + operationalNetwork;
  if (operationalWithoutDevice > 0) {
    const embodiedDataCenter = co2?.dataCenterEmbodiedCO2e ?? 0;
    const embodiedNetwork = co2?.networkEmbodiedCO2e ?? 0;
    const embodiedDevice = co2?.consumerDeviceEmbodiedCO2e ?? 0;

    return {
      dataCenters: {
        operationalCarbonGrams: operationalDataCenter,
        embodiedCarbonGrams: embodiedDataCenter,
        operationalEnergyKwh: operationalDataCenter / CARBON_INTENSITY,
        embodiedEnergyKwh: embodiedDataCenter / CARBON_INTENSITY,
      },
      networks: {
        operationalCarbonGrams: operationalNetwork,
        embodiedCarbonGrams: embodiedNetwork,
        operationalEnergyKwh: operationalNetwork / CARBON_INTENSITY,
        embodiedEnergyKwh: embodiedNetwork / CARBON_INTENSITY,
      },
      userDevices: {
        operationalCarbonGrams: operationalDevice,
        embodiedCarbonGrams: embodiedDevice,
        operationalEnergyKwh: operationalDevice / CARBON_INTENSITY,
        embodiedEnergyKwh: embodiedDevice / CARBON_INTENSITY,
      },
    };
  }

  // Backward-compatible fallback if operational split keys are unavailable.
  const dataCenter = co2?.dataCenterCO2e ?? 0;
  const network = co2?.networkCO2e ?? 0;
  const segmentedWithoutDevice = dataCenter + network;
  if (segmentedWithoutDevice > 0) {
    return {
      ...emptySwdmSegmentsTotals(),
      dataCenters: {
        ...emptySwdmCategoryTotals(),
        operationalCarbonGrams: dataCenter,
        operationalEnergyKwh: dataCenter / CARBON_INTENSITY,
      },
      networks: {
        ...emptySwdmCategoryTotals(),
        operationalCarbonGrams: network,
        operationalEnergyKwh: network / CARBON_INTENSITY,
      },
    };
  }

  const fallbackCarbon = co2?.total ?? 0;
  return {
    ...emptySwdmSegmentsTotals(),
    networks: {
      ...emptySwdmCategoryTotals(),
      operationalCarbonGrams: fallbackCarbon,
      operationalEnergyKwh: fallbackCarbon / CARBON_INTENSITY,
    },
  };
}

function swdmToTransferSegments(segments: SwdmSegmentsTotals): TransferSegmentTotals {
  return {
    deviceCarbonGrams:
      segments.userDevices.operationalCarbonGrams + segments.userDevices.embodiedCarbonGrams,
    networkCarbonGrams: segments.networks.operationalCarbonGrams + segments.networks.embodiedCarbonGrams,
    dataCenterCarbonGrams:
      segments.dataCenters.operationalCarbonGrams + segments.dataCenters.embodiedCarbonGrams,
    deviceEnergyKwh: segments.userDevices.operationalEnergyKwh + segments.userDevices.embodiedEnergyKwh,
    networkEnergyKwh: segments.networks.operationalEnergyKwh + segments.networks.embodiedEnergyKwh,
    dataCenterEnergyKwh: segments.dataCenters.operationalEnergyKwh + segments.dataCenters.embodiedEnergyKwh,
  };
}

export function cpuMsToKwh(cpuTimeMs: number, cpuWatts: number): number {
  return (cpuTimeMs / MS_PER_HOUR) * (cpuWatts / WATTS_PER_KILOWATT);
}

export interface EstimateCarbonOptions {
  cpuWatts?: number;
  cpuCurveProfile?: CpuCurveProfileId;
  cpuCurvePoints?: {
    x: number[];
    y: number[];
  };
  cpuToDeviceEnergyFactor?: number;
  cpuActiveCores?: number;
  gridIntensity?: GridIntensityConfig;
  greenHostingFactor?: number;
}

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function resolveCpuCurve(
  profile: CpuCurveProfileId,
  curvePoints?: { x: number[]; y: number[] },
): { x: number[]; y: number[] } {
  if (
    curvePoints &&
    curvePoints.x.length >= 2 &&
    curvePoints.x.length === curvePoints.y.length &&
    curvePoints.x.every((value, index) => index === 0 || value > curvePoints.x[index - 1])
  ) {
    return {
      x: [...curvePoints.x],
      y: [...curvePoints.y],
    };
  }

  return DEFAULT_CPU_CURVE_POINTS[profile];
}

function interpolateCurveFactor(utilizationPercent: number, x: number[], y: number[]): number {
  if (x.length === 0 || y.length === 0 || x.length !== y.length) {
    return 0;
  }

  const utilization = clampPercent(utilizationPercent);
  if (utilization <= x[0]) {
    return y[0];
  }

  const lastIndex = x.length - 1;
  if (utilization >= x[lastIndex]) {
    return y[lastIndex];
  }

  for (let i = 1; i < x.length; i += 1) {
    if (utilization <= x[i]) {
      const x0 = x[i - 1];
      const x1 = x[i];
      const y0 = y[i - 1];
      const y1 = y[i];
      const ratio = (utilization - x0) / (x1 - x0);
      return y0 + (y1 - y0) * ratio;
    }
  }

  return y[lastIndex];
}

export function estimateCarbon(metrics: CarbonMetric[], options: EstimateCarbonOptions = {}): CarbonEstimate {
  const cpuWatts = clampPositive(options.cpuWatts ?? DEFAULT_CPU_WATTS, DEFAULT_CPU_WATTS);
  const cpuCurveProfile = options.cpuCurveProfile ?? DEFAULT_CPU_CURVE_PROFILE;
  const cpuCurvePoints = resolveCpuCurve(cpuCurveProfile, options.cpuCurvePoints);
  const cpuToDeviceEnergyFactor = clampPositive(
    options.cpuToDeviceEnergyFactor ?? DEFAULT_CPU_TO_DEVICE_ENERGY_FACTOR,
    DEFAULT_CPU_TO_DEVICE_ENERGY_FACTOR,
  );
  const cpuActiveCores = clampPositive(options.cpuActiveCores ?? DEFAULT_CPU_ACTIVE_CORES, DEFAULT_CPU_ACTIVE_CORES);
  const gridIntensity = options.gridIntensity;
  const greenHostingFactor = clampRatio(options.greenHostingFactor ?? 0);
  const networkMetrics = metrics.filter((metric) => (metric.networkBytes ?? 0) > 0);
  const cpuMetrics = metrics.filter((metric) => (metric.cpuTimeMs ?? 0) > 0);

  const networkBytes = networkMetrics.reduce((sum, metric) => sum + (metric.networkBytes ?? 0), 0);
  const baseSwdmSegments = bytesToSwdmSegments(networkBytes, gridIntensity);

  const resolvedGridIntensity = resolveGridIntensity(gridIntensity);

  const totalCpuTimeMs = cpuMetrics.reduce((sum, metric) => sum + (metric.cpuTimeMs ?? 0), 0);
  const measuredCpuWindowMs = cpuMetrics.reduce(
    (sum, metric) => sum + (metric.metadata?.cpuMeasurementWindowMs ?? 0),
    0,
  );
  const cpuMeasurementWindowMs = Math.max(measuredCpuWindowMs, totalCpuTimeMs);
  const cpuUtilizationPercent =
    cpuMeasurementWindowMs > 0
      ? clampPercent((totalCpuTimeMs / (cpuMeasurementWindowMs * cpuActiveCores)) * 100)
      : 0;
  const cpuPowerFactor = interpolateCurveFactor(cpuUtilizationPercent, cpuCurvePoints.x, cpuCurvePoints.y);
  const cpuWattage = cpuWatts * cpuPowerFactor;
  const totalCpuEnergyKwh = cpuMsToKwh(cpuMeasurementWindowMs, cpuWattage) * cpuToDeviceEnergyFactor;
  const totalCpuCarbonGrams = kwhToCarbonGrams(totalCpuEnergyKwh);

  const useCpuForUserDevicesOperational = totalCpuTimeMs > 0;

  const swdmSegments: SwdmSegmentsTotals = {
    ...baseSwdmSegments,
    userDevices: {
      ...baseSwdmSegments.userDevices,
      operationalCarbonGrams: useCpuForUserDevicesOperational
        ? totalCpuCarbonGrams
        : baseSwdmSegments.userDevices.operationalCarbonGrams,
      operationalEnergyKwh: useCpuForUserDevicesOperational
        ? totalCpuEnergyKwh
        : baseSwdmSegments.userDevices.operationalEnergyKwh,
    },
  };

  const adjustedSwdmSegments = applyGreenHostingFactorToSwdmSegments(swdmSegments, greenHostingFactor);

  const totalNetworkCarbonGrams =
    adjustedSwdmSegments.dataCenters.operationalCarbonGrams +
    adjustedSwdmSegments.dataCenters.embodiedCarbonGrams +
    adjustedSwdmSegments.networks.operationalCarbonGrams +
    adjustedSwdmSegments.networks.embodiedCarbonGrams;
  const totalNetworkEnergyKwh =
    adjustedSwdmSegments.dataCenters.operationalEnergyKwh +
    adjustedSwdmSegments.dataCenters.embodiedEnergyKwh +
    adjustedSwdmSegments.networks.operationalEnergyKwh +
    adjustedSwdmSegments.networks.embodiedEnergyKwh;

  const totalUserDeviceCarbonGrams =
    adjustedSwdmSegments.userDevices.operationalCarbonGrams + adjustedSwdmSegments.userDevices.embodiedCarbonGrams;
  const totalUserDeviceEnergyKwh =
    adjustedSwdmSegments.userDevices.operationalEnergyKwh + adjustedSwdmSegments.userDevices.embodiedEnergyKwh;

  const transferSegments = swdmToTransferSegments(adjustedSwdmSegments);

  const totalEnergyKwh = totalNetworkEnergyKwh + totalUserDeviceEnergyKwh;
  const totalCarbonGrams = totalNetworkCarbonGrams + totalUserDeviceCarbonGrams;

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
      existing.carbonGrams = bytesToNetworkCarbonGramsWithoutDevice(
        existing.networkBytes,
        gridIntensity,
        greenHostingFactor,
      );
      existing.energyKwh = existing.carbonGrams / CARBON_INTENSITY;
      existing.cached = existing.cached ?? metric.metadata?.cached;
      continue;
    }

    const carbonGrams = bytesToNetworkCarbonGramsWithoutDevice(bytes, gridIntensity, greenHostingFactor);
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
    resolvedGridIntensity,
    greenHostingFactor,
    transferSegments,
    swdmSegments: adjustedSwdmSegments,
    userDeviceOperationalSource: useCpuForUserDevicesOperational ? 'cpu-profiler' : 'co2-transfer',
    cpuCurveProfile,
    cpuCurvePoints,
    cpuPowerFactor,
    cpuUtilizationPercent,
    cpuMeasurementWindowMs,
    cpuToDeviceEnergyFactor,
    cpuActiveCores,
    resourceImpacts: [...resourceMap.values()].sort((a, b) => b.carbonGrams - a.carbonGrams),
  };
}

function applyGreenHostingFactorToSwdmSegments(
  segments: SwdmSegmentsTotals,
  greenHostingFactor: number,
): SwdmSegmentsTotals {
  if (greenHostingFactor <= 0) {
    return segments;
  }

  const nonGreenShare = 1 - clampRatio(greenHostingFactor);
  return {
    ...segments,
    dataCenters: {
      ...segments.dataCenters,
      operationalCarbonGrams: segments.dataCenters.operationalCarbonGrams * nonGreenShare,
    },
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function resolveGridIntensity(gridIntensity?: GridIntensityConfig): ResolvedGridIntensity | undefined {
  try {
    const traceOptions = gridIntensity ? { gridIntensity } : undefined;
    const trace = traceOptions
      ? co2Model.perByteTrace(1, false, traceOptions)
      : co2Model.perByteTrace(1, false);
    const variables = trace?.variables as PerByteTraceVariables | undefined;

    const device = variables?.gridIntensity?.device?.value;
    const network = variables?.gridIntensity?.network?.value;
    const dataCenter = variables?.gridIntensity?.dataCenter?.value;

    if (
      typeof device === 'number' &&
      Number.isFinite(device) &&
      typeof network === 'number' &&
      Number.isFinite(network) &&
      typeof dataCenter === 'number' &&
      Number.isFinite(dataCenter)
    ) {
      return { device, network, dataCenter };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
