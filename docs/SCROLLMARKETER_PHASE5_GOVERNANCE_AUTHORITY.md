# ScrollMarketer Phase 5 — Deterministic Governance & Authority

Status: implemented on `feature/strategic-objectives-decision-ledger`; repository validation and managed-runtime validation are separate gates.

## Purpose

Phase 5 turns strategic autonomy from a generic on/off switch into an explicit, inspectable authority system.

The design principle is:

> Probabilistic intelligence may recommend an action, but deterministic governance decides whether that action may proceed.

This phase does **not** replace the existing domain-specific controls for content auto-approval or prospecting autopilot. Those remain intact. Strategic governance sits above them and is intended for strategic decisions such as tests, partnerships, repositioning, pricing, market entry/exit, advertising and scaling.

## Existing controls preserved

ScrollMarketer already had:

- `automation_policies` for content quality, posting limits, quiet hours and escalation;
- `autopilot_settings` for prospect opportunity/confidence thresholds, daily-send caps, maximum automatic value and segment routing;
- `automation_audit_log` for existing automation events.

Those controls solve narrower operational problems and were not overloaded into strategic policy objects.

## Migrations

Phase 5 adds three ordered migrations after Phase 4:

1. `supabase/migrations/20261017200000_deterministic_governance_engine.sql`
2. `supabase/migrations/20261017201000_governance_freshness_guards.sql`
3. `supabase/migrations/20261017202000_governance_fail_closed_actions.sql`

They remain unapplied to the managed Lovable Cloud runtime in this branch state.

## Strategic execution mode

`strategic_decisions` gains:

- `execution_mode = manual | bounded_autonomous`

The default is `manual`.

Changing this field does not itself execute anything. It declares the execution posture that the governance guard will enforce when a decision is moved into `executing` or `executed` state.

## Governance policies

New table: `strategic_governance_policies`.

A policy can be global or offering-specific and includes:

- policy name;
- applicable decision types;
- authority mode;
- minimum confidence;
- maximum commitment amount and currency;
- allowed reversibility classes;
- optional additional human checkpoint;
- legal-review requirement;
- brand-review requirement;
- executive-approval requirement;
- priority;
- enabled/disabled state;
- notes.

Authority modes are:

- `manual_only`;
- `recommend`;
- `draft`;
- `bounded_execute`.

### No invented thresholds

A `bounded_execute` policy is structurally invalid unless the owner explicitly supplies:

- a minimum confidence;
- a maximum commitment amount;
- at least one allowed reversibility class.

The database does not silently insert a capital ceiling or a confidence floor.

Policies created in the Strategy Command UI start **disabled**. Enabling one is a separate explicit owner action.

## Deterministic governance evaluation

New table: `strategic_governance_evaluations`.

The client only requests an evaluation. A database trigger determines the actual `allow`, `review` or `block` result.

For bounded autonomous execution, the evaluator checks the current decision against the highest-priority applicable enabled policy. An offering-specific policy outranks a global policy at the same decision scope.

The evaluator currently supports only `autonomous_execute`. Unsupported governance action modes fail closed rather than returning a misleading ALLOW.

### Fail-closed conditions

Autonomous execution cannot receive ALLOW when any required condition fails, including:

- no enabled applicable policy;
- policy authority is not `bounded_execute`;
- strategic decision has not been approved;
- decision has not been explicitly armed as `bounded_autonomous`;
- confidence is unknown or below the configured minimum;
- commitment amount is unknown;
- commitment exceeds the configured ceiling;
- policy/decision currencies do not match;
- reversibility is outside the configured allow-list;
- a deterministic stop rule is breached;
- a required legal, brand, executive or optional additional-human approval is missing or rejected.

Hard-to-reverse decisions require executive approval even when the selected policy does not explicitly request it.

## Approval requests

New table: `strategic_approval_requests`.

Approval types:

- human;
- legal;
- brand;
- executive.

States:

- pending;
- approved;
- rejected;
- cancelled.

When governance evaluation needs a required approval, it creates a pending approval request rather than pretending approval exists.

The ordinary `strategic_decisions.status = approved` requirement remains a separate prerequisite. `human_approval_required` on a governance policy therefore represents an **additional** human checkpoint, not the basic decision approval.

## Freshness and stale-approval protection

Approvals are not valid forever.

Each evaluation computes:

- a decision fingerprint covering material strategic/execution fields;
- a policy fingerprint representing the exact selected policy version.

Approval requests store both fingerprints.

If the decision or policy changes:

- stale pending approvals are cancelled;
- stale approved/rejected approvals do not satisfy a new evaluation;
- a previous ALLOW evaluation cannot authorize the changed decision;
- a fresh evaluation and, where required, fresh approvals are needed.

