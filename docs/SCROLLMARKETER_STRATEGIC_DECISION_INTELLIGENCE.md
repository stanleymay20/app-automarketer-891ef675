# ScrollMarketer Strategic Decision Intelligence

Status: implementation doctrine and continuation handoff
Date: 2026-10-17

## Product direction

ScrollMarketer is evolving from AI marketing automation into a **Commercial Decision Intelligence + Growth Execution** system.

The product should answer a higher-order question before generating tactics:

> What is the business trying to achieve, where should it compete, what evidence supports the move, how reversible is the commitment, and what is the smallest valid next action?

Marketing is one execution option inside that decision system. The system must also be able to recommend research, waiting, testing, partnering, repositioning, product changes, pricing changes, market entry/exit, or scaling.

## Core invariants

1. **Objectives precede campaigns.** Campaigns are children of a measurable strategic objective, never the top-level business object.
2. **Evidence is not inference.** Observations, assumptions, unknowns and hypotheses must remain distinguishable.
3. **Unknown stays unknown.** Do not fabricate market facts, competitor motives, customer demand, economics or regulatory conclusions.
4. **Commit in proportion to evidence.** Prefer reversible learning under uncertainty; increase commitment only as evidence improves.
5. **Execution is separate from recommendation.** A recommendation can be generated without automatically authorizing execution.
6. **Hard-to-reverse decisions require stronger governance.** Major pricing, market-entry, legal, brand or capital commitments should not be treated like routine campaign optimization.
7. **Optimize business value, not vanity metrics.** Clicks and impressions are evidence inputs, not the ultimate objective.
8. **Preserve strategic memory.** Store what was known at decision time, what was decided, why, what happened and what was learned.
9. **Global learning is multidirectional.** A useful mechanism learned in any market may be tested in other markets; do not assume headquarters or one geography is always the source of truth.
10. **Do not weaken existing security, RLS, CI, approval or audit controls to ship strategy features.**
11. **Autonomy is policy-bounded.** Probabilistic recommendations never imply execution authority; deterministic governance decides whether a bounded action may proceed.
12. **Approval must stay fresh.** A material decision or policy change invalidates reuse of an older approval/evaluation.
13. **Outcome is not mechanism.** A measured result may justify a lesson or hypothesis, but stronger causal/transferability states require explicit evidence or transfer testing.

## Four nested loops

### 1. Intelligence loop
Sense -> verify -> update the commercial world model.

### 2. Strategy loop
Find opportunity -> expose uncertainty -> simulate -> choose -> allocate.

### 3. Execution loop
Experiment -> launch -> measure -> optimize within authority.

### 4. Learning loop
Explain outcome -> store mechanism -> update beliefs -> transfer learning.

These loops operate at different speeds. Real-time ad optimization must not cause constant strategic repositioning.

## Commercial Decision Graph

Long-term product moat should be an auditable graph connecting:

- markets
- customers and segments
- needs/problems
- products/offers
- customer value
- pricing
- competitors
- channels/distribution
- partners
- strategic objectives
- evidence and uncertainty
- scenarios and sensitivities
- governance policies and approvals
- recommendations/decisions
- experiments/campaigns
- actions
- outcomes
- mechanism hypotheses
- transfer tests
- durable learnings

The graph must capture both current state and decision history.

## Implementation branch

Branch: `feature/strategic-objectives-decision-ledger`

The work deliberately extends existing primitives instead of creating a parallel product.

## Slice 1 — Strategic objectives and decision ledger

Existing `growth_goals` remains the measurable strategic-objective layer and `strategic_decisions` records recommendation, evidence, assumptions, unknowns, confidence, reversibility, authority, execution and outcomes. `/strategy` provides objective creation, proposed decision recording and manual approval/rejection. Campaign generation reads active strategic context rather than treating campaigns as the top-level object.

## Slice 2 — Evidence and uncertainty engine

Migration: `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`

