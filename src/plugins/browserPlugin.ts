import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Response } from 'playwright';
import type { CarbonMetric, MeasurementPlugin, RunContext } from '../types/index.js';

const PAGE_KEY = 'playwrightPage';
const RUN_LABEL_KEY = 'impactTraceRunLabel';
const CDP_SESSION_KEY = 'impactTraceCdpSession';
const CPU_METRIC_STARTS_KEY = 'impactTraceCpuMetricStarts';
const CPU_METRIC_TOTALS_KEY = 'impactTraceCpuMetricTotals';

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

    context.data.set(CDP_SESSION_KEY, this.cdpSession);
    context.data.set(CPU_METRIC_STARTS_KEY, new Map<RunLabel, number>());
    context.data.set(CPU_METRIC_TOTALS_KEY, new Map<RunLabel, number>());
    context.data.set(PAGE_KEY, this.page);
  }

  async stop(): Promise<CarbonMetric[]> {
    if (this.page) {
      if (this.responseListener) {
        this.page.off('response', this.responseListener);
      }

      const totals = getCpuTotalsMap(this.context);
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
          },
        });
      }
    }

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

function getCdpSession(context?: RunContext): CDPSession | undefined {
  const value = context?.data.get(CDP_SESSION_KEY);
  if (!value) {
    return undefined;
  }
  return value as CDPSession;
}

async function getThreadTimeSeconds(session: CDPSession): Promise<number> {
  const metrics = await session.send('Performance.getMetrics');
  const threadTime = metrics.metrics.find((metric) => metric.name === 'ThreadTime');
  return threadTime?.value ?? 0;
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

export async function beginCpuMeasurementForRunLabel(context: RunContext, label: RunLabel): Promise<void> {
  setRunLabelInContext(context, label);

  const session = getCdpSession(context);
  if (!session) {
    return;
  }

  const starts = getCpuStartsMap(context);
  starts.set(label, await getThreadTimeSeconds(session));
  context.data.set(CPU_METRIC_STARTS_KEY, starts);
}

export async function endCpuMeasurementForRunLabel(context: RunContext, label: RunLabel): Promise<void> {
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
