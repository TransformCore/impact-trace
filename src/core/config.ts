import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  DeviceMixProfileId,
  DeviceMixProfileSource,
  CpuDeviceProfileFactors,
  CpuDeviceUsageWeights,
  CpuToDeviceFactorSource,
  CpuCurveProfileId,
  GridIntensityConfig,
  GridIntensitySegment,
  ImpactBudgets,
  ImpactScoreThresholds,
  ReportingOutputSettings,
  ReportingOutputFormat,
} from '../types/index.js';

const CONFIG_FILE_NAME = 'impact-trace.config.json';
const DEFAULT_CPU_WATTS = 20;
const DEFAULT_CPU_TO_DEVICE_ENERGY_FACTOR = 1;
const DEFAULT_CPU_ACTIVE_CORES = 1;
const DEFAULT_CPU_MEASUREMENT_SECONDS = 3;
const DEFAULT_GREEN_HOSTING_FACTOR = 0;
const DEFAULT_RETURN_VISITOR_RATIO = 0.75;
const CPU_WEIGHT_TOLERANCE = 0.001;
const CPU_CURVE_PROFILE_DEFAULT: CpuCurveProfileId = 'realistic';
const DEFAULT_CPU_DEVICE_PROFILE_FACTORS: CpuDeviceProfileFactors = {
  desktop: 2.4,
  laptop: 1.8,
  tablet: 1.5,
  mobile: 1.3,
};
const DEFAULT_CPU_DEVICE_USAGE_WEIGHTS: CpuDeviceUsageWeights = {
  desktop: 0.35,
  laptop: 0.35,
  tablet: 0.1,
  mobile: 0.2,
};

const DEVICE_MIX_PROFILES: Record<Exclude<DeviceMixProfileId, 'custom'>, CpuDeviceUsageWeights> = {
  enterprise: {
    desktop: 0.3,
    laptop: 0.55,
    tablet: 0.05,
    mobile: 0.1,
  },
  consumer: {
    desktop: 0.25,
    laptop: 0.2,
    tablet: 0.05,
    mobile: 0.5,
  },
  'mobile-first': {
    desktop: 0.1,
    laptop: 0.15,
    tablet: 0.1,
    mobile: 0.65,
  },
  'desktop-first': {
    desktop: 0.45,
    laptop: 0.35,
    tablet: 0.05,
    mobile: 0.15,
  },
};

const CPU_CURVES: Record<CpuCurveProfileId, { x: number[]; y: number[] }> = {
  realistic: {
    x: [0, 10, 50, 100],
    y: [0.12, 0.32, 0.75, 1.02],
  },
  conservative: {
    x: [0, 10, 50, 100],
    y: [0.1, 0.24, 0.58, 0.88],
  },
  aggressive: {
    x: [0, 10, 50, 100],
    y: [0.16, 0.4, 0.9, 1.12],
  },
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
  cpu?: {
    curve?: unknown;
    deviceMix?: unknown;
    deviceFactors?: unknown;
    deviceMixWeights?: unknown;
    wholeDeviceUpliftFactor?: unknown;
  };
  cpuWatts?: unknown;
  cpuCurveProfile?: unknown;
  cpuCurve?: {
    x?: unknown;
    y?: unknown;
  };
  cpuToDeviceEnergyFactor?: unknown;
  cpuToDeviceEnergyProfileFactors?: unknown;
  cpuToDeviceUsageWeights?: unknown;
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
  reporting?: {
    budgets?: {
      carbonGrams?: unknown;
      transferBytes?: unknown;
      transferMb?: unknown;
      cpuSeconds?: unknown;
      thirdPartyBytes?: unknown;
      thirdPartyMb?: unknown;
    };
    scoreThresholds?: {
      A?: unknown;
      B?: unknown;
      C?: unknown;
      D?: unknown;
      E?: unknown;
    };
    output?: {
      defaultFormat?: unknown;
      findingsLimit?: unknown;
      githubCommentMaxLines?: unknown;
    };
  };
}

