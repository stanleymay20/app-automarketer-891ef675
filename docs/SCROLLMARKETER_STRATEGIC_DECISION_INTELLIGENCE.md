# ScrollMarketer Strategic Decision Intelligence

Status: implementation doctrine and continuation handoff
Date: 2026-10-17

## Product direction

ScrollMarketer is evolving from AI marketing automation into a **Commercial Decision Intelligence + Growth Execution** system.

The product should answer a higher-order question before generating tactics:

> What is the business trying to achieve, where should it compete, what evidence supports the move, how reversible is the commitment, what does prior reviewed experience teach us, and what is the smallest valid next action?

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
12. **Approval must stay fresh.** Material decision, policy or reviewed-memory changes invalidate reuse of older approvals.
13. **Outcome is not mechanism.** A measured result may justify a lesson or hypothesis, but stronger causal/transferability states require explicit evidence or transfer testing.
14. **Native records remain authoritative.** The Commercial Decision Graph is a query/relationship layer over canonical domain records, not a duplicate database.
15. **Memory existence is not memory permission.** A strategic learning is not automatically prompt context; reuse requires an explicit, fresh purpose/scope review.
16. **Memory permission is not execution authority.** Reviewed-memory reuse never bypasses deterministic governance.

## Four nested loops

### 1. Intelligence loop
Sense -> verify -> update the commercial world model.

### 2. Strategy loop
Find opportunity -> expose uncertainty -> simulate -> choose -> allocate.

### 3. Execution loop
Experiment -> launch -> measure -> optimize within authority.

### 4. Learning loop
Explain outcome -> store mechanism -> update beliefs -> test transfer -> review reuse.

These loops operate at different speeds. Real-time optimization must not cause constant strategic repositioning.

## Commercial Decision Graph

The product moat should become an auditable graph connecting:

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
- reviewed memory-reuse permissions

The graph must capture both current state and decision history without replacing the native tables that own those records.

## Implementation branch

Branch: `feature/strategic-objectives-decision-ledger`

The work deliberately extends existing primitives instead of creating a parallel product.

## Slice 1 — Strategic objectives and decision ledger

Existing `growth_goals` remains the measurable strategic-objective layer and `strategic_decisions` records recommendation, evidence, assumptions, unknowns, confidence, reversibility, authority, execution and outcomes. `/strategy` provides objective creation, proposed decision recording and manual approval/rejection. Campaign generation reads active strategic context rather than treating campaigns as the top-level object.

## Slice 2 — Evidence and uncertainty engine

Migration: `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`

`strategic_evidence_items` preserves observation/inference/assumption/unknown distinctions. `strategic_questions` ranks unresolved questions with a deterministic information-value proxy:

`information_value_score = uncertainty × decision impact × answerability`

This is a prioritisation aid, not expected monetary value.

## Slice 3 — Opportunity and market choice

Detailed handoff: `docs/SCROLLMARKETER_PHASE3_MARKET_CHOICE.md`

Migration: `supabase/migrations/20261017180000_market_choice_engine.sql`

`strategic_market_options` adds evidence-aware market/segment comparison, route-to-market constraints, entry/timing posture, pioneering cost and strategic commitment analysis. Unknown factors remain `NULL`; attractiveness is not emitted until at least four factors are known.

`decision_readiness = attractiveness × evidence_coverage × evidence_confidence`

This is a prioritisation proxy, not ROI, NPV, TAM or probability of success.

## Slice 4 — Strategy simulation

Detailed handoff: `docs/SCROLLMARKETER_PHASE4_STRATEGY_SIMULATION.md`

Migration: `supabase/migrations/20261017190000_strategy_simulation_engine.sql`

Phase 4 adds scenario containers, move/countermove branches and explicit low/base/high sensitivities. Existing `competitor_signals` are ephemeral refreshed snapshots, not durable behavior history, so competitor likelihood remains unknown unless an explicit manual assumption or qualifying historical observation is supplied.

## Slice 5 — Deterministic governance and authority

Detailed handoff: `docs/SCROLLMARKETER_PHASE5_GOVERNANCE_AUTHORITY.md`

