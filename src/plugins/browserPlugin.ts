import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Response } from 'playwright';
import type { CarbonMetric, CpuMeasurementMode, MeasurementPlugin, RunContext } from '../types/index.js';

const PAGE_KEY = 'playwrightPage';
const RUN_LABEL_KEY = 'impactTraceRunLabel';
const CDP_SESSION_KEY = 'impactTraceCdpSession';
const BROWSER_CDP_SESSION_KEY = 'impactTraceBrowserCdpSession';
const CPU_MODE_KEY = 'impactTraceCpuMeasurementMode';
const CPU_METRIC_STARTS_KEY = 'impactTraceCpuMetricStarts';
const CPU_METRIC_TOTALS_KEY = 'impactTraceCpuMetricTotals';
const CPU_WINDOW_STARTS_KEY = 'impactTraceCpuWindowStarts';
const CPU_WINDOW_TOTALS_KEY = 'impactTraceCpuWindowTotals';
const CPU_PROCESS_ACTIVE_LABELS_KEY = 'impactTraceCpuProcessActiveLabels';
const CPU_PROCESS_LAST_SNAPSHOT_KEY = 'impactTraceCpuProcessLastSnapshot';
const CPU_PROCESS_SAMPLER_TIMER_KEY = 'impactTraceCpuProcessSamplerTimer';
const CPU_PROCESS_SAMPLER_ERROR_LOGGED_KEY = 'impactTraceCpuProcessSamplerErrorLogged';

const PROCESS_SAMPLE_INTERVAL_MS = 250;

type RunLabel = 'single-run' | 'new-user' | 'returning-user';

export class BrowserPlugin implements MeasurementPlugin {
  name = 'browser';

  private browser?: Browser;
  private browserContext?: BrowserContext;
  private page?: Page;
  private readonly metrics: CarbonMetric[] = [];
  private responseListener?: (response: Response) => void;
  private context?: RunContext;
  private cdpSession?: CDPSession;
  private browserCdpSession?: CDPSession;

  async start(context: RunContext): Promise<void> {
    this.context = context;
    this.browser = await chromium.launch({ headless: true });
    this.browserContext = await this.browser.newContext();
    this.page = await this.browserContext.newPage();

    this.responseListener = (response: Response) => {
      void this.captureResponseMetric(response);
    };

    this.page.on('response', this.responseListener);

    this.cdpSession = await this.browserContext.newCDPSession(this.page);
    await this.cdpSession.send('Performance.enable');
    this.browserCdpSession = await this.browser.newBrowserCDPSession();

    context.data.set(CDP_SESSION_KEY, this.cdpSession);
    context.data.set(BROWSER_CDP_SESSION_KEY, this.browserCdpSession);
    context.data.set(CPU_METRIC_STARTS_KEY, new Map<RunLabel, number>());
    context.data.set(CPU_METRIC_TOTALS_KEY, new Map<RunLabel, number>());
    context.data.set(CPU_WINDOW_STARTS_KEY, new Map<RunLabel, number>());
    context.data.set(CPU_WINDOW_TOTALS_KEY, new Map<RunLabel, number>());
    context.data.set(CPU_PROCESS_ACTIVE_LABELS_KEY, new Set<RunLabel>());
    context.data.set(CPU_PROCESS_LAST_SNAPSHOT_KEY, new Map<number, number>());
    context.data.set(CPU_PROCESS_SAMPLER_ERROR_LOGGED_KEY, false);
    context.data.set(PAGE_KEY, this.page);
  }

