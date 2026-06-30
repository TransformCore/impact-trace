# Carbon Impact Models in ImpactTrace

This document describes the carbon impact model currently implemented in ImpactTrace.

## Current Model (v0.2)

ImpactTrace now uses a **combined model**:

1. Network transfer impact (byte-based)
2. Browser CPU impact (time-and-wattage based)

Totals reported by the CLI are the sum of both components.

For network transfer impact, ImpactTrace uses `@tgwf/co2` `perByteTrace()` with segmented results and excludes the consumer-device segment from the network model.

## Constants in Use

From the implementation in src/models/carbonModel.ts:

- ENERGY_PER_GB = 0.1 kWh per GB
- CARBON_INTENSITY = 300 gCO2 per kWh
- BYTES_PER_GB = 1,073,741,824 (1024^3)
- DEFAULT_CPU_WATTS = 20 W

Runtime CPU wattage is resolved with precedence:

1. Environment variable: IMPACT_TRACE_CPU_WATTS
2. Repo config file: impact-trace.config.json (cpuWatts)
3. Default constant (20 W)

Runtime CPU measurement window is resolved with precedence:

1. CLI flag: --cpu-seconds
2. Environment variable: IMPACT_TRACE_CPU_MEASUREMENT_SECONDS
3. Repo config file: impact-trace.config.json (cpuMeasurementSeconds)
4. Default constant (3 seconds)

CPU is measured from journey start and continues until at least the configured duration is reached. This helps include ongoing page activity such as animations.

## Equations

Given total transferred bytes B:

- networkEnergyKwh = (B / BYTES_PER_GB) * ENERGY_PER_GB
- networkCarbonGrams = co2.js perByteTrace(B).co2.dataCenterCO2e + co2.js perByteTrace(B).co2.networkCO2e

If segmented values are unavailable unexpectedly, ImpactTrace falls back to the prior deterministic bytes->kWh->carbon calculation.

Given total CPU time in milliseconds T and CPU watts W:

- cpuEnergyKwh = (T / 3,600,000) * (W / 1000)
- cpuCarbonGrams = cpuEnergyKwh * CARBON_INTENSITY

Combined totals:

- totalEnergyKwh = networkEnergyKwh + cpuEnergyKwh
- totalCarbonGrams = networkCarbonGrams + cpuCarbonGrams

## What Gets Counted

- Metrics with networkBytes > 0 are included in network totals.
- Metrics with cpuTimeMs > 0 are included in CPU totals.
- Resource-level impacts are grouped by URL + resource type.
- Per-resource totals are sorted by **network carbon impact** for Top Contributors.

## What Is Not Yet Modeled

The current model does **not** yet include:

- GPU process power
- Backend/server compute energy
- Regional grid intensity variation
- Time-of-day carbon intensity variation
- Embodied carbon of hardware

These are planned extensibility areas.

## Data Sources

Network usage is derived from browser instrumentation in the Playwright plugin via:

- Response/request size information

CPU usage is derived from Chromium performance metrics (CDP) as per-run timing deltas.

The model calculations are performed in src/models/carbonModel.ts.

## Interpretation Guidance

Use current outputs as:

- A relative comparison tool between runs, pages, and changes
- A way to identify high-impact assets and optimization opportunities

Avoid treating current outputs as a full lifecycle or absolute footprint number.

## Example Config

impact-trace.config.json

```json
{
	"cpuWatts": 20
}
```

## Planned Model Evolution

ImpactTrace architecture separates measurement and modeling to support future upgrades, for example:

- Region-based carbon intensity profiles
- Separate network and compute coefficients
- Plugin-fed backend/container energy signals
- CI carbon budgets and threshold policies

When these are added, this document should be versioned with model changes.
