# ScrollMarketer Phase 9 — Recommendation-only Market Ranking & Scenario Planning

## Purpose

Phase 9 is the first controlled consumer of the Phase 8 decision-context contract beyond generic strategic recommendations. It answers two bounded questions:

1. **Which already-recorded market option should be investigated/tested first?**
2. **Does an already-recorded strategy appear to hold under an explicit scenario, change, or need more evidence?**

It does **not** enter a market, alter pricing, spend budget, contact partners, publish content, approve a decision, modify scenario conclusions, or execute any response.

## Core doctrine

### Market ranking

The numeric order is deterministic. AI does not generate, override, or interpolate the rank.

Existing `strategic_market_options` remain authoritative. Their Phase 3 scoring rules remain unchanged:

- unknown factor values stay `NULL`;
- attractiveness is `NULL` until at least four factors are known;
- `decision_readiness_score = attractiveness × evidence coverage × evidence confidence`;
- this is a prioritisation proxy, not ROI or probability of success.

Phase 9 ranking uses:

1. `decision_readiness_score DESC`;
2. `attractiveness_score DESC`;
3. `evidence_coverage DESC`;
4. `evidence_confidence DESC`;
5. stable market-option ID as final tie-breaker.

A candidate with `decision_readiness_score IS NULL` receives `rank_state = insufficient_evidence`; it is not assigned a numeric rank. `entered` and `rejected` options are marked `excluded`.

The AI layer may only annotate the deterministic result with one of:

- `test`
- `research`
- `wait`
- `deprioritize`

and explain why. Sparse support reduces confidence deterministically. Fabricated evidence/memory/question/unknown IDs are discarded. If the model omits a market annotation, ScrollMarketer stores `confidence = NULL` rather than inventing a default confidence value.

### Scenario planning

Scenario assessment operates only on existing Phase 4 scenario objects, branches and sensitivity tests.

The system preserves these distinctions:

- `unknown` likelihood stays `NULL`;
- `manual_assumption` remains an assumption;
- `observed_frequency` is descriptive history, not guaranteed future probability;
- observed-frequency evidence that is not a validated observation is labeled `unverified_observation`;
- `stress_score` remains a prioritisation proxy, not expected financial loss;
- low/base/high sensitivity values are stored inputs, not invented by Phase 9.

Each snapshot branch also exposes a `qualified_stress_score`. If an observed-frequency branch is backed only by an unvalidated observation, its qualified stress is `NULL`. A database hardening trigger recomputes the assessment-level `max_stress_score` from qualified branch stress only, so unverified historical-frequency evidence cannot inflate the persisted aggregate.

The AI may return only:

- `holds`
- `changes`
- `needs_more_evidence`

This result is stored in an immutable assessment run. It does not update `strategic_scenarios.conclusion`.

## Controlled context snapshots

Phase 9 extends the same `strategic_context_snapshots` store introduced in Phase 8. It does not create a parallel knowledge store.

### Market ranking snapshot

`create_market_ranking_context_snapshot(app, objective?)` calls the Phase 8 assembler and then embeds the full authoritative market-option basis, deterministic rank state/order and ranking rule.

The context is fingerprinted before generation and stored with:

- `purpose = market_ranking`
- `context_version = phase9-market-v1`
- focus = app or explicit objective

### Scenario planning snapshot

`create_scenario_planning_context_snapshot(app, scenario)` calls the Phase 8 assembler and embeds:

- authoritative scenario fields;
- all existing scenario branches;
- likelihood basis and evidence qualification;
- explicit sensitivity tests;
- deterministic branch-count/effect/likelihood summary.

It is stored with:

- `purpose = scenario_planning`
- `focus_type = scenario`
- `focus_id = selected scenario`
- `context_version = phase9-scenario-v1`

## Immutable analysis artifacts

Phase 9 adds three read-only-to-authenticated tables:

- `strategic_market_ranking_runs`
- `strategic_market_ranking_items`
- `strategic_scenario_assessment_runs`

Authenticated clients receive SELECT only. The two Edge Functions record complete runs through service-role-only atomic RPCs. This prevents a browser from forging an AI analysis artifact directly.