  async stop(): Promise<CarbonMetric[]> {
    if (this.page) {
      if (this.responseListener) {
        this.page.off('response', this.responseListener);
      }

      if (getCpuMeasurementMode(this.context) === 'process-info') {
        await sampleProcessCpuTotals(this.context, this.browserCdpSession);
      }

      const totals = getCpuTotalsMap(this.context);
      const windows = getCpuWindowTotalsMap(this.context);
      const currentPageUrl = this.page.url();
      const now = Date.now();

      for (const [runLabel, cpuTimeMs] of totals.entries()) {
        if (cpuTimeMs <= 0) {
          continue;
        }

        this.metrics.push({
          source: 'browser',
          timestampStart: now,
          timestampEnd: now,
          cpuTimeMs,
          metadata: {
            url: currentPageUrl,
            runLabel,
            cpuMeasurementWindowMs: windows.get(runLabel) ?? 0,
          },
        });
      }
    }

    stopProcessCpuSampling(this.context);
    await this.browserCdpSession?.detach().catch(() => undefined);

    await this.browserContext?.close();
    await this.browser?.close();

    return [...this.metrics];
  }

  private async captureResponseMetric(response: Response): Promise<void> {
    const timestamp = Date.now();
    const url = response.url();
    const resourceType = response.request().resourceType();
    const runLabel = getRunLabel(this.context);

    let transferBytes = 0;
    try {
      const sizes = await response.request().sizes();
      transferBytes = sizes.responseBodySize + sizes.responseHeadersSize;
    } catch {
      const contentLengthHeader = response.headers()['content-length'];
      transferBytes = Number.parseInt(contentLengthHeader ?? '0', 10) || 0;
    }

    const headers = response.headers();
    const cached =
      response.status() === 304 ||
      response.fromServiceWorker() ||
      (headers['x-cache']?.toLowerCase().includes('hit') ?? false);

    this.metrics.push({
      source: 'network',
      timestampStart: timestamp,
      timestampEnd: timestamp,
      networkBytes: transferBytes,
      metadata: {
        url,
        resourceType,
        cached,
        runLabel,
      },
    });
  }
}

function getRunLabel(context?: RunContext): RunLabel {
  const value = context?.data.get(RUN_LABEL_KEY);
  if (value === 'new-user' || value === 'returning-user' || value === 'single-run') {
    return value;
  }
  return 'single-run';
}

function getCpuStartsMap(context?: RunContext): Map<RunLabel, number> {
  const value = context?.data.get(CPU_METRIC_STARTS_KEY);
  if (value instanceof Map) {
    return value as Map<RunLabel, number>;
  }
  return new Map<RunLabel, number>();
}

function getCpuTotalsMap(context?: RunContext): Map<RunLabel, number> {
  const value = context?.data.get(CPU_METRIC_TOTALS_KEY);
  if (value instanceof Map) {
    return value as Map<RunLabel, number>;
  }
  return new Map<RunLabel, number>();
}

function getCpuWindowStartsMap(context?: RunContext): Map<RunLabel, number> {
  const value = context?.data.get(CPU_WINDOW_STARTS_KEY);
  if (value instanceof Map) {
    return value as Map<RunLabel, number>;
  }
  return new Map<RunLabel, number>();
}

function getCpuWindowTotalsMap(context?: RunContext): Map<RunLabel, number> {
  const value = context?.data.get(CPU_WINDOW_TOTALS_KEY);
  if (value instanceof Map) {
    return value as Map<RunLabel, number>;
  }
  return new Map<RunLabel, number>();
}

function beginCpuWindow(context: RunContext, label: RunLabel): void {
  const starts = getCpuWindowStartsMap(context);
  starts.set(label, Date.now());
  context.data.set(CPU_WINDOW_STARTS_KEY, starts);
}

function endCpuWindow(context: RunContext, label: RunLabel): void {
  const starts = getCpuWindowStartsMap(context);
  const startValue = starts.get(label);
  if (startValue === undefined) {
    return;
  }

  const deltaMs = Math.max(0, Date.now() - startValue);
  const totals = getCpuWindowTotalsMap(context);
  totals.set(label, (totals.get(label) ?? 0) + deltaMs);
  context.data.set(CPU_WINDOW_TOTALS_KEY, totals);

  starts.delete(label);
  context.data.set(CPU_WINDOW_STARTS_KEY, starts);
}

function getCdpSession(context?: RunContext): CDPSession | undefined {
  const value = context?.data.get(CDP_SESSION_KEY);
  if (!value) {
    return undefined;
  }
  return value as CDPSession;
}