export interface ReportingConfig {
  budgets?: ImpactBudgets;
  scoreThresholds?: Partial<ImpactScoreThresholds>;
  output?: ReportingOutputSettings;
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
  cpuToDeviceEnergyFactorBlended: number;
  cpuToDeviceFactorSource: CpuToDeviceFactorSource;
  deviceMixProfile: DeviceMixProfileId;
  deviceMixProfileSource: DeviceMixProfileSource;
  cpuToDeviceProfileFactors: CpuDeviceProfileFactors;
  cpuToDeviceUsageWeights: CpuDeviceUsageWeights;
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
  cpuToDeviceEnergyFactor?: number;
  cpuToDeviceEnergyProfileFactors?: CpuDeviceProfileFactors;
  cpuToDeviceUsageWeights?: CpuDeviceUsageWeights;
  cpuDeviceMixProfile?: DeviceMixProfileId;
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
  const fileCpuBlockCurveProfile = parseCpuCurveProfile(fileConfig?.cpu?.curve);
  const resolvedCpuCurveProfile =
    envCpuCurveProfile ?? fileCpuBlockCurveProfile ?? fileCpuCurveProfile ?? CPU_CURVE_PROFILE_DEFAULT;

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
  const fileCpuToDeviceEnergyFactor =
    parsePositiveNumber(fileConfig?.cpu?.wholeDeviceUpliftFactor) ??
    parsePositiveNumber(fileConfig?.cpuToDeviceEnergyFactor);
  const cliCpuToDeviceEnergyFactor = parsePositiveNumber(options.cpuToDeviceEnergyFactor);

  const fileCpuToDeviceProfileFactors = parseCpuDeviceProfileFactorsFromUnknown(
    fileConfig?.cpu?.deviceFactors ?? fileConfig?.cpuToDeviceEnergyProfileFactors,
    'impact-trace.config.json cpu.deviceFactors/cpuToDeviceEnergyProfileFactors',
  );
  const envCpuToDeviceProfileFactors = parseCpuDeviceProfileFactorsFromString(
    process.env.IMPACT_TRACE_CPU_TO_DEVICE_PROFILE_FACTORS,
    'IMPACT_TRACE_CPU_TO_DEVICE_PROFILE_FACTORS',
  );
  const cliCpuToDeviceProfileFactors = options.cpuToDeviceEnergyProfileFactors;

  const fileCpuToDeviceUsageWeights = parseCpuDeviceUsageWeightsFromUnknown(
    fileConfig?.cpu?.deviceMixWeights ?? fileConfig?.cpuToDeviceUsageWeights,
    'impact-trace.config.json cpu.deviceMixWeights/cpuToDeviceUsageWeights',
  );
  const envCpuToDeviceUsageWeights = parseCpuDeviceUsageWeightsFromString(
    process.env.IMPACT_TRACE_CPU_TO_DEVICE_USAGE_WEIGHTS,
    'IMPACT_TRACE_CPU_TO_DEVICE_USAGE_WEIGHTS',
  );
  const cliCpuToDeviceUsageWeights = options.cpuToDeviceUsageWeights;

  const fileDeviceMixProfile = parseDeviceMixProfile(fileConfig?.cpu?.deviceMix);
  const envDeviceMixProfile = parseDeviceMixProfile(process.env.IMPACT_TRACE_CPU_DEVICE_MIX);
  const cliDeviceMixProfile = options.cpuDeviceMixProfile;
  const resolvedDeviceMixProfile: DeviceMixProfileId =
    cliDeviceMixProfile ?? envDeviceMixProfile ?? fileDeviceMixProfile ?? 'custom';
  const deviceMixProfileSource: DeviceMixProfileSource =
    cliDeviceMixProfile !== undefined || envDeviceMixProfile !== undefined || fileDeviceMixProfile !== undefined
      ? 'explicit'
      : 'default';
  const baseUsageWeights = getDeviceMixWeightsBase(resolvedDeviceMixProfile);

  const resolvedCpuToDeviceProfileFactors = mergeCpuDeviceProfileFactors(
    DEFAULT_CPU_DEVICE_PROFILE_FACTORS,
    fileCpuToDeviceProfileFactors,
    envCpuToDeviceProfileFactors,
    cliCpuToDeviceProfileFactors,
  );
  const resolvedCpuToDeviceUsageWeights = mergeCpuDeviceUsageWeights(
    baseUsageWeights,
    fileCpuToDeviceUsageWeights,
    envCpuToDeviceUsageWeights,
    cliCpuToDeviceUsageWeights,
  );

  validateCpuDeviceUsageWeights(resolvedCpuToDeviceUsageWeights);