`record_strategic_market_ranking_run(...)` copies rank state, rank position and scoring fields from the immutable snapshot. It never accepts those values from model output.

`record_strategic_scenario_assessment_run(...)` copies branch/sensitivity summary metrics from the immutable scenario snapshot. The subsequent epistemic-hardening trigger overrides persisted maximum stress with the qualified snapshot-derived value. The model cannot supply that metric.

## Edge Functions

### `rank-strategic-markets`

1. authenticates the user;
2. rate-limits the call;
3. creates a market-ranking context snapshot;
4. sends only that context to the model;
5. validates every cited ID against the snapshot;
6. applies confidence/evidence guards;
7. preserves the deterministic rank untouched;
8. records an immutable ranking run through a service-role-only RPC;
9. performs no external side effect.

### `assess-strategic-scenario`

1. authenticates the user;
2. rate-limits the call;
3. creates a scenario-planning context snapshot;
4. sends only the explicit scenario/context to the model;
5. validates branch/evidence/memory/question/unknown references;
6. forces `needs_more_evidence` when no branches/effects have actually been assessed;
7. caps confidence when branch/effect/likelihood coverage is weak;
8. records an immutable assessment;
9. does not mutate the scenario or execute a response.

## UI

`MarketScenarioDecisionSupportPanel` is mounted inside the existing Controlled Decision Context surface.

The market section shows the current deterministic preview before generation and the latest persisted immutable ranking after generation. Ranking history is scope-correct: changing objective scope never falls back to a ranking run generated for a different objective.

The scenario section shows explicit branch coverage/unknowns before generation and the latest immutable recommendation-only assessment afterward.

## Function deployment configuration

Phase 9 also fixes a Phase 8 deployment-config omission by registering:

- `generate-strategic-recommendations`
- `rank-strategic-markets`
- `assess-strategic-scenario`

in `supabase/config.toml`.

All three functions perform their own authenticated-user check even though project config currently uses `verify_jwt = false`, matching the repository's existing Edge Function pattern.

## Migrations

Phase 9 adds, in order:

1. `supabase/migrations/20261017240000_phase9_market_ranking_scenario_planning.sql`
2. `supabase/migrations/20261017241000_phase9_epistemic_hardening.sql`

They must run after the sixteen Phase 1–8 migrations.

## Required managed-runtime validation

Repository lint/test/build is necessary but insufficient. Before merge/deployment, controlled Lovable Cloud non-production must prove at least:

- migrations 17–18 apply cleanly after migrations 1–16;
- two-user RLS isolation on all three Phase 9 artifact tables;
- authenticated clients cannot insert/update/delete Phase 9 analysis artifacts;
- service-role-only recorder RPCs cannot be invoked by authenticated/anon roles;
- foreign app/objective/scenario IDs are rejected by snapshot creators;
- market ranking includes no numeric rank for `decision_readiness_score IS NULL`;
- an omitted AI annotation persists no invented confidence;
- excluded markets remain excluded;
- deterministic rank cannot be changed by model output;
- fabricated cited IDs are discarded;
- weak-evidence confidence caps are enforced;
- scenario unknown likelihood remains `NULL` in the snapshot;
- manual assumptions remain labeled assumptions;
- unvalidated observed-frequency evidence remains labeled unverified;
- persisted maximum stress ignores unqualified observed-frequency branches;
- a scenario with no assessed branches is forced to `needs_more_evidence`;
- scenario assessment does not update `strategic_scenarios.conclusion`;
- market ranking does not update market-option scores/status;
- all analysis runs bind to the correct immutable context snapshot;
- all three configured functions deploy and authenticate correctly;
- no pricing, spend, publishing, outreach, partnership, market-entry or other external side effect occurs.

## Next controlled phase

Only after Phase 9 runtime validation should the project move toward Phase 10. The next useful slice is **Experiment Portfolio & Real-options Planning**: convert approved recommendations into explicitly bounded, reversible experiments with hypotheses, information value, cost/commitment caps, success/kill gates and governance review. This should still stop before arbitrary autonomous execution.