Migrations:

- `supabase/migrations/20261017200000_deterministic_governance_engine.sql`
- `supabase/migrations/20261017201000_governance_freshness_guards.sql`
- `supabase/migrations/20261017202000_governance_fail_closed_actions.sql`

Phase 5 adds governance policies, approval requests, stop rules, deterministic evaluations, an append-only action log and `strategic_decisions.execution_mode`.

A bounded-execution policy is invalid without explicit owner-configured confidence, commitment and reversibility limits. No applicable enabled policy means bounded autonomous execution is blocked. Hard-to-reverse decisions require executive approval. Decision/policy fingerprints prevent stale approval reuse.

Existing `automation_policies` and `autopilot_settings` remain intact; strategic governance does not silently replace those domain-specific control planes.

## Slice 6 — Strategic memory and causal learning

Detailed handoff: `docs/SCROLLMARKETER_PHASE6_STRATEGIC_MEMORY.md`

Migrations:

- `supabase/migrations/20261017210000_strategic_memory_causal_learning.sql`
- `supabase/migrations/20261017211000_strategic_memory_epistemic_guards.sql`

Phase 6 extends the existing durable `learning_events` log rather than creating a competing memory store. Tactical `learning_insights` remains a regenerated operational pattern cache and is not silently promoted into causal knowledge.

Strategic learning separates action/context, observed outcome, mechanism hypothesis, causal status, confidence, evidence links, transferability, transfer testing and corrections/invalidation.

Strong causal labels are evidence-backed review states. `supported` still does not mean causation is proven. Strategic history is durable: corrections supersede rather than erase, and authenticated clients do not delete strategic learnings.

Phase 6 deliberately does not automatically feed strategic memory back into generation or autonomy.

## Slice 7 — Commercial Decision Graph / Commercial World Model

Detailed handoff: `docs/SCROLLMARKETER_PHASE7_COMMERCIAL_WORLD_MODEL.md`

Migrations:

- `supabase/migrations/20261017220000_commercial_decision_graph.sql`
- `supabase/migrations/20261017221000_reviewed_memory_reuse.sql`
- `supabase/migrations/20261017222000_commercial_graph_memory_reuse_hardening.sql`
- `supabase/migrations/20261017223000_memory_reuse_review_history_guard.sql`

### Native-record doctrine

The graph does not clone ScrollMarketer's authoritative domain tables. `commercial_graph_nodes` is a `security_invoker` normalized read view over existing offerings, objectives, decisions, market options, scenarios, campaigns, personas, prospects, distribution targets, strategic evidence and strategic learning.

`commercial_graph_entities` exists only for commercially important concepts without a canonical native table, such as a stable competitor, partner, pricing offer, regulator or supplier.

### Relationship doctrine

`commercial_graph_relationships` combines two classes of edge:

- structural edges derived from authoritative native relationships;
- explicit semantic edges stored in `commercial_graph_edges`.

Structural edges are read-only consequences of native records. Semantic edges are explicit claims that may be app- or portfolio-scoped, manual/evidence/review based, nullable-confidence and revocable.

App-scoped edges cannot silently connect two different offerings. Cross-offering relations require explicit portfolio scope. Evidence-based edges require linked evidence.

### Generic-node integrity

`commercial_graph_node_app(...)` verifies that each semantic-edge endpoint exists and belongs to the requesting user. The hardening migration ensures an unknown/foreign UUID raises instead of being interpreted as an unscoped entity.

### Reviewed-memory reuse doctrine

`strategic_memory_reuse_reviews` separates **learning validity** from **permission to reuse that learning**.

Purposes currently include strategy recommendation, campaign/content generation, prospect qualification, market ranking, scenario planning and bounded autonomy.

Scopes are source offering, explicit target offering, or portfolio. A review starts pending. Only approved, active, unexpired, freshness-matching memory is exposed in `approved_strategic_memory_reuse`.

Approved reuse is bound to a material learning fingerprint. A material learning change invalidates the grant until fresh review. Approved grant purpose/scope/rationale/reviewer history is immutable; change requires revoke + fresh review. Revocation preserves the original approver identity.