`strategic_evidence_items` preserves the distinction between observation, inference, assumption and unknown. `strategic_questions` ranks unresolved questions using a deterministic information-value proxy:

`information_value_score = uncertainty × decision impact × answerability`

The score is a prioritisation aid, not expected monetary value.

## Slice 3 — Opportunity and market choice

Detailed handoff: `docs/SCROLLMARKETER_PHASE3_MARKET_CHOICE.md`

Migration: `supabase/migrations/20261017180000_market_choice_engine.sql`

`strategic_market_options` adds evidence-aware market/segment comparison, route-to-market constraints, entry/timing posture, pioneering cost and strategic commitment analysis. Unknown factors remain `NULL`; attractiveness is not emitted until at least four factors are known.

`decision_readiness = attractiveness × evidence_coverage × evidence_confidence`

This is a prioritisation proxy, not ROI, NPV, TAM or probability of success.

## Slice 4 — Strategy simulation

Detailed handoff: `docs/SCROLLMARKETER_PHASE4_STRATEGY_SIMULATION.md`

Migration: `supabase/migrations/20261017190000_strategy_simulation_engine.sql`

Phase 4 adds scenario containers, move/countermove branches, explicit low/base/high sensitivities, and decision-holds/changes analysis.

Current `competitor_signals` are ephemeral refreshed snapshots, not durable behavior history. Competitor likelihood therefore stays unknown unless the user explicitly records a manual assumption or links historical observation evidence with response/comparable counts.

Observed historical frequency remains descriptive history, not a guarantee of future probability.

## Slice 5 — Deterministic governance and authority

Detailed handoff: `docs/SCROLLMARKETER_PHASE5_GOVERNANCE_AUTHORITY.md`

Migrations:

- `supabase/migrations/20261017200000_deterministic_governance_engine.sql`
- `supabase/migrations/20261017201000_governance_freshness_guards.sql`
- `supabase/migrations/20261017202000_governance_fail_closed_actions.sql`

Phase 5 adds:

- `strategic_governance_policies`
- `strategic_approval_requests`
- `strategic_stop_rules`
- `strategic_governance_evaluations`
- append-only `strategic_action_log`
- `strategic_decisions.execution_mode`
- Governance & Authority panel in `/strategy`

### Authority doctrine

A recommendation never implies authority. A `bounded_execute` policy is invalid unless the owner explicitly configures minimum confidence, maximum commitment amount/currency, and allowed reversibility classes. Policies are created disabled. No enabled applicable policy means bounded autonomous execution is blocked.

### Approval doctrine

Every bounded-autonomous strategic decision must already be `approved`. Policies may additionally require human, legal, brand or executive approval. Hard-to-reverse decisions always require executive approval.

### Freshness doctrine

Governance evaluations and approval requests are bound to fingerprints of the material decision state and selected policy version. A material decision or policy change invalidates stale approvals/evaluations. Bounded execution requires a fresh ALLOW matching current decision and policy fingerprints.

### Stop-rule doctrine

Machine-checkable rules currently cover confidence floor, commitment ceiling, deadline and manual halt. Unknown confidence/commitment is not silently treated as safe when the corresponding rule exists.

### Existing autonomy preserved

Existing `automation_policies`, `autopilot_settings` and their domain-specific behavior remain intact. Strategic governance does not silently replace the existing content or prospecting control planes.

### Runtime boundary

Phase 5 establishes the deterministic strategic execution gate; it does not yet attach a generic side-effect executor or continuous external-metric monitor. Before a bounded-autonomous strategic decision enters or changes execution state, the database requires a fresh ALLOW and no stop-rule breach. Future strategic executors must use that gate before governed side effects.

## Slice 6 — Strategic memory and causal learning

Detailed handoff: `docs/SCROLLMARKETER_PHASE6_STRATEGIC_MEMORY.md`

Migrations:

- `supabase/migrations/20261017210000_strategic_memory_causal_learning.sql`
- `supabase/migrations/20261017211000_strategic_memory_epistemic_guards.sql`

Phase 6 extends the existing durable `learning_events` log rather than creating a competing memory store. Existing tactical `learning_insights` remains the regenerated operational pattern cache and is not silently promoted into causal knowledge.

Durable strategic learning now separates:

- action/intervention
- context and source snapshot
- observed outcome
- mechanism hypothesis
- causal-status confidence
- evidence that supports/challenges/provides context
- transferability scope
- explicit cross-context transfer tests
- corrections/invalidation without erasing history

### Causal doctrine

New learning starts conservatively as unknown/correlation/plausible. Stronger states are evidence-backed review states:

- supported requires validated supporting observation evidence or a completed supporting transfer test;
- challenged requires validated challenging observation evidence or an appropriate completed transfer result;
- falsified requires validated challenging experiment evidence or a completed falsifying transfer test.

`Supported` still does not mean causation is proven.

### Transfer doctrine

A transfer test requires an explicit source mechanism hypothesis. Completion requires an explicit result. `tested` transferability requires a completed transfer test; `not_transferable` requires a challenged/falsified completed transfer result. Completing a transfer test never auto-promotes the source learning.

### Memory-history doctrine

Strategic learning is durable. Authenticated clients invalidate or supersede strategic memory rather than deleting it. Corrections can mark an older learning superseded while preserving the historical record.

### Feedback-loop boundary

Strategic memory is not automatically injected back into campaign generation or autonomous execution in Phase 6. That avoids self-reinforcing model loops before a later Commercial Decision Graph/policy layer defines which reviewed memories are eligible for automated reuse.

## Repository validation state

Latest integrated Phase 6 code head before the documentation commits:

`5b05a4e9caf41b3ab40ee19627361c0988c16c18`

GitHub Actions run `39048284372`:

- lint: PASS
- test: PASS
- build: PASS

Because the documentation commits create later branch heads, final merge review must still confirm exact-head CI on the final commit selected for merge.

## Important deployment constraint

The `/strategy` page depends on all strategic migrations in order:

- `supabase/migrations/20261017162000_strategic_objectives_decision_ledger.sql`
- `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`
- `supabase/migrations/20261017180000_market_choice_engine.sql`
- `supabase/migrations/20261017190000_strategy_simulation_engine.sql`
- `supabase/migrations/20261017200000_deterministic_governance_engine.sql`
- `supabase/migrations/20261017201000_governance_freshness_guards.sql`
- `supabase/migrations/20261017202000_governance_fail_closed_actions.sql`
- `supabase/migrations/20261017210000_strategic_memory_causal_learning.sql`
- `supabase/migrations/20261017211000_strategic_memory_epistemic_guards.sql`

Do **not** deploy `/strategy` to a runtime where these migrations have not been reviewed and applied in order. Do not apply them directly to production without the controlled Lovable Cloud migration/release path and non-production validation.

## Next implementation phase

### Phase 7 — Commercial world model

Unify company, market, customer, competitor, product, pricing, channel, partner, strategy, experiment, governance, action, outcome, evidence, mechanism and learning entities into a queryable Commercial Decision Graph.

Phase 7 should define explicit reuse policies for strategic memory rather than allowing every stored lesson to influence every future recommendation.

## Engineering continuation rules

- Reverse-engineer current behavior before modifying it.
- Prefer extending existing tables/functions when semantics genuinely match.
- Avoid parallel implementations.
- Keep migrations additive until data migration/removal is explicitly planned.
- RLS must remain enabled for user-owned strategic data.
- Never expose service-role credentials to the client.
- Preserve epistemic labels: observation, inference, hypothesis and causal state are not interchangeable.
- Do not call work complete until exact branch/head has passed the repository's required build/lint/test checks.
- Do not merge or deploy merely because code compiles.
- Database migration application, managed-runtime validation and production release are separate gates.
