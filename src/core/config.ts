import fs from 'node:fs/promises';
import path from 'node:path';
import type { CpuCurveProfileId, GridIntensityConfig, GridIntensitySegment } from '../types/index.js';

const CONFIG_FILE_NAME = 'impact-trace.config.json';
const DEFAULT_CPU_WATTS = 20;
const DEFAULT_CPU_TO_DEVICE_ENERGY_FACTOR = 1;
const DEFAULT_CPU_ACTIVE_CORES = 1;
const DEFAULT_CPU_MEASUREMENT_SECONDS = 3;
const DEFAULT_GREEN_HOSTING_FACTOR = 0;
const DEFAULT_RETURN_VISITOR_RATIO = 0.75;
const CPU_CURVE_PROFILE_IF_DEFAULT: CpuCurveProfileId = 'if-default';

const CPU_CURVES: Record<CpuCurveProfileId, { x: number[]; y: number[] }> = {
  'if-default': {
    x: [0, 10, 50, 100],
    y: [0.12, 0.32, 0.75, 1.02],
  },
  linear: {
    x: [0, 100],
    y: [0, 1],
  },
};

interface ImpactTraceConfigFile {
  cpuWatts?: unknown;
  cpuCurveProfile?: unknown;
  cpuCurve?: {
    x?: unknown;
    y?: unknown;
  };
  cpuToDeviceEnergyFactor?: unknown;
  cpuActiveCores?: unknown;
  cpuMeasurementSeconds?: unknown;
  greenHostingFactor?: unknown;
  returnVisitorRatio?: unknown;
  dataCacheRatio?: unknown;
  gridIntensity?: {
    device?: unknown;
    network?: unknown;
    networks?: unknown;
    dataCenter?: unknown;
  };
}

export interface RuntimeConfig {
  cpuWatts: number;
  cpuCurveProfile: CpuCurveProfileId;
  cpuCurvePoints: {
    x: number[];
    y: number[];
  };
  cpuCurveSource: 'default' | 'explicit';
  cpuToDeviceEnergyFactor: number;
  cpuActiveCores: number;
  cpuMeasurementSeconds: number;
  greenHostingFactor: number;
  greenHostingFactorSource: 'default' | 'explicit';
  returnVisitorRatio: number;
  returnVisitorRatioSource: 'default' | 'explicit';
  dataCacheRatio?: number;
  dataCacheRatioSource?: 'explicit';
  gridIntensity?: GridIntensityConfig;
}

export interface ResolveRuntimeConfigOptions {
  workingDirectory?: string;
}