### Bounded-autonomy memory doctrine

Bounded-autonomy reuse is stricter than advisory/generation reuse:

- current learning must be active and `supported`;
- portfolio-wide bounded-autonomy reuse is forbidden;
- cross-offering use requires tested transferability;
- cross-offering use requires a completed supporting transfer test for that exact target offering;
- the permission function rechecks current qualifying support at use time.

This still does not bypass Phase 5 governance.

### Strategy Command UI

`/strategy` now exposes the Commercial World Model for:

- focused graph-neighborhood inspection;
- structural vs semantic relationship visibility;
- durable external commercial entity creation only when no native record exists;
- explicit semantic-link recording/revocation;
- memory-reuse review creation;
- approval/rejection/revocation of memory reuse;
- visibility into fresh vs stale/expired reuse grants.

### Consumption boundary

Phase 7 establishes the graph and reviewed-memory contract but **does not yet inject approved strategic memory into generators or agents**. That remains a separate controlled phase to avoid self-reinforcing loops and hidden context use.

## Important deployment constraint

The `/strategy` page now depends on all strategic migrations in this exact order:

1. `supabase/migrations/20261017162000_strategic_objectives_decision_ledger.sql`
2. `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`
3. `supabase/migrations/20261017180000_market_choice_engine.sql`
4. `supabase/migrations/20261017190000_strategy_simulation_engine.sql`
5. `supabase/migrations/20261017200000_deterministic_governance_engine.sql`
6. `supabase/migrations/20261017201000_governance_freshness_guards.sql`
7. `supabase/migrations/20261017202000_governance_fail_closed_actions.sql`
8. `supabase/migrations/20261017210000_strategic_memory_causal_learning.sql`
9. `supabase/migrations/20261017211000_strategic_memory_epistemic_guards.sql`
10. `supabase/migrations/20261017220000_commercial_decision_graph.sql`
11. `supabase/migrations/20261017221000_reviewed_memory_reuse.sql`
12. `supabase/migrations/20261017222000_commercial_graph_memory_reuse_hardening.sql`
13. `supabase/migrations/20261017223000_memory_reuse_review_history_guard.sql`

Do **not** deploy `/strategy` where these migrations have not been reviewed and applied in order. Do not apply them directly to production without the controlled Lovable Cloud migration/release path and non-production validation.

## Repository validation state

The Phase 7 integrated UI/code head `73b9664cfa74383b8d24cad64177850a7268a90e` passed GitHub Actions run `39051727047`:

- lint: PASS
- test: PASS
- build: PASS

Later SQL/documentation hardening commits create newer branch heads. Final merge review must therefore re-run/confirm CI on the exact final head selected for merge.

Repository CI does not execute the managed database migrations and does not prove view/RLS/trigger correctness.

## Next controlled implementation phase

### Phase 8 — Controlled Decision Context Assembly

The next phase should consume the world model instead of creating another knowledge store.

A context assembler should:

1. receive a target offering and explicit purpose;
2. retrieve the relevant graph neighborhood;
3. retrieve evidence with provenance and unknowns;
4. retrieve only fresh, purpose-approved strategic memory;
5. retrieve applicable governance/authority state;
6. return a provenance-rich context package with causal/transferability labels intact;
7. begin with recommendation-only workflows before any bounded-autonomy consumption.

No generator should simply query all historical memory and treat it as truth.

## Engineering continuation rules

- Reverse-engineer current behavior before modifying it.
- Prefer extending existing tables/functions when semantics genuinely match.
- Avoid parallel implementations.
- Keep migrations additive until data migration/removal is explicitly planned.
- RLS must remain enabled for user-owned strategic data.
- Never expose service-role credentials to the client.
- Preserve epistemic labels: observation, inference, hypothesis, causal status and reuse permission are not interchangeable.
- Preserve native domain records as canonical; do not duplicate them into generic graph storage.
- No stored learning becomes automated context without explicit reviewed reuse permission.
- Do not call work complete until exact branch/head has passed required build/lint/test checks.
- Do not merge or deploy merely because code compiles.
- Database migration application, managed-runtime validation and production release are separate gates.