This prevents approval of one budget/recommendation from being reused after material changes.

## Stop rules

New table: `strategic_stop_rules`.

Currently machine-checkable rule types are:

- `confidence_floor`;
- `commitment_ceiling`;
- `deadline`;
- `manual_halt`.

The values are explicit. Unknown confidence or unknown commitment fails the corresponding rule rather than being treated as safe.

A stop rule can be manually triggered or disabled. Active/triggered rules are rechecked before bounded autonomous execution may proceed.

### Important runtime boundary

Phase 5 does not claim continuous monitoring of arbitrary external metrics such as CAC, churn, legal changes or brand sentiment. Those values are not yet wired into a generic strategic executor.

The current guarantee is narrower and deterministic:

- before a strategic decision can transition into bounded autonomous `executing`/`executed`, the database requires a fresh ALLOW evaluation;
- governance-relevant changes while bounded execution state is active require a still-current ALLOW evaluation;
- deterministic stop-rule breaches block that transition/update.

Future executors must call/use this governance gate before every governed side effect. Existing prospect/content automations remain under their existing domain controls until explicitly integrated.

## Execution guard

`guard_strategic_bounded_execution()` is a database trigger on governance-relevant strategic-decision updates.

For bounded-autonomous decisions in `executing` or `executed` state it requires:

1. an enabled currently applicable governance policy;
2. a current decision fingerprint;
3. a current policy fingerprint;
4. an ALLOW evaluation matching both fingerprints and the selected policy;
5. no current stop-rule breach.

Changing the decision type, title, recommendation, rationale, objective/market linkage, confidence, reversibility, commitment, currency, authority or execution mode invalidates reuse of an older ALLOW evaluation.

Manual execution remains possible as a human workflow and is not falsely represented as autonomous governance approval.

## Strategic audit chain

New append-only table: `strategic_action_log`.

It records governance-related transitions such as:

- governance evaluated;
- approval requested;
- approval status changed;
- stop rule created/changed;
- decision status changed;
- execution mode changed;
- outcome summary updated.

Authenticated clients can read their own log but cannot directly insert arbitrary audit events. Trigger-driven audit writes use narrowly scoped `SECURITY DEFINER` functions with an empty search path, fully qualified target tables and direct EXECUTE privileges revoked from public/authenticated callers.

This provides the foundation for:

`decision → governance evaluation → approval → execution state → outcome`

without trusting the browser to manufacture the audit trail.

## RLS and ownership

Every new exposed table has RLS enabled.

Policies are owner-scoped. Cross-entity validation checks that linked apps, decisions and policies belong to the same user.

The Phase 5 implementation does not expose service-role credentials to the browser.

## Strategy Command UI

`/strategy` now contains **Governance & Authority** with:

- enabled-policy count;
- bounded-autonomy policy count;
- pending approvals;
- triggered stops;
- governance-policy creation;
- explicit enable/disable controls;
- decision execution envelope configuration;
- governance evaluation;
- ALLOW/REVIEW/BLOCK reasons;
- approval review controls;
- deterministic stop-rule creation;
- manual halt/disable controls;
- recent decision governance audit chain.

## What Phase 5 does not claim

It does not yet mean:

- arbitrary AI agents can execute every business action;
- existing content/prospect automations automatically inherit strategic policies;
- legal/brand approval is provided by an external lawyer or brand officer;
- stop rules continuously ingest all business telemetry;
- an ALLOW result proves the strategy will succeed;
- database migration/runtime behavior has been validated merely because TypeScript CI passes.

Those boundaries must remain explicit.

## Required managed-runtime validation

Before merge/release, apply all ordered strategic migrations through the controlled Lovable Cloud non-production path and verify at minimum:

- RLS isolation with two users;
- global vs offering-specific policy precedence;
- disabled policy → BLOCK;
- no applicable policy → BLOCK;
- missing bounded-execution thresholds rejected at DB level;
- unknown confidence/commitment blocks when required;
- commitment/currency/reversibility gates;
- hard-to-reverse → executive approval;
- legal/brand approval routing;
- rejected approval → BLOCK;
- stale approval/evaluation invalidation after decision change;
- stale approval/evaluation invalidation after policy change;
- stop-rule breaches;
- manual-halt behavior;
- bounded execution without current ALLOW rejected by DB trigger;
- owner cannot link another user's app/decision/policy;
- audit log cannot be forged by authenticated client;
- existing content/autopilot behavior remains unchanged.

Repository CI is necessary but not sufficient for these database/runtime checks.
