# ScrollMarketer Phase 6 — Strategic Memory & Causal Learning

Status: implemented on `feature/strategic-objectives-decision-ledger`; repository CI and managed-runtime validation remain separate gates.

## Purpose

Phase 6 gives ScrollMarketer durable institutional memory for strategic decisions without confusing tactical correlation with causation.

The target chain is:

`decision → action → context → observed outcome → mechanism hypothesis → evidence review → transfer test → reusable lesson`

The system is intentionally conservative. A positive result does not automatically become a causal rule, and a tactic that worked in one market is not automatically copied into another.

## Existing learning architecture reused

ScrollMarketer already had two distinct learning primitives:

- `learning_insights` — a tactical pattern cache regenerated from recent content/performance signals. Existing generation deliberately deletes/replaces prior app insights to keep the cache light.
- `learning_events` — a durable owner-scoped learning log already populated by meeting/proposal/outcome workflows.

Phase 6 **extends `learning_events`** instead of creating a parallel durable-memory table. Existing operational learning remains valid because new strategic fields have safe defaults and `learning_kind = operational` by default.

`learning_insights` is left unchanged and must not be silently promoted into causal strategic memory.

## Ordered migrations

Phase 6 adds two migrations after the seven Phase 1–5 migrations:

1. `supabase/migrations/20261017210000_strategic_memory_causal_learning.sql`
2. `supabase/migrations/20261017211000_strategic_memory_epistemic_guards.sql`

They remain unapplied to the managed Lovable Cloud runtime in this branch state.

## Durable strategic learning model

`learning_events` gains strategic context and epistemic fields:

- `app_id`
- `goal_id`
- `decision_id`
- `market_option_id`
- `scenario_id`
- `learning_kind`
- `action_summary`
- `context`
- `outcome_summary`
- `outcome_direction`
- `mechanism_hypothesis`
- `causal_status`
- `confidence`
- `transferability_status`
- `transferability_scope`
- `transferability_conditions`
- `source_snapshot`
- `status`
- `supersedes_learning_event_id`
- `updated_at`

Strategic learning kinds are:

- `strategic_postmortem`
- `mechanism_hypothesis`
- `correction`
- `transfer_result`

Existing rows/inserts remain `operational` unless explicitly marked otherwise.

## Observation versus explanation

A strategic memory stores the observed outcome separately from the proposed explanation.

Example:

- observed outcome: German SME conversion increased 11.7% during the test;
- mechanism hypothesis: verified-customer proof reduced trust concerns;
- causal status: plausible / supported / challenged, depending on evidence;
- transferability: unknown until tested elsewhere.

This prevents ScrollMarketer from storing “conversion increased because social proof works” as a fact merely because two events occurred together.

## Causal-status doctrine

Allowed causal statuses are:

- `unknown`
- `correlation`
- `plausible`
- `supported`
- `challenged`
- `falsified`

A non-unknown causal status always requires an explicit mechanism hypothesis.

Creation is deliberately conservative: the Strategy UI initially allows only `unknown`, `correlation`, or `plausible`. Stronger states are post-creation review states.

### Strong-state database guards

The second Phase 6 migration prevents unsupported promotion:

- `supported` requires either a validated supporting **observation** link or a completed supporting transfer test;
- `challenged` requires validated challenging observation evidence or a completed mixed/challenged/falsified transfer test;
- `falsified` requires validated challenging **experiment** evidence or a completed falsifying transfer test.

These requirements improve epistemic discipline, but even `supported` does **not** mean causation has been proven. The label means current qualifying evidence supports the mechanism hypothesis.

## Evidence provenance

New table: `strategic_learning_evidence_links`.

It links a durable learning event to the existing `strategic_evidence_items` register with one explicit relationship:

- `supports`
- `challenges`
- `context`

Evidence keeps its original Phase 2 classification (`observation`, `inference`, `assumption`, `unknown`) and lifecycle status. Linking evidence never rewrites an inference into an observation.

Cross-user links are rejected by both RLS and database ownership validation.

## Transfer testing

New table: `strategic_learning_transfer_tests`.

A transfer test asks whether the proposed **mechanism**, not merely the old creative/tactic, survives in a new context.

Each test can record:

- source learning event;
- target app/decision;
- target market and segment;
- explicit hypothesis;
- test method;
- planned/running/completed/cancelled status;
- supported/mixed/challenged/falsified result;
- confidence before and after;
- observed outcome and notes;
- optional linked evidence.