function getBrowserCdpSession(context?: RunContext): CDPSession | undefined {
  const value = context?.data.get(BROWSER_CDP_SESSION_KEY);
  if (!value) {
    return undefined;
  }
  return value as CDPSession;
}

function getCpuMeasurementMode(context?: RunContext): CpuMeasurementMode {
  const value = context?.data.get(CPU_MODE_KEY);
  return value === 'process-info' ? 'process-info' : 'thread-time';
}

function getCpuProcessActiveLabels(context?: RunContext): Set<RunLabel> {
  const value = context?.data.get(CPU_PROCESS_ACTIVE_LABELS_KEY);
  if (value instanceof Set) {
    return value as Set<RunLabel>;
  }
  return new Set<RunLabel>();
}

function getCpuProcessLastSnapshot(context?: RunContext): Map<number, number> {
  const value = context?.data.get(CPU_PROCESS_LAST_SNAPSHOT_KEY);
  if (value instanceof Map) {
    return value as Map<number, number>;
  }
  return new Map<number, number>();
}

function getCpuProcessSamplerTimer(context?: RunContext): ReturnType<typeof setInterval> | undefined {
  const value = context?.data.get(CPU_PROCESS_SAMPLER_TIMER_KEY);
  return value as ReturnType<typeof setInterval> | undefined;
}

async function getThreadTimeSeconds(session: CDPSession): Promise<number> {
  const metrics = await session.send('Performance.getMetrics');
  const threadTime = metrics.metrics.find((metric) => metric.name === 'ThreadTime');
  return threadTime?.value ?? 0;
}

interface SystemInfoProcessEntry {
  id?: number;
  cpuTime?: number;
}

interface SystemInfoProcessInfoResponse {
  processInfo?: SystemInfoProcessEntry[];
}

async function sampleProcessCpuTotals(context: RunContext | undefined, browserSession?: CDPSession): Promise<void> {
  if (!context || !browserSession) {
    return;
  }

  const activeLabels = getCpuProcessActiveLabels(context);
  if (activeLabels.size === 0) {
    return;
  }

  try {
    const response = await browserSession.send('SystemInfo.getProcessInfo') as SystemInfoProcessInfoResponse;
    const currentSnapshot = new Map<number, number>();

    for (const processInfo of response.processInfo ?? []) {
      if (typeof processInfo.id !== 'number' || typeof processInfo.cpuTime !== 'number') {
        continue;
      }
      if (!Number.isFinite(processInfo.cpuTime) || processInfo.cpuTime < 0) {
        continue;
      }
      currentSnapshot.set(processInfo.id, processInfo.cpuTime);
    }

    const previousSnapshot = getCpuProcessLastSnapshot(context);
    if (previousSnapshot.size === 0) {
      context.data.set(CPU_PROCESS_LAST_SNAPSHOT_KEY, currentSnapshot);
      return;
    }

    let deltaSeconds = 0;
    for (const [processId, currentCpuTime] of currentSnapshot.entries()) {
      const previousCpuTime = previousSnapshot.get(processId);
      if (previousCpuTime === undefined) {
        continue;
      }
      const delta = currentCpuTime - previousCpuTime;
      if (delta > 0) {
        deltaSeconds += delta;
      }
    }

    if (deltaSeconds > 0) {
      const deltaMs = deltaSeconds * 1000;
      const totals = getCpuTotalsMap(context);
      for (const label of activeLabels) {
        totals.set(label, (totals.get(label) ?? 0) + deltaMs);
      }
      context.data.set(CPU_METRIC_TOTALS_KEY, totals);
    }

    context.data.set(CPU_PROCESS_LAST_SNAPSHOT_KEY, currentSnapshot);
  } catch {
    const logged = context.data.get(CPU_PROCESS_SAMPLER_ERROR_LOGGED_KEY);
    if (logged !== true) {
      context.data.set(CPU_PROCESS_SAMPLER_ERROR_LOGGED_KEY, true);
      console.warn('ImpactTrace: process-info CPU sampling failed, falling back to sampled thread-time totals where available.');
    }
  }
}