export async function resolveRuntimeConfig(
  options: ResolveRuntimeConfigOptions = {},
): Promise<RuntimeConfig> {
  const workingDirectory = options.workingDirectory ?? process.cwd();

  const envCpuWatts = parsePositiveNumber(process.env.IMPACT_TRACE_CPU_WATTS);
  const fileConfig = await readConfigFile(workingDirectory);
  const fileCpuWatts = parsePositiveNumber(fileConfig?.cpuWatts);

  const envCpuCurveProfile = parseCpuCurveProfile(process.env.IMPACT_TRACE_CPU_CURVE_PROFILE);
  const fileCpuCurveProfile = parseCpuCurveProfile(fileConfig?.cpuCurveProfile);
  const resolvedCpuCurveProfile = envCpuCurveProfile ?? fileCpuCurveProfile ?? CPU_CURVE_PROFILE_IF_DEFAULT;

  const envCpuCurveX = parseNumberArray(process.env.IMPACT_TRACE_CPU_CURVE_X);
  const envCpuCurveY = parseNumberArray(process.env.IMPACT_TRACE_CPU_CURVE_Y);
  const fileCpuCurveX = parseNumberArray(fileConfig?.cpuCurve?.x);
  const fileCpuCurveY = parseNumberArray(fileConfig?.cpuCurve?.y);
  const explicitCurveFromEnv = buildCpuCurvePoints(envCpuCurveX, envCpuCurveY);
  const explicitCurveFromFile = buildCpuCurvePoints(fileCpuCurveX, fileCpuCurveY);
  const explicitCurve = explicitCurveFromEnv ?? explicitCurveFromFile;
  const cpuCurvePoints = explicitCurve ?? CPU_CURVES[resolvedCpuCurveProfile];
  const cpuCurveSource: 'default' | 'explicit' =
    explicitCurve || envCpuCurveProfile !== undefined || fileCpuCurveProfile !== undefined
      ? 'explicit'
      : 'default';

  const envCpuToDeviceEnergyFactor = parsePositiveNumber(process.env.IMPACT_TRACE_CPU_TO_DEVICE_ENERGY_FACTOR);
  const fileCpuToDeviceEnergyFactor = parsePositiveNumber(fileConfig?.cpuToDeviceEnergyFactor);

  const envCpuActiveCores = parsePositiveNumber(process.env.IMPACT_TRACE_CPU_ACTIVE_CORES);
  const fileCpuActiveCores = parsePositiveNumber(fileConfig?.cpuActiveCores);

  const envCpuMeasurementSeconds = parsePositiveNumber(process.env.IMPACT_TRACE_CPU_MEASUREMENT_SECONDS);
  const fileCpuMeasurementSeconds = parsePositiveNumber(fileConfig?.cpuMeasurementSeconds);

  const fileGridIntensity = parseGridIntensityConfig(fileConfig?.gridIntensity);
  const envGridIntensity = parseGridIntensityFromEnv();
  const mergedGridIntensity = mergeGridIntensityBySegment(fileGridIntensity, envGridIntensity);

  const fileGreenHostingFactor = parseRatio(fileConfig?.greenHostingFactor);
  const envGreenHostingFactor = parseRatio(process.env.IMPACT_TRACE_GREEN_HOSTING_FACTOR);
  const resolvedGreenHostingFactor =
    envGreenHostingFactor ?? fileGreenHostingFactor ?? DEFAULT_GREEN_HOSTING_FACTOR;
  const greenHostingFactorSource: 'default' | 'explicit' =
    envGreenHostingFactor !== undefined || fileGreenHostingFactor !== undefined ? 'explicit' : 'default';

  const fileReturnVisitorRatio = parseRatio(fileConfig?.returnVisitorRatio);
  const envReturnVisitorRatio = parseRatio(process.env.IMPACT_TRACE_RETURN_VISITOR_RATIO);
  const resolvedReturnVisitorRatio =
    envReturnVisitorRatio ?? fileReturnVisitorRatio ?? DEFAULT_RETURN_VISITOR_RATIO;
  const returnVisitorRatioSource: 'default' | 'explicit' =
    envReturnVisitorRatio !== undefined || fileReturnVisitorRatio !== undefined ? 'explicit' : 'default';

  const fileDataCacheRatio = parseRatio(fileConfig?.dataCacheRatio);
  const envDataCacheRatio = parseRatio(process.env.IMPACT_TRACE_DATA_CACHE_RATIO);
  const resolvedDataCacheRatio = envDataCacheRatio ?? fileDataCacheRatio;
  const dataCacheRatioSource: 'explicit' | undefined =
    resolvedDataCacheRatio !== undefined ? 'explicit' : undefined;

  return {
    cpuWatts: envCpuWatts ?? fileCpuWatts ?? DEFAULT_CPU_WATTS,
    cpuCurveProfile: resolvedCpuCurveProfile,
    cpuCurvePoints,
    cpuCurveSource,
    cpuToDeviceEnergyFactor:
      envCpuToDeviceEnergyFactor ?? fileCpuToDeviceEnergyFactor ?? DEFAULT_CPU_TO_DEVICE_ENERGY_FACTOR,
    cpuActiveCores: envCpuActiveCores ?? fileCpuActiveCores ?? DEFAULT_CPU_ACTIVE_CORES,
    cpuMeasurementSeconds:
      envCpuMeasurementSeconds ?? fileCpuMeasurementSeconds ?? DEFAULT_CPU_MEASUREMENT_SECONDS,
    greenHostingFactor: resolvedGreenHostingFactor,
    greenHostingFactorSource,
    returnVisitorRatio: resolvedReturnVisitorRatio,
    returnVisitorRatioSource,
    dataCacheRatio: resolvedDataCacheRatio,
    dataCacheRatioSource,
    gridIntensity: mergedGridIntensity,
  };
}

function parseCpuCurveProfile(value: unknown): CpuCurveProfileId | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'if-default' || normalized === 'linear') {
    return normalized;
  }

  return undefined;
}

