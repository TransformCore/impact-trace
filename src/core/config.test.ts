import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveReportingConfig, resolveRuntimeConfig } from './config.js';

const CONFIG_FILE = 'impact-trace.config.json';

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-trace-config-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function withEnv<T>(variables: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(variables)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test('resolveReportingConfig loads budgets and score thresholds from config file', async () => {
  await withTempDir(async (workingDirectory) => {
    await fs.writeFile(
      path.join(workingDirectory, CONFIG_FILE),
      JSON.stringify(
        {
          reporting: {
            budgets: {
              carbonGrams: 2,
              transferMb: 10,
              cpuSeconds: 1,
              thirdPartyMb: 1,
            },
            scoreThresholds: {
              A: 0.4,
              B: 0.9,
              C: 1.9,
              D: 4.9,
              E: 9.9,
            },
            output: {
              defaultFormat: 'github-pr',
              findingsLimit: 4,
              githubCommentMaxLines: 20,
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const config = await resolveReportingConfig({ workingDirectory });

    assert.equal(config.budgets?.carbonGrams, 2);
    assert.equal(config.budgets?.transferBytes, 10 * 1024 * 1024);
    assert.equal(config.budgets?.cpuSeconds, 1);
    assert.equal(config.budgets?.thirdPartyBytes, 1 * 1024 * 1024);
    assert.deepEqual(config.scoreThresholds, {
      A: 0.4,
      B: 0.9,
      C: 1.9,
      D: 4.9,
      E: 9.9,
    });
    assert.deepEqual(config.output, {
      defaultFormat: 'github-pr',
      findingsLimit: 4,
      githubCommentMaxLines: 20,
    });
  });
});

test('resolveReportingConfig applies env overrides over config values', async () => {
  await withTempDir(async (workingDirectory) => {
    await fs.writeFile(
      path.join(workingDirectory, CONFIG_FILE),
      JSON.stringify(
        {
          reporting: {
            budgets: {
              carbonGrams: 2,
              transferMb: 10,
            },
            scoreThresholds: {
              A: 0.5,
              B: 1,
              C: 2,
              D: 5,
              E: 10,
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    await withEnv(
      {
        IMPACT_TRACE_BUDGET_CARBON_GRAMS: '1.8',
        IMPACT_TRACE_BUDGET_TRANSFER_MB: '8',
        IMPACT_TRACE_SCORE_THRESHOLDS: '0.3,0.8,1.8,4.8,9.8',
        IMPACT_TRACE_REPORT_FORMAT: 'json',
        IMPACT_TRACE_FINDINGS_LIMIT: '3',
        IMPACT_TRACE_GITHUB_COMMENT_MAX_LINES: '12',
      },
      async () => {
        const config = await resolveReportingConfig({ workingDirectory });

        assert.equal(config.budgets?.carbonGrams, 1.8);
        assert.equal(config.budgets?.transferBytes, 8 * 1024 * 1024);
        assert.deepEqual(config.scoreThresholds, {
          A: 0.3,
          B: 0.8,
          C: 1.8,
          D: 4.8,
          E: 9.8,
        });
        assert.deepEqual(config.output, {
          defaultFormat: 'json',
          findingsLimit: 3,
          githubCommentMaxLines: 12,
        });
      },
    );
  });
});

test('resolveRuntimeConfig uses blended CPU device defaults when scalar factor is not set', async () => {
  await withTempDir(async (workingDirectory) => {
    await withEnv(
      {
        IMPACT_TRACE_CPU_TO_DEVICE_ENERGY_FACTOR: undefined,
        IMPACT_TRACE_CPU_TO_DEVICE_PROFILE_FACTORS: undefined,
        IMPACT_TRACE_CPU_TO_DEVICE_USAGE_WEIGHTS: undefined,
      },
      async () => {
        const config = await resolveRuntimeConfig({ workingDirectory });

        assert.equal(config.cpuToDeviceFactorSource, 'profile-blend-default');
        assert.deepEqual(config.cpuToDeviceProfileFactors, {
          desktop: 2.4,
          laptop: 1.8,
          tablet: 1.5,
          mobile: 1.3,
        });
        assert.deepEqual(config.cpuToDeviceUsageWeights, {
          desktop: 0.35,
          laptop: 0.35,
          tablet: 0.1,
          mobile: 0.2,
        });
        approxEqual(config.cpuToDeviceEnergyFactorBlended, 1.88);
        approxEqual(config.cpuToDeviceEnergyFactor, 1.88);
      },
    );
  });
});

test('resolveRuntimeConfig keeps scalar factor precedence over blended profile factor', async () => {
  await withTempDir(async (workingDirectory) => {
    await fs.writeFile(
      path.join(workingDirectory, CONFIG_FILE),
      JSON.stringify(
        {
          cpuToDeviceEnergyFactor: 2.6,
          cpuToDeviceEnergyProfileFactors: {
            desktop: 3,
            laptop: 2,
            tablet: 1.5,
            mobile: 1,
          },
          cpuToDeviceUsageWeights: {
            desktop: 0.25,
            laptop: 0.25,
            tablet: 0.25,
            mobile: 0.25,
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const config = await resolveRuntimeConfig({ workingDirectory });

    assert.equal(config.cpuToDeviceFactorSource, 'scalar-config');
    assert.equal(config.cpuToDeviceEnergyFactor, 2.6);
    assert.equal(config.cpuToDeviceEnergyFactorBlended, 1.875);
  });
});

test('resolveRuntimeConfig applies env profile factors and usage weights', async () => {
  await withTempDir(async (workingDirectory) => {
    await withEnv(
      {
        IMPACT_TRACE_CPU_TO_DEVICE_ENERGY_FACTOR: undefined,
        IMPACT_TRACE_CPU_TO_DEVICE_PROFILE_FACTORS: 'desktop:2.5,laptop:2,tablet:1.5,mobile:1',
        IMPACT_TRACE_CPU_TO_DEVICE_USAGE_WEIGHTS: 'desktop:0.4,laptop:0.4,tablet:0.1,mobile:0.1',
      },
      async () => {
        const config = await resolveRuntimeConfig({ workingDirectory });

        assert.equal(config.cpuToDeviceFactorSource, 'profile-blend-explicit');
        assert.deepEqual(config.cpuToDeviceProfileFactors, {
          desktop: 2.5,
          laptop: 2,
          tablet: 1.5,
          mobile: 1,
        });
        assert.deepEqual(config.cpuToDeviceUsageWeights, {
          desktop: 0.4,
          laptop: 0.4,
          tablet: 0.1,
          mobile: 0.1,
        });
        approxEqual(config.cpuToDeviceEnergyFactorBlended, 2.05);
        approxEqual(config.cpuToDeviceEnergyFactor, 2.05);
      },
    );
  });
});

test('resolveRuntimeConfig rejects invalid CPU device usage weights sum', async () => {
  await withTempDir(async (workingDirectory) => {
    await withEnv(
      {
        IMPACT_TRACE_CPU_TO_DEVICE_USAGE_WEIGHTS: 'desktop:0.4,laptop:0.4,tablet:0.2,mobile:0.2',
      },
      async () => {
        await assert.rejects(
          () => resolveRuntimeConfig({ workingDirectory }),
          /must sum to 1/,
        );
      },
    );
  });
});

test('resolveRuntimeConfig supports cpu block device mix preset', async () => {
  await withTempDir(async (workingDirectory) => {
    await fs.writeFile(
      path.join(workingDirectory, CONFIG_FILE),
      JSON.stringify(
        {
          cpu: {
            deviceMix: 'consumer',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const config = await resolveRuntimeConfig({ workingDirectory });

    assert.equal(config.deviceMixProfile, 'consumer');
    assert.equal(config.deviceMixProfileSource, 'explicit');
    assert.deepEqual(config.cpuToDeviceUsageWeights, {
      desktop: 0.25,
      laptop: 0.2,
      tablet: 0.05,
      mobile: 0.5,
    });
  });
});

test('resolveRuntimeConfig supports cpu block curve and normalizes if-default alias', async () => {
  await withTempDir(async (workingDirectory) => {
    await fs.writeFile(
      path.join(workingDirectory, CONFIG_FILE),
      JSON.stringify(
        {
          cpu: {
            curve: 'if-default',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const config = await resolveRuntimeConfig({ workingDirectory });

    assert.equal(config.cpuCurveProfile, 'realistic');
  });
});
