# Carbon Impact Models in ImpactTrace

This document describes the carbon impact model currently implemented in ImpactTrace.

## Current Model (v0.2)

ImpactTrace now uses a **combined model**:

1. Network transfer impact (byte-based)
2. Browser CPU impact (curve-based utilization to power)

Totals reported by the CLI are the sum of both components.

For network transfer impact, ImpactTrace uses `@tgwf/co2` `perByteTrace()` with segmented results and defaults to **operational-only** emissions. Embodied emissions are excluded, and the consumer-device segment is excluded from the network model.

Internally and in report output, totals are represented using SWDM-aligned segment/category matrices:

- Segments: `dataCenters`, `networks`, `userDevices`
- Categories: `operational`, `embodied`

## Constants in Use

From the implementation in src/models/carbonModel.ts:

- ENERGY_PER_GB = 0.1 kWh per GB
- CARBON_INTENSITY = 300 gCO2 per kWh
- BYTES_PER_GB = 1,073,741,824 (1024^3)
- DEFAULT_CPU_WATTS = 20 W
- DEFAULT CPU curve profile = `if-default`

Runtime CPU wattage is resolved with precedence:

1. Environment variable: IMPACT_TRACE_CPU_WATTS
2. Repo config file: impact-trace.config.json (cpuWatts)
3. Default constant (20 W)

Runtime CPU curve profile is resolved with precedence:

1. CLI flag: `--cpu-curve-profile`
2. Environment variable: `IMPACT_TRACE_CPU_CURVE_PROFILE`
3. Repo config file: `impact-trace.config.json` (`cpuCurveProfile`)
4. Default profile: `if-default`

Built-in profiles:

- `if-default`: `x=[0,10,50,100]`, `y=[0.12,0.32,0.75,1.02]`
- `linear`: `x=[0,100]`, `y=[0,1]`

Runtime CPU measurement window is resolved with precedence:

1. CLI flag: --cpu-seconds
2. Environment variable: IMPACT_TRACE_CPU_MEASUREMENT_SECONDS
3. Repo config file: impact-trace.config.json (cpuMeasurementSeconds)
4. Default constant (3 seconds)

CPU is measured from journey start and continues until at least the configured duration is reached. This helps include ongoing page activity such as animations.

Runtime grid intensity overrides are resolved with precedence:

1. CLI flags (`--grid-intensity-device`, `--grid-intensity-network`, `--grid-intensity-datacenter`)
2. Environment variables (`IMPACT_TRACE_GRID_INTENSITY_DEVICE`, `IMPACT_TRACE_GRID_INTENSITY_NETWORK`, `IMPACT_TRACE_GRID_INTENSITY_DATACENTER`, and `*_COUNTRY` variants)
3. Repo config file: impact-trace.config.json (`gridIntensity`)
4. co2.js defaults

Grid intensity values can be set per segment as:

- Numeric intensity values
- Country objects (for example `{ "country": "TWN" }`)

The config also accepts `gridIntensity.networks` as an alias for `gridIntensity.network`.

Resolved grid-intensity values used by co2.js are emitted in report JSON as `modelInputs.resolvedGridIntensity`.

Runtime Green Hosting Factor and visitor/cache ratios are resolved with precedence:

1. CLI flags (`--green-hosting-factor`, `--return-visitor-ratio`, `--data-cache-ratio`)
2. Environment variables (`IMPACT_TRACE_GREEN_HOSTING_FACTOR`, `IMPACT_TRACE_RETURN_VISITOR_RATIO`, `IMPACT_TRACE_DATA_CACHE_RATIO`)
3. Repo config file: impact-trace.config.json
4. Defaults (`greenHostingFactor=0`, `returnVisitorRatio=0.75`)

`newVisitorRatio` is derived as `1 - returnVisitorRatio`.

In compare-cache mode, `dataCacheRatio` is derived when unspecified:

- dataCacheRatio = clamp(1 - returningBytes / firstVisitBytes, 0, 1)

## Equations

Given total transferred bytes B:

- networkEnergyKwh = (B / BYTES_PER_GB) * ENERGY_PER_GB
- networkCarbonGrams = co2.js perByteTrace(B).co2.dataCenterOperationalCO2e + co2.js perByteTrace(B).co2.networkOperationalCO2e

ImpactTrace reports SWDM segment/category totals across the board:

- swdmSegments.dataCenters.operationalCarbonGrams / embodiedCarbonGrams
- swdmSegments.networks.operationalCarbonGrams / embodiedCarbonGrams
- swdmSegments.userDevices.operationalCarbonGrams / embodiedCarbonGrams
- and the equivalent `operationalEnergyKwh` / `embodiedEnergyKwh` fields

Green hosting adjustment:

- adjustedDataCenterOperationalCarbon = dataCenterOperationalCarbon * (1 - greenHostingFactor)

This adjustment applies to data-center operational carbon only; energy and embodied totals are unchanged.

Notes:

- Overall `networkCarbonGrams`/`networkEnergyKwh` remain intentionally non-device (`networks + dataCenters`) for continuity.
- CPU totals remain separate in `cpu*` fields.
- For compatibility, legacy `transferSegments.*` values are still emitted and derived from the SWDM representation.

If operational segmented values are unavailable unexpectedly, ImpactTrace falls back to non-device segmented totals, then to the prior deterministic bytes->kWh->carbon calculation.

Given total CPU time in milliseconds `T`, total CPU measurement window in milliseconds `Wm`, active cores `C`, curve points `(x, y)`, CPU watt baseline `W`, and CPU-to-device factor `F`:

- cpuUtilizationPercent = clamp((T / (Wm * C)) * 100, 0, 100)
- cpuPowerFactor = interpolate(cpuUtilizationPercent, x, y)
- cpuDeviceEnergyKwh = ((W * cpuPowerFactor * Wm) / 3,600,000) / 1000 * F
- cpuCarbonGrams = cpuDeviceEnergyKwh * CARBON_INTENSITY

Combined totals:

- totalEnergyKwh = networkEnergyKwh + cpuEnergyKwh
- totalCarbonGrams = networkCarbonGrams + cpuCarbonGrams

Compare-cache representative totals (audience-weighted):

- representative = newVisitorRatio * firstVisit + returnVisitorRatio * returningVisit

This applies to scalar totals and SWDM/transfer segment totals.

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
	"cpuWatts": 20,
	"cpuCurveProfile": "if-default",
	"cpuToDeviceEnergyFactor": 1,
	"cpuActiveCores": 1,
	"cpuMeasurementSeconds": 3,
	"greenHostingFactor": 0.3,
	"returnVisitorRatio": 0.75,
	"dataCacheRatio": 0.8,
	"gridIntensity": {
		"device": 565.629,
		"dataCenter": { "country": "TWN" },
		"network": 442
	}
}
```

## Planned Model Evolution

ImpactTrace architecture separates measurement and modeling to support future upgrades, for example:

- Region-based carbon intensity profiles
- Separate network and compute coefficients
- Plugin-fed backend/container energy signals
- CI carbon budgets and threshold policies

When these are added, this document should be versioned with model changes.