  const cpuToDeviceEnergyFactorBlended =
    resolvedCpuToDeviceProfileFactors.desktop * resolvedCpuToDeviceUsageWeights.desktop +
    resolvedCpuToDeviceProfileFactors.laptop * resolvedCpuToDeviceUsageWeights.laptop +
    resolvedCpuToDeviceProfileFactors.tablet * resolvedCpuToDeviceUsageWeights.tablet +
    resolvedCpuToDeviceProfileFactors.mobile * resolvedCpuToDeviceUsageWeights.mobile;

  const hasExplicitBlendInputs =
    fileCpuToDeviceProfileFactors !== undefined ||
    envCpuToDeviceProfileFactors !== undefined ||
    cliCpuToDeviceProfileFactors !== undefined ||
    fileCpuToDeviceUsageWeights !== undefined ||
    envCpuToDeviceUsageWeights !== undefined ||
    cliCpuToDeviceUsageWeights !== undefined;

  const cpuToDeviceFactorSource: CpuToDeviceFactorSource =
    cliCpuToDeviceEnergyFactor !== undefined
      ? 'scalar-explicit'
      : envCpuToDeviceEnergyFactor !== undefined || fileCpuToDeviceEnergyFactor !== undefined
        ? 'scalar-config'
        : hasExplicitBlendInputs
          ? 'profile-blend-explicit'
          : 'profile-blend-default';

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
      cliCpuToDeviceEnergyFactor ??
      envCpuToDeviceEnergyFactor ??
      fileCpuToDeviceEnergyFactor ??
      cpuToDeviceEnergyFactorBlended,
    cpuToDeviceEnergyFactorBlended,
    cpuToDeviceFactorSource,
    deviceMixProfile: resolvedDeviceMixProfile,
    deviceMixProfileSource,
    cpuToDeviceProfileFactors: resolvedCpuToDeviceProfileFactors,
    cpuToDeviceUsageWeights: resolvedCpuToDeviceUsageWeights,
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

function getDeviceMixWeightsBase(profile: DeviceMixProfileId): CpuDeviceUsageWeights {
  if (profile === 'custom') {
    return DEFAULT_CPU_DEVICE_USAGE_WEIGHTS;
  }

  return DEVICE_MIX_PROFILES[profile];
}

function mergeCpuDeviceProfileFactors(
  base: CpuDeviceProfileFactors,
  fileOverrides?: Partial<CpuDeviceProfileFactors>,
  envOverrides?: Partial<CpuDeviceProfileFactors>,
  cliOverrides?: Partial<CpuDeviceProfileFactors>,
): CpuDeviceProfileFactors {
  return {
    desktop: cliOverrides?.desktop ?? envOverrides?.desktop ?? fileOverrides?.desktop ?? base.desktop,
    laptop: cliOverrides?.laptop ?? envOverrides?.laptop ?? fileOverrides?.laptop ?? base.laptop,
    tablet: cliOverrides?.tablet ?? envOverrides?.tablet ?? fileOverrides?.tablet ?? base.tablet,
    mobile: cliOverrides?.mobile ?? envOverrides?.mobile ?? fileOverrides?.mobile ?? base.mobile,
  };
}

function mergeCpuDeviceUsageWeights(
  base: CpuDeviceUsageWeights,
  fileOverrides?: Partial<CpuDeviceUsageWeights>,
  envOverrides?: Partial<CpuDeviceUsageWeights>,
  cliOverrides?: Partial<CpuDeviceUsageWeights>,
): CpuDeviceUsageWeights {
  return {
    desktop: cliOverrides?.desktop ?? envOverrides?.desktop ?? fileOverrides?.desktop ?? base.desktop,
    laptop: cliOverrides?.laptop ?? envOverrides?.laptop ?? fileOverrides?.laptop ?? base.laptop,
    tablet: cliOverrides?.tablet ?? envOverrides?.tablet ?? fileOverrides?.tablet ?? base.tablet,
    mobile: cliOverrides?.mobile ?? envOverrides?.mobile ?? fileOverrides?.mobile ?? base.mobile,
  };
}

function validateCpuDeviceUsageWeights(weights: CpuDeviceUsageWeights): void {
  const sum = weights.desktop + weights.laptop + weights.tablet + weights.mobile;
  if (Math.abs(sum - 1) > CPU_WEIGHT_TOLERANCE) {
    throw new Error(
      `CPU device usage weights must sum to 1. Received ${sum.toFixed(6)} (desktop=${weights.desktop}, laptop=${weights.laptop}, tablet=${weights.tablet}, mobile=${weights.mobile}).`,
    );
  }
}

function parseCpuDeviceProfileFactorsFromUnknown(
  raw: unknown,
  sourceLabel: string,
): Partial<CpuDeviceProfileFactors> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${sourceLabel} must be an object with keys desktop,laptop,tablet,mobile.`);
  }

  const value = raw as Record<string, unknown>;
  const knownKeys = new Set(['desktop', 'laptop', 'tablet', 'mobile']);
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) {
      throw new Error(`${sourceLabel} contains unsupported key '${key}'. Allowed keys: desktop,laptop,tablet,mobile.`);
    }
  }

  const parsed: Partial<CpuDeviceProfileFactors> = {};
  for (const key of ['desktop', 'laptop', 'tablet', 'mobile'] as const) {
    if (value[key] === undefined) {
      continue;
    }
    const parsedValue = parsePositiveNumber(value[key]);
    if (parsedValue === undefined) {
      throw new Error(`${sourceLabel}.${key} must be a positive number.`);
    }
    parsed[key] = parsedValue;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCpuDeviceUsageWeightsFromUnknown(
  raw: unknown,
  sourceLabel: string,
): Partial<CpuDeviceUsageWeights> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${sourceLabel} must be an object with keys desktop,laptop,tablet,mobile.`);
  }

  const value = raw as Record<string, unknown>;
  const knownKeys = new Set(['desktop', 'laptop', 'tablet', 'mobile']);
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) {
      throw new Error(`${sourceLabel} contains unsupported key '${key}'. Allowed keys: desktop,laptop,tablet,mobile.`);
    }
  }

  const parsed: Partial<CpuDeviceUsageWeights> = {};
  for (const key of ['desktop', 'laptop', 'tablet', 'mobile'] as const) {
    if (value[key] === undefined) {
      continue;
    }
    const parsedValue = parseRatio(value[key]);
    if (parsedValue === undefined) {
      throw new Error(`${sourceLabel}.${key} must be a number between 0 and 1.`);
    }
    parsed[key] = parsedValue;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCpuDeviceProfileFactorsFromString(
  raw: string | undefined,
  sourceLabel: string,
): Partial<CpuDeviceProfileFactors> | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = parseKeyValueMap(raw, sourceLabel);
  const result: Partial<CpuDeviceProfileFactors> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (key !== 'desktop' && key !== 'laptop' && key !== 'tablet' && key !== 'mobile') {
      throw new Error(`${sourceLabel} contains unsupported key '${key}'. Allowed keys: desktop,laptop,tablet,mobile.`);
    }
    const numeric = parsePositiveNumber(value);
    if (numeric === undefined) {
      throw new Error(`${sourceLabel} value for '${key}' must be a positive number.`);
    }
    result[key] = numeric;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseCpuDeviceUsageWeightsFromString(
  raw: string | undefined,
  sourceLabel: string,
): Partial<CpuDeviceUsageWeights> | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = parseKeyValueMap(raw, sourceLabel);
  const result: Partial<CpuDeviceUsageWeights> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (key !== 'desktop' && key !== 'laptop' && key !== 'tablet' && key !== 'mobile') {
      throw new Error(`${sourceLabel} contains unsupported key '${key}'. Allowed keys: desktop,laptop,tablet,mobile.`);
    }
    const numeric = parseRatio(value);
    if (numeric === undefined) {
      throw new Error(`${sourceLabel} value for '${key}' must be a number between 0 and 1.`);
    }
    result[key] = numeric;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseKeyValueMap(raw: string, sourceLabel: string): Record<string, string> {
  const pairs = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (pairs.length === 0) {
    throw new Error(`${sourceLabel} must contain comma-separated key:value pairs.`);
  }

  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const [rawKey, rawValue, ...rest] = pair.split(':');
    if (!rawKey || !rawValue || rest.length > 0) {
      throw new Error(`${sourceLabel} entry '${pair}' is invalid. Expected key:value.`);
    }

    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (!key || !value) {
      throw new Error(`${sourceLabel} entry '${pair}' is invalid. Expected non-empty key:value.`);
    }

    result[key] = value;
  }

  return result;
}

