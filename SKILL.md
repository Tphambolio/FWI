---
name: fbp-engine-parity-bias-test
description: Catch latent location biases via head-to-head FBP engine parity testing
argument-hint: [--engines AB,BC] [--test-cases path] [--audit-params]
---

# Head-to-Head Engine Parity Testing

Automates cross-engine validation of `calculateFBP` and `calcMultiDayFBP` to catch location-dependent divergences that numerical parity checks alone would miss. Runs AB and BC engine implementations with forced identical lat/lng to reveal subtle classification drift, ensuring explicit parameter passing prevents silent crown-fire classification drift.

## Steps

1. Load FBP engine implementations for both AB and BC provinces
2. Build test parameter matrix with forced identical lat/lng coordinate pairs across boundary zones (Alberta/British Columbia overlap regions)
3. Execute `calculateFBP` on AB engine with test parameters, capture full output (spread rate, BUI, crown-fire classification, FBP table lookups)
4. Execute `calculateFBP` on BC engine with **identical** parameters and lat/lng (explicit parameter passing prevents silent routing divergence)
5. Compare numerical results for near-zero divergence tolerance; log any discrepancies with parameter context
6. Flag location-dependent classification drift (e.g., crown-fire intensity classification that differs only by lat/lng)
7. Run `calcMultiDayFBP` on both engines with multi-day weather sequences to catch cumulative location bias across fuel state progression
8. Audit parameter passing in test vectors to ensure no defaults hide location routing logic
9. Generate parity report with parameter audit trail showing divergence magnitude, classification impact, and location-specific behavior patterns

## Usage

Run full parity suite with default engines (AB, BC):
```bash
claude invoke fbp-engine-parity-bias-test
```

Specify engines and test case path:
```bash
claude invoke fbp-engine-parity-bias-test --engines AB,BC --test-cases tests/location_parity_vectors.json
```

Include explicit parameter passing audit:
```bash
claude invoke fbp-engine-parity-bias-test --engines AB,BC --audit-params --verbose
```

Exit status: non-zero if location-dependent divergences detected; output files: `parity_report.json`, `location_bias_audit.csv`, `parameter_trace_log.txt`