A transfer test cannot exist without a source learning event that has an explicit mechanism hypothesis. A completed test cannot retain an `unknown` result.

Completing a transfer test **does not automatically change** the source learning event’s causal status or transferability. The owner reviews the accumulated evidence and explicitly requests a new epistemic state; database guards decide whether the stronger state is admissible.

## Transferability doctrine

Statuses are:

- `unknown`
- `local_only`
- `candidate`
- `tested`
- `not_transferable`

`tested` requires at least one completed transfer test.

`not_transferable` requires a completed challenged or falsified transfer test.

This prevents the system from labeling a mechanism globally transferable merely because it worked once.

## Corrections and durable history

Strategic learning is historical evidence and should not be silently rewritten.

The UI therefore uses:

- `invalidated` when a learning should no longer guide decisions;
- `correction` with `supersedes_learning_event_id` when a newer learning replaces an older interpretation.

When a correction explicitly supersedes an older learning, the older row is marked `superseded` but remains queryable.

Authenticated clients are blocked from deleting non-operational strategic learning rows. Service-role maintenance remains possible for controlled administrative work.

## Cross-entity consistency

Database triggers verify that linked objectives, decisions, market options, scenarios, evidence items and target decisions belong to the same owner.

Phase 6 hardening also checks app consistency so a learning cannot claim one app while linking a strategic decision/market/scenario from another app.

## Strategy Command UI

`/strategy` now includes **Strategic Memory & Causal Learning**.

The panel supports:

- recording strategic postmortems;
- recording mechanism hypotheses;
- recording corrections without erasing history;
- linking supporting/challenging/context evidence;
- viewing explicit causal and transferability state;
- planning cross-context transfer tests;
- starting/completing transfer tests;
- reviewing causal/transferability state after evidence accumulates;
- invalidating a learning while preserving the record.

The UI visibly warns that `supported` is not proof of causation.

## Important feedback-loop boundary

Phase 6 does **not** automatically feed all durable strategic learning back into campaign generation, prospect qualification, market scoring, or autonomous execution.

That is intentional.

Automatic consumption before epistemic review could create a circular reinforcement loop:

`model suggestion → campaign → noisy outcome → model-written lesson → future model suggestion`

without enough independent evidence.

For this phase, strategic memory is durable, queryable and reviewable. A later Commercial Decision Graph / policy layer can decide which memory classes are eligible for automated reuse—for example, requiring active status, an explicit mechanism, minimum evidence quality, and appropriate transferability scope.

Existing tactical `learning_insights` continue serving their current operational consumers and are not treated as causal truth.

## What Phase 6 does not claim

It does not mean:

- correlation has become causation;
- a `supported` hypothesis is scientifically proven;
- one transfer test proves universal transferability;
- tactical learning insights are durable institutional truth;
- strategic memories automatically control campaigns or agents;
- existing historical operational learning events have complete app/decision context;
- repository CI proves the SQL migrations/RLS/triggers work in the managed database.

## Required managed-runtime validation

Before merge/release, apply all nine ordered strategic migrations through the controlled Lovable Cloud non-production path and verify at minimum:

- existing operational `learning_events` inserts still succeed unchanged;
- existing Decision Dashboard still reads operational learning events;
- tactical `learning_insights` generation/replacement remains unchanged;
- strategic learning CRUD is owner-isolated across at least two users;
- cross-user and cross-app decision/market/scenario/evidence links are rejected;
- non-unknown causal status without a mechanism is rejected;
- new strategic learning cannot be created directly as supported/challenged/falsified;
- supported state rejects unvalidated/non-observation-only support;
- challenged state rejects unsupported promotion;
- falsified state requires validated experiment evidence or a falsifying completed transfer test;
- transfer test without source mechanism is rejected;
- completed transfer test with unknown result is rejected;
- `tested` transferability requires a completed transfer test;
- `not_transferable` requires a challenged/falsified completed transfer test;
- completing a transfer test does not auto-promote the source learning;
- correction marks the older learning superseded without deleting it;
- authenticated deletion of strategic learning is rejected;
- operational learning deletion behavior is not unintentionally changed;
- app selection filters strategic memory correctly;
- all new public tables are accessible only through intended grants + RLS;
- no service-role credential is exposed to the browser.

Repository CI is necessary but not sufficient for those runtime checks.