export async function resolveReportingConfig(
  options: ResolveRuntimeConfigOptions = {},
): Promise<ReportingConfig> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const fileConfig = await readConfigFile(workingDirectory);

  const fileBudgets = parseReportingBudgetsFromFile(fileConfig?.reporting?.budgets);
  const envBudgets = parseReportingBudgetsFromEnv();
  const budgets = mergeBudgets(fileBudgets, envBudgets);

  const fileScoreThresholds = parseScoreThresholdsFromFile(fileConfig?.reporting?.scoreThresholds);
  const envScoreThresholds = parseScoreThresholdsFromEnv();
  const scoreThresholds = {
    ...(fileScoreThresholds ?? {}),
    ...(envScoreThresholds ?? {}),
  };

  const fileOutput = parseOutputSettingsFromFile(fileConfig?.reporting?.output);
  const envOutput = parseOutputSettingsFromEnv();
  const output = mergeOutputSettings(fileOutput, envOutput);

  return {
    budgets,
    scoreThresholds: hasScoreThresholdValues(scoreThresholds) ? scoreThresholds : undefined,
    output,
  };
}

function parseCpuCurveProfile(value: unknown): CpuCurveProfileId | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'if-default' || normalized === 'realistic') {
    return 'realistic';
  }

  if (normalized === 'conservative' || normalized === 'aggressive' || normalized === 'linear') {
    return normalized;
  }

  return undefined;
}