function startProcessCpuSampling(context: RunContext, browserSession?: CDPSession): void {
  if (!browserSession || getCpuProcessSamplerTimer(context)) {
    return;
  }

  const timer = setInterval(() => {
    void sampleProcessCpuTotals(context, browserSession);
  }, PROCESS_SAMPLE_INTERVAL_MS);

  context.data.set(CPU_PROCESS_SAMPLER_TIMER_KEY, timer);
}

function stopProcessCpuSampling(context?: RunContext): void {
  if (!context) {
    return;
  }

  const timer = getCpuProcessSamplerTimer(context);
  if (timer) {
    clearInterval(timer);
    context.data.delete(CPU_PROCESS_SAMPLER_TIMER_KEY);
  }
}

export function getPageFromContext(context: RunContext): Page {
  const page = context.data.get(PAGE_KEY);
  if (!page) {
    throw new Error('No Playwright page found in run context. Ensure BrowserPlugin is registered.');
  }
  return page as Page;
}

export function setRunLabelInContext(
  context: RunContext,
  label: RunLabel,
): void {
  context.data.set(RUN_LABEL_KEY, label);
}

export function setCpuMeasurementModeInContext(
  context: RunContext,
  mode: CpuMeasurementMode,
): void {
  context.data.set(CPU_MODE_KEY, mode);
}

export async function beginCpuMeasurementForRunLabel(context: RunContext, label: RunLabel): Promise<void> {
  setRunLabelInContext(context, label);
  beginCpuWindow(context, label);

  if (getCpuMeasurementMode(context) === 'process-info') {
    const activeLabels = getCpuProcessActiveLabels(context);
    activeLabels.add(label);
    context.data.set(CPU_PROCESS_ACTIVE_LABELS_KEY, activeLabels);

    const browserSession = getBrowserCdpSession(context);
    await sampleProcessCpuTotals(context, browserSession);
    startProcessCpuSampling(context, browserSession);
    return;
  }

  const session = getCdpSession(context);
  if (!session) {
    return;
  }

  const starts = getCpuStartsMap(context);
  starts.set(label, await getThreadTimeSeconds(session));
  context.data.set(CPU_METRIC_STARTS_KEY, starts);
}

export async function endCpuMeasurementForRunLabel(context: RunContext, label: RunLabel): Promise<void> {
  if (getCpuMeasurementMode(context) === 'process-info') {
    await sampleProcessCpuTotals(context, getBrowserCdpSession(context));
    const activeLabels = getCpuProcessActiveLabels(context);
    activeLabels.delete(label);
    context.data.set(CPU_PROCESS_ACTIVE_LABELS_KEY, activeLabels);
    if (activeLabels.size === 0) {
      stopProcessCpuSampling(context);
      context.data.set(CPU_PROCESS_LAST_SNAPSHOT_KEY, new Map<number, number>());
    }
    endCpuWindow(context, label);
    return;
  }

  const session = getCdpSession(context);
  if (!session) {
    return;
  }

  const starts = getCpuStartsMap(context);
  const startValue = starts.get(label);
  if (startValue === undefined) {
    return;
  }

  const endValue = await getThreadTimeSeconds(session);
  const deltaMs = Math.max(0, (endValue - startValue) * 1000);

  const totals = getCpuTotalsMap(context);
  totals.set(label, (totals.get(label) ?? 0) + deltaMs);

  context.data.set(CPU_METRIC_TOTALS_KEY, totals);
  starts.delete(label);
  context.data.set(CPU_METRIC_STARTS_KEY, starts);
  endCpuWindow(context, label);
}

export async function clearBrowserCacheFromContext(context: RunContext): Promise<void> {
  const page = getPageFromContext(context);
  const browserContext = page.context();

  // CDP cache clearing gives us a deterministic cold-start baseline for comparison mode.
  const client = await browserContext.newCDPSession(page);
  try {
    await client.send('Network.enable');
    await client.send('Network.clearBrowserCache');
    await client.send('Network.clearBrowserCookies');
    await browserContext.clearCookies();
  } finally {
    await client.detach();
  }
}
