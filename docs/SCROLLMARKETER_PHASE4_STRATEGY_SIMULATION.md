# ScrollMarketer Phase 4 — Strategy Simulation

Status: implemented in draft PR #9; managed-runtime validation still required
Date: 2026-10-17

## Purpose

Phase 4 introduces a controlled scenario laboratory for answering a different question from forecasting:

> If we make this move, under which plausible futures does the decision still hold, under which does it change, and what reversible response should we prepare?

The feature is designed to support strategic thinking under uncertainty without creating a fake competitor oracle.

## Critical discovery from reverse engineering

The existing `competitor_signals` table is a **current intelligence snapshot**, not a durable competitor-behavior history. The `generate-growth-intelligence` function deletes prior app-level competitor signals before inserting a refreshed set.

Therefore:

- `competitor_signals` must not be used to estimate historical response probabilities.
- model-generated competitor signals remain signals/hypotheses unless independently verified.
- historical response frequencies must come from explicit `strategic_evidence_items` classified as `observation`.

This preserves the system invariant: **unknown stays unknown**.

## Migration

`supabase/migrations/20261017190000_strategy_simulation_engine.sql`

Required migration order is now:

1. `20261017162000_strategic_objectives_decision_ledger.sql`
2. `20261017170000_evidence_uncertainty_engine.sql`
3. `20261017180000_market_choice_engine.sql`
4. `20261017190000_strategy_simulation_engine.sql`

No production migration has been applied by this implementation work.

## Scenario model

New table: `strategic_scenarios`

A scenario can link to:

- an app/offering
- a strategic objective
- a strategic decision
- a market option

It records:

- scenario title and description
- base move
- decision question
- time horizon
- lifecycle status
- final human-readable conclusion

A scenario is a container for structured reasoning. It is not itself a prediction.

## Move / countermove tree

New table: `strategic_scenario_branches`

Each branch contains:

- optional parent branch, allowing move/countermove trees
- actor type and optional actor name
- event/move type and description
- likelihood basis
- optional evidence link
- impact on objective from -100 to +100
- whether the current decision `holds`, `changes`, or remains `unknown`
- planned response/countermove
- response reversibility
- optional stress score

Actors can be:

- company
- competitor
- customer
- market
- regulator
- partner
- internal
- other

## Likelihood doctrine

Likelihood has exactly three bases.

### `unknown`

No percentage is stored.

Unknown likelihood remains `NULL` and receives no stress score.

### `manual_assumption`

An explicit percentage is required.

The UI labels it as a manual assumption. It is not presented as evidence-backed probability.

### `observed_frequency`

Requires:

- a linked `strategic_evidence_items` record
- that record must be classified as `observation`
- observed response count
- comparable event count
- response count must not exceed comparable count

The database computes:

`historical_frequency = observed_response_count / comparable_event_count × 100`

The result is descriptive history. It is **not** a guarantee or calibrated forecast of future competitor behavior.

Example:

If a competitor matched price reductions in 4 of 5 genuinely comparable observed cases, the system may display:

`80% historical frequency (4/5)`

It must not silently relabel that as “80% probability the competitor will respond next time.”

## Stress score

For a branch with known likelihood that may change the decision:

`stress_score = likelihood × absolute impact`

with 0–100 normalisation.

Branches where the decision explicitly holds receive stress 0 when likelihood is known.

Unknown likelihood produces unknown stress.

Stress is only a prioritisation aid. It is **not expected loss, expected value, risk-adjusted NPV, or probability-weighted financial damage**.

## Decision robustness view

The Scenario Lab reports simple branch coverage:

- decision holds in X/Y assessed branches
- decision changes in X/Y assessed branches

This is deliberately not probability-weighted. It tells the user how the decision behaved across the scenarios they actually assessed, not how likely the world is to follow each branch.

## Sensitivity analysis

New table: `strategic_sensitivity_tests`

Each sensitivity record explicitly stores:

- variable name and unit
- low / base / high input values
- outcome metric and unit
- low / base / high outcome values
- evidence basis
- optional linked evidence item
- notes

The database does not invent low/base/high values or outcomes.

Supported evidence bases:

- observation
- experiment
- assumption
- model
- other

The UI displays the basis so an assumed range cannot masquerade as measured evidence.

## Scenario Lab UI

`/strategy` now contains **Scenario Lab** after Evidence & Uncertainty and Market Choice.

Users can:

- create scenarios linked to objectives, decisions and market options
- state the base move and decision question
- add root branches and nested countermoves
- leave likelihood unknown
- record an explicit manual assumption
- use historical frequency only with observation evidence
- record impact and whether the current decision holds/changes
- prepare a reversible countermove
- add low/base/high sensitivity cases
- write a scenario conclusion

The UI surfaces the highest recorded stress branch but labels the metric as a prioritisation proxy.

## Ownership and RLS

All Phase 4 tables are owner-scoped under RLS.

Database validation ensures linked:

- app
- objective
- decision
- market option
- scenario
- parent branch
- evidence item

belong to the same user where applicable.

Observed-frequency branches additionally require the linked evidence record to be an `observation`.

## Why competitor probabilities are not automatic yet

A defensible automated competitor-response model requires durable, comparable historical events. The current `competitor_signals` refresh flow does not provide that history because it replaces prior snapshots.

Phase 4 therefore uses the strategic evidence register as the authoritative path for historical observations.

Future automation may estimate response frequencies only after ScrollMarketer has enough explicitly observed and comparable events. Sample size, comparability and source quality must remain visible.

## What Phase 4 does not do

It does not:

- claim deterministic competitor behavior
- infer private competitor psychology
- convert AI-generated competitor signals into verified history
- generate probabilities from a single current snapshot
- sum mutually incompatible branches into fake expected value
- automatically authorize the countermove
- replace human approval for hard-to-reverse actions

## Repository validation

Code head before this documentation commit:

`d5b201f7d5671952a04f93754e48519902515918`

GitHub Actions run:

`39044192891`

Results:

- lint: PASS
- test: PASS
- build: PASS

This documentation commit creates a new branch head, so exact-head CI must be rechecked before any merge decision.

## Managed-runtime validation required

Repository CI does not execute the Lovable-managed database migration path. Before release:

1. review all four SQL migrations
2. apply them in order in a controlled non-production Lovable Cloud environment
3. validate RLS with at least two users
4. validate scenario/branch/sensitivity CRUD
5. verify `unknown` likelihood remains NULL
6. verify manual likelihood is labeled assumption
7. verify observed-frequency requires observation evidence and valid counts
8. hand-check historical-frequency and stress calculations
9. validate parent/countermove relationships
10. validate sensitivity cases preserve entered low/base/high values
11. verify existing strategy, campaign and growth-intelligence flows still work
12. only then consider merge/release

## Next engineering phase

Phase 5 should implement deterministic authority/governance:

- explicit organization policy objects
- configurable capital/risk/legal/brand approval thresholds
- bounded execution authority
- kill conditions and automatic stop rules
- policy evaluation before action
- complete decision → approval → action → result audit chain

Do not hard-code arbitrary business approval thresholds. They must be configured or explicitly approved by the customer.
