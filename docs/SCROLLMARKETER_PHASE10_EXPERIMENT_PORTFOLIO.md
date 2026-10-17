# ScrollMarketer Phase 10 — Experiment Portfolio & Real-options Planning

## Purpose

Phase 10 turns an **already-approved strategic decision** into a smaller, bounded learning commitment. Its purpose is to buy information before the business increases commitment.

It is not an autonomous execution system. A Phase 10 experiment can enter a `running` ledger state, but ScrollMarketer does **not** launch an ad, spend money, publish content, contact a prospect or partner, change a price, enter a market, or invoke another external side effect from this layer.

## Core doctrine

The operating sequence is:

`approved strategic decision -> bounded experiment plan -> exact-plan review -> ledger start -> observations -> stop/complete -> later learning`

The experiment is subordinate to the strategic decision. It is not a second decision or governance system.

Every plan requires:

- an approved source strategic decision;
- a falsifiable hypothesis;
- an information objective;
- a bounded intervention and optional comparison/control;
- a primary metric;
- a hard cost ceiling;
- a deadline;
- at least one explicit success condition;
- at least one explicit kill condition;
- reversible or partly-reversible commitment only.

Hard-to-reverse experiment commitment is intentionally forbidden.

## Information value and real-options interpretation

A plan may link to an existing open `strategic_question`. The experiment snapshots that question's deterministic information-value proxy at plan time.

That proxy is still:

`uncertainty x decision impact x answerability`

It is **not expected monetary value**.

When the source decision has an explicit commitment amount and the experiment has a positive cost ceiling, Phase 10 also records:

`commitment_leverage_ratio = source decision commitment / experiment cost ceiling`

This is an optionality/commitment comparison only. It is **not ROI, NPV, expected return, or probability of success**.

A positive experiment cost is forbidden unless the source approved decision itself has an explicit commitment amount. The experiment currency must match that decision currency and the experiment ceiling cannot exceed the approved decision commitment. A zero-cost experiment may still be planned when source commitment is unknown.

## Canonical relationship integrity

An experiment's `app_id`, `goal_id`, and `market_option_id` are inherited from the source decision at the database boundary. A client cannot independently supply different relationship UUIDs.

The optional linked strategic question must belong to the same user and app. If the question is decision-specific, it must belong to the same source decision and must still be open when the plan is created or materially edited.

## Exact-plan review and freshness

Experiment review is plan-specific, not a replacement for Phase 5 governance.

On review submission, the database fingerprints:

1. the exact material experiment plan; and
2. the exact material source strategic decision using the same semantic fields used by Phase 5 decision freshness.

Approval is valid only while both fingerprints still match.

A material experiment edit resets the review to draft and clears its prior review fingerprints. An experiment cannot be materially edited after it has started.

Revocation preserves the original approver and approval timestamp. Separate `revoked_by`, `revoked_at`, and `revocation_reason` fields record revocation history.

## Lifecycle

Allowed lifecycle transitions are intentionally narrow:

- `not_started -> running | cancelled`
- `running -> paused | completed | stopped`
- `paused -> running | stopped | cancelled`

Starting or resuming requires:

- fresh approved experiment-plan review;
- source decision still `approved`;
- source decision fingerprint still identical to the reviewed source state;
- deadline not passed;
- no active Phase 5 strategic stop-rule breach.

Completing requires at least one recorded experiment observation.

## Source-decision and stop-rule freshness

A running or paused experiment is automatically moved to `stopped` ledger state if a relevant source strategic-decision update makes its reviewed fingerprint stale, the source decision is no longer approved, or a strategic stop-rule insert/update produces a current breach.

This state transition is logged in the existing Phase 5 `strategic_action_log`.

## Observations and structured gates

`strategic_experiment_observations` is append-only for authenticated clients.

An observation may record:

- metric name/value/unit;
- sample size;
- cumulative cost-to-date;
- interpretation (`continue`, `success`, `failure`, `inconclusive`, `stop`);
- notes;
- optional linked strategic evidence.

Linked evidence must be an `observation` owned by the same user and app.

Cumulative cost cannot move backwards and cannot exceed the hard experiment ceiling.

When the observation uses the experiment's primary metric, optional structured success/kill thresholds are evaluated deterministically. Success gates do not automatically claim causation or complete the experiment. A structured kill gate, explicit `stop` observation, or reaching a positive hard cost ceiling moves the experiment ledger state to `stopped` and writes an action-log entry.

A zero-cost experiment does not auto-stop merely because cost-to-date is zero.

## Deadline boundary

The deadline is enforced when an experiment starts/resumes and on later experiment row writes. The current Phase 10 slice does **not** include a scheduler that wakes at the exact deadline with no database activity. Therefore it must not be described as continuous deadline monitoring.

A future scheduler/watch can enforce clock-only expiry continuously, but it must be added as an explicit separate capability.

## UI

`ExperimentPortfolioPanel` is mounted beneath the controlled decision-context / Phase 9 decision-support surface in `/strategy`.

It exposes:

- experiment planning from approved decisions only;
- optional high-information-value question linkage;
- cost/time/reversibility bounds;
- success and kill gates;
- exact-plan review workflow;
- ledger start/pause/resume/stop/complete transitions;
- append-only observation entry;
- review freshness and protective-stop visibility.

The UI repeatedly states that `running` is ledger state only and does not execute external actions.

## Phase 10 migrations

Phase 10 adds, in exact order after migrations 1–18:

19. `supabase/migrations/20261017250000_phase10_experiment_portfolio_real_options.sql`
20. `supabase/migrations/20261017251000_phase10_experiment_hardening.sql`
21. `supabase/migrations/20261017252000_phase10_relationship_integrity.sql`
22. `supabase/migrations/20261017253000_phase10_governance_freshness.sql`

## Required managed-runtime validation

Repository lint/test/build does not execute these PostgreSQL contracts. Before merge/deployment, controlled Lovable Cloud non-production must prove at least:

- migrations 19–22 apply cleanly after migrations 1–18;
- two-user RLS isolation for experiment plans, observations, and portfolio view;
- forged insert values cannot pre-set experiment review/execution state;
- app/goal/market links are canonical to the source decision;
- proposed/rejected/cancelled decisions cannot create a new experiment plan;
- non-zero experiment cost is rejected when source commitment is unknown;
- cost ceiling cannot exceed source decision commitment or use a different currency;
- hard-to-reverse experiment commitment is rejected;
- foreign/cross-app question IDs are rejected;
- material plan edits invalidate review and cannot occur after start;
- stale source-decision changes invalidate/stop running or paused experiments;
- original reviewer identity survives revocation;
- source strategic stop-rule breaches prevent start/resume and stop active experiment ledger state when the breach is created/updated;
- observation cost cannot move backwards or exceed the hard ceiling;
- structured success/kill gates evaluate correctly;
- reaching a positive hard cost ceiling or kill gate produces a protective ledger stop and audit event;
- zero-cost experiments are not stopped merely at cost-to-date zero;
- completed experiments require at least one observation;
- no direct authenticated mutation of protected review/execution columns is possible;
- no experiment transition triggers an ad, spend, publish, outreach, pricing, partnership, market-entry, or other external side effect;
- all Phase 1–9 behavior remains unchanged.

## Next controlled phase

After managed-runtime proof, the next useful slice is **Experiment Outcome -> Evidence -> Strategic Learning handoff**: convert completed/stopped experiment observations into reviewable evidence and postmortem inputs without automatically asserting causation or promoting a learning into reusable memory.