function parseDeviceMixProfile(value: unknown): DeviceMixProfileId | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'enterprise' ||
    normalized === 'consumer' ||
    normalized === 'mobile-first' ||
    normalized === 'desktop-first' ||
    normalized === 'custom'
  ) {
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

function parseReportingBudgetsFromFile(raw?: ImpactTraceConfigFile['reporting'] extends infer T
  ? T extends { budgets?: infer U }
    ? U
    : never
  : never): ImpactBudgets | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const transferBytes = parsePositiveNumber(raw.transferBytes);
  const transferMb = parsePositiveNumber(raw.transferMb);
  const thirdPartyBytes = parsePositiveNumber(raw.thirdPartyBytes);
  const thirdPartyMb = parsePositiveNumber(raw.thirdPartyMb);

  return compactBudgets({
    carbonGrams: parsePositiveNumber(raw.carbonGrams),
    transferBytes: transferBytes ?? toBytesFromMb(transferMb),
    cpuSeconds: parsePositiveNumber(raw.cpuSeconds),
    thirdPartyBytes: thirdPartyBytes ?? toBytesFromMb(thirdPartyMb),
  });
}

function parseReportingBudgetsFromEnv(): ImpactBudgets | undefined {
  const transferBytes =
    parsePositiveNumber(process.env.IMPACT_TRACE_BUDGET_TRANSFER_BYTES) ??
    toBytesFromMb(parsePositiveNumber(process.env.IMPACT_TRACE_BUDGET_TRANSFER_MB));
  const thirdPartyBytes =
    parsePositiveNumber(process.env.IMPACT_TRACE_BUDGET_THIRD_PARTY_BYTES) ??
    toBytesFromMb(parsePositiveNumber(process.env.IMPACT_TRACE_BUDGET_THIRD_PARTY_MB));

  return compactBudgets({
    carbonGrams: parsePositiveNumber(process.env.IMPACT_TRACE_BUDGET_CARBON_GRAMS),
    transferBytes,
    cpuSeconds: parsePositiveNumber(process.env.IMPACT_TRACE_BUDGET_CPU_SECONDS),
    thirdPartyBytes,
  });
}

function parseScoreThresholdsFromFile(raw?: ImpactTraceConfigFile['reporting'] extends infer T
  ? T extends { scoreThresholds?: infer U }
    ? U
    : never
  : never): Partial<ImpactScoreThresholds> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const thresholds = {
    A: parsePositiveNumber(raw.A),
    B: parsePositiveNumber(raw.B),
    C: parsePositiveNumber(raw.C),
    D: parsePositiveNumber(raw.D),
    E: parsePositiveNumber(raw.E),
  };

  return hasScoreThresholdValues(thresholds) ? thresholds : undefined;
}

function parseScoreThresholdsFromEnv(): Partial<ImpactScoreThresholds> | undefined {
  const csv = process.env.IMPACT_TRACE_SCORE_THRESHOLDS;
  if (csv) {
    const parsed = parseScoreThresholdCsv(csv);
    if (parsed) {
      return parsed;
    }
  }

  const thresholds = {
    A: parsePositiveNumber(process.env.IMPACT_TRACE_SCORE_THRESHOLD_A),
    B: parsePositiveNumber(process.env.IMPACT_TRACE_SCORE_THRESHOLD_B),
    C: parsePositiveNumber(process.env.IMPACT_TRACE_SCORE_THRESHOLD_C),
    D: parsePositiveNumber(process.env.IMPACT_TRACE_SCORE_THRESHOLD_D),
    E: parsePositiveNumber(process.env.IMPACT_TRACE_SCORE_THRESHOLD_E),
  };

  return hasScoreThresholdValues(thresholds) ? thresholds : undefined;
}

