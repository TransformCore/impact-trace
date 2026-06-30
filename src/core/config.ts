import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_FILE_NAME = 'impact-trace.config.json';
const DEFAULT_CPU_WATTS = 20;
const DEFAULT_CPU_MEASUREMENT_SECONDS = 3;

interface ImpactTraceConfigFile {
  cpuWatts?: unknown;
  cpuMeasurementSeconds?: unknown;
}

export interface RuntimeConfig {
  cpuWatts: number;
  cpuMeasurementSeconds: number;
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

  const envCpuMeasurementSeconds = parsePositiveNumber(process.env.IMPACT_TRACE_CPU_MEASUREMENT_SECONDS);
  const fileCpuMeasurementSeconds = parsePositiveNumber(fileConfig?.cpuMeasurementSeconds);

  return {
    cpuWatts: envCpuWatts ?? fileCpuWatts ?? DEFAULT_CPU_WATTS,
    cpuMeasurementSeconds:
      envCpuMeasurementSeconds ?? fileCpuMeasurementSeconds ?? DEFAULT_CPU_MEASUREMENT_SECONDS,
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

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
