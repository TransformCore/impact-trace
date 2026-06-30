import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import type { CarbonMetric, MeasurementPlugin, RunContext } from '../types/index.js';

const PAGE_KEY = 'playwrightPage';
const RUN_LABEL_KEY = 'impactTraceRunLabel';

export class BrowserPlugin implements MeasurementPlugin {
  name = 'browser';

  private browser?: Browser;
  private browserContext?: BrowserContext;
  private page?: Page;
  private readonly metrics: CarbonMetric[] = [];
  private responseListener?: (response: Response) => void;
  private context?: RunContext;

  async start(context: RunContext): Promise<void> {
    this.context = context;
    this.browser = await chromium.launch({ headless: true });
    this.browserContext = await this.browser.newContext();
    this.page = await this.browserContext.newPage();

    this.responseListener = (response: Response) => {
      void this.captureResponseMetric(response);
    };

    this.page.on('response', this.responseListener);
    context.data.set(PAGE_KEY, this.page);
  }

  async stop(): Promise<CarbonMetric[]> {
    if (this.page) {
      if (this.responseListener) {
        this.page.off('response', this.responseListener);
      }

      const perfMetrics = await this.page.evaluate(() => {
        return performance.getEntriesByType('resource').map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return {
            url: resource.name,
            resourceType: resource.initiatorType,
            transferSize: resource.transferSize || resource.encodedBodySize || 0,
            duration: resource.duration,
            startTime: resource.startTime,
          };
        });
      });

      const now = Date.now();
      for (const metric of perfMetrics) {
        const runLabel = getRunLabel(this.context);
        this.metrics.push({
          source: 'browser',
          timestampStart: now,
          timestampEnd: now,
          cpuTimeMs: metric.duration,
          metadata: {
            url: metric.url,
            resourceType: metric.resourceType,
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

function getRunLabel(context?: RunContext): 'single-run' | 'new-user' | 'returning-user' {
  const value = context?.data.get(RUN_LABEL_KEY);
  if (value === 'new-user' || value === 'returning-user' || value === 'single-run') {
    return value;
  }
  return 'single-run';
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
  label: 'single-run' | 'new-user' | 'returning-user',
): void {
  context.data.set(RUN_LABEL_KEY, label);
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