function parseScoreThresholdCsv(raw: string): Partial<ImpactScoreThresholds> | undefined {
  const values = raw.split(',').map((item) => parsePositiveNumber(item.trim()));
  if (values.length !== 5 || values.some((value) => value === undefined)) {
    return undefined;
  }

  return {
    A: values[0],
    B: values[1],
    C: values[2],
    D: values[3],
    E: values[4],
  };
}

function parseOutputSettingsFromFile(raw?: ImpactTraceConfigFile['reporting'] extends infer T
  ? T extends { output?: infer U }
    ? U
    : never
  : never): ReportingOutputSettings | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const settings: ReportingOutputSettings = {
    defaultFormat: parseOutputFormat(raw.defaultFormat),
    findingsLimit: parsePositiveInteger(raw.findingsLimit),
    githubCommentMaxLines: parsePositiveInteger(raw.githubCommentMaxLines),
  };

  return compactOutputSettings(settings);
}

function parseOutputSettingsFromEnv(): ReportingOutputSettings | undefined {
  const settings: ReportingOutputSettings = {
    defaultFormat: parseOutputFormat(process.env.IMPACT_TRACE_REPORT_FORMAT),
    findingsLimit: parsePositiveInteger(process.env.IMPACT_TRACE_FINDINGS_LIMIT),
    githubCommentMaxLines: parsePositiveInteger(process.env.IMPACT_TRACE_GITHUB_COMMENT_MAX_LINES),
  };

  return compactOutputSettings(settings);
}

function parseOutputFormat(value: unknown): ReportingOutputFormat | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'console' || normalized === 'json' || normalized === 'github-pr') {
    return normalized;
  }

  return undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function toBytesFromMb(mb?: number): number | undefined {
  if (mb === undefined) {
    return undefined;
  }
  return mb * 1024 * 1024;
}

function compactBudgets(input: ImpactBudgets): ImpactBudgets | undefined {
  const budgets: ImpactBudgets = {
    ...(input.carbonGrams !== undefined ? { carbonGrams: input.carbonGrams } : {}),
    ...(input.transferBytes !== undefined ? { transferBytes: input.transferBytes } : {}),
    ...(input.cpuSeconds !== undefined ? { cpuSeconds: input.cpuSeconds } : {}),
    ...(input.thirdPartyBytes !== undefined ? { thirdPartyBytes: input.thirdPartyBytes } : {}),
  };

  return Object.keys(budgets).length > 0 ? budgets : undefined;
}

function mergeBudgets(base?: ImpactBudgets, overrides?: ImpactBudgets): ImpactBudgets | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  return compactBudgets({
    carbonGrams: overrides?.carbonGrams ?? base?.carbonGrams,
    transferBytes: overrides?.transferBytes ?? base?.transferBytes,
    cpuSeconds: overrides?.cpuSeconds ?? base?.cpuSeconds,
    thirdPartyBytes: overrides?.thirdPartyBytes ?? base?.thirdPartyBytes,
  });
}

function compactOutputSettings(value: ReportingOutputSettings): ReportingOutputSettings | undefined {
  const compacted: ReportingOutputSettings = {
    ...(value.defaultFormat !== undefined ? { defaultFormat: value.defaultFormat } : {}),
    ...(value.findingsLimit !== undefined ? { findingsLimit: value.findingsLimit } : {}),
    ...(value.githubCommentMaxLines !== undefined ? { githubCommentMaxLines: value.githubCommentMaxLines } : {}),
  };

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function mergeOutputSettings(base?: ReportingOutputSettings, overrides?: ReportingOutputSettings): ReportingOutputSettings | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  return compactOutputSettings({
    defaultFormat: overrides?.defaultFormat ?? base?.defaultFormat,
    findingsLimit: overrides?.findingsLimit ?? base?.findingsLimit,
    githubCommentMaxLines: overrides?.githubCommentMaxLines ?? base?.githubCommentMaxLines,
  });
}

function hasScoreThresholdValues(value: Partial<ImpactScoreThresholds>): boolean {
  return value.A !== undefined || value.B !== undefined || value.C !== undefined || value.D !== undefined || value.E !== undefined;
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
