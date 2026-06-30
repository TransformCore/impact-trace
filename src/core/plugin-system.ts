import type { CarbonMetric, MeasurementPlugin, RunContext } from '../types/index.js';

export class PluginSystem {
  constructor(private readonly plugins: MeasurementPlugin[]) {}

  async startAll(context: RunContext): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.start(context);
    }
  }

  async stopAll(): Promise<CarbonMetric[]> {
    const allMetrics: CarbonMetric[] = [];

    for (const plugin of [...this.plugins].reverse()) {
      const metrics = await plugin.stop();
      allMetrics.push(...metrics);
    }

    return allMetrics;
  }
}