function parseNumberArray(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => parsePositiveOrZeroNumber(item))
      .filter((item): item is number => item !== undefined);
    return parsed.length > 0 ? parsed : undefined;
  }

  if (typeof value === 'string') {
    const parsed = value
      .split(',')
      .map((item) => parsePositiveOrZeroNumber(item.trim()))
      .filter((item): item is number => item !== undefined);
    return parsed.length > 0 ? parsed : undefined;
  }

  return undefined;
}

function parsePositiveOrZeroNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

function buildCpuCurvePoints(x?: number[], y?: number[]): { x: number[]; y: number[] } | undefined {
  if (!x || !y) {
    return undefined;
  }

  if (x.length < 2 || y.length < 2 || x.length !== y.length) {
    return undefined;
  }

  for (let i = 1; i < x.length; i += 1) {
    if (x[i] <= x[i - 1]) {
      return undefined;
    }
  }

  return {
    x: [...x],
    y: [...y],
  };
}

async function readConfigFile(workingDirectory: string): Promise<ImpactTraceConfigFile | undefined> {
  const configPath = path.resolve(workingDirectory, CONFIG_FILE_NAME);

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw) as ImpactTraceConfigFile;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw new Error(`Failed to read ${CONFIG_FILE_NAME}: ${getErrorMessage(error)}`);
  }
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function parseRatio(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }

  return undefined;
}

function parseGridIntensityFromEnv(): GridIntensityConfig | undefined {
  const device = parseGridIntensitySegment(
    process.env.IMPACT_TRACE_GRID_INTENSITY_DEVICE,
    process.env.IMPACT_TRACE_GRID_INTENSITY_DEVICE_COUNTRY,
  );
  const network = parseGridIntensitySegment(
    process.env.IMPACT_TRACE_GRID_INTENSITY_NETWORK,
    process.env.IMPACT_TRACE_GRID_INTENSITY_NETWORK_COUNTRY,
  );
  const dataCenter = parseGridIntensitySegment(
    process.env.IMPACT_TRACE_GRID_INTENSITY_DATACENTER,
    process.env.IMPACT_TRACE_GRID_INTENSITY_DATACENTER_COUNTRY,
  );

  return buildGridIntensityConfig(device, network, dataCenter);
}

function parseGridIntensityConfig(raw: ImpactTraceConfigFile['gridIntensity']): GridIntensityConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const networkRaw = raw.network ?? raw.networks;
  const device = parseGridIntensitySegmentFromUnknown(raw.device);
  const network = parseGridIntensitySegmentFromUnknown(networkRaw);
  const dataCenter = parseGridIntensitySegmentFromUnknown(raw.dataCenter);

  return buildGridIntensityConfig(device, network, dataCenter);
}

function parseGridIntensitySegment(
  valueInput: string | undefined,
  countryInput: string | undefined,
): GridIntensitySegment | undefined {
  if (countryInput) {
    const normalizedCountry = normalizeCountryCode(countryInput);
    if (normalizedCountry) {
      return { country: normalizedCountry };
    }
  }

  return parsePositiveNumber(valueInput);
}

function parseGridIntensitySegmentFromUnknown(value: unknown): GridIntensitySegment | undefined {
  if (typeof value === 'number') {
    return parsePositiveNumber(value);
  }

  if (typeof value === 'string') {
    return parsePositiveNumber(value);
  }

  if (typeof value === 'object' && value !== null && 'country' in value) {
    const country = (value as { country?: unknown }).country;
    if (typeof country === 'string') {
      const normalizedCountry = normalizeCountryCode(country);
      if (normalizedCountry) {
        return { country: normalizedCountry };
      }
    }
  }

  return undefined;
}

function buildGridIntensityConfig(
  device?: GridIntensitySegment,
  network?: GridIntensitySegment,
  dataCenter?: GridIntensitySegment,
): GridIntensityConfig | undefined {
  if (device === undefined && network === undefined && dataCenter === undefined) {
    return undefined;
  }

  return {
    ...(device !== undefined ? { device } : {}),
    ...(network !== undefined ? { network } : {}),
    ...(dataCenter !== undefined ? { dataCenter } : {}),
  };
}

function mergeGridIntensityBySegment(
  base?: GridIntensityConfig,
  overrides?: GridIntensityConfig,
): GridIntensityConfig | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  return buildGridIntensityConfig(
    overrides?.device ?? base?.device,
    overrides?.network ?? base?.network,
    overrides?.dataCenter ?? base?.dataCenter,
  );
}

function normalizeCountryCode(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
