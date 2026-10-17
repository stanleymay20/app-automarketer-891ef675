# ScrollMarketer Strategic Decision Intelligence

Status: implementation doctrine and continuation handoff  
Date: 2026-10-17

## Product direction

ScrollMarketer is evolving from AI marketing automation into **Commercial Decision Intelligence + Growth Execution**.

The product should answer a higher-order question before generating tactics:

> What is the business trying to achieve, where should it compete, what evidence supports the move, how reversible is the commitment, what does prior reviewed experience teach us, and what is the smallest valid next action?

Marketing is one execution option inside that decision system. Research, waiting, testing, partnering, repositioning, product/pricing changes, market entry/exit and scaling are also legitimate recommendations.

## Core invariants

1. **Objectives precede campaigns.** Campaigns serve a measurable strategic objective.
2. **Evidence is not inference.** Observation, inference, assumption, unknown and hypothesis stay distinct.
3. **Unknown stays unknown.** Never fabricate market, competitor, customer, economic or regulatory facts.
4. **Commit in proportion to evidence.** Prefer reversible learning while uncertainty is high.
5. **Recommendation is not execution authority.** Generation never silently authorizes action.
6. **Hard-to-reverse decisions receive stronger governance.**
7. **Optimize business value, not vanity metrics.**
8. **Preserve decision-time provenance and strategic memory.**
9. **Global learning can move in any direction, but transfer must be tested/reviewed.**
10. **Do not weaken security, RLS, CI, approval, audit or release gates.**
11. **Autonomy is policy-bounded and fail-closed.**
12. **Approval must stay fresh.** Material decision/policy/plan/memory changes invalidate reuse.
13. **Outcome is not mechanism and correlation is not causation.**
14. **Native domain records remain authoritative.** Generic graph storage must not duplicate them.
15. **Memory existence is not memory permission.**
16. **Memory permission is not execution authority.**
17. **An experiment is a bounded learning option beneath an approved decision, not a second strategy system.**
18. **Experiment `running` state is ledger state unless a separately governed executor is explicitly attached.**

## Four nested loops

### Intelligence
`Sense -> verify -> update commercial world model`

### Strategy
`Find opportunity -> expose uncertainty -> simulate -> choose -> allocate`

### Execution
`Experiment -> launch through an explicitly governed executor -> measure -> optimize within authority`

### Learning
`Explain outcome -> store mechanism hypothesis -> update beliefs -> test transfer -> review reuse`

These loops operate at different speeds. Tactical optimization must not continuously rewrite strategy.

## Commercial Decision Graph

The system connects markets, segments, needs, offers, customer value, pricing, competitors, channels, partners, objectives, evidence, uncertainty, scenarios, policies, decisions, experiments/campaigns, actions, outcomes, mechanism hypotheses, transfer tests, learnings and reviewed memory permissions.

The graph is a relationship/query layer over canonical records, not a replacement database.

## Implementation branch

Branch: `feature/strategic-objectives-decision-ledger`  
PR: `#9 Add Strategic Decision Intelligence foundation`

The work deliberately extends existing ScrollMarketer primitives rather than creating a replacement app.

## Phase 1 — Strategic Objectives & Decision Ledger

- existing `growth_goals` extended into strategic objectives;
- owner-scoped `strategic_decisions` records recommendation, evidence, uncertainty, reversibility, authority and outcome;
- `/strategy` command surface;
- campaigns consume strategy rather than becoming the top-level object.

Migration: `20261017162000_strategic_objectives_decision_ledger.sql`

## Phase 2 — Evidence & Uncertainty

- `strategic_evidence_items`: observation / inference / assumption / unknown;
- `strategic_questions` ranks questions with an information-value proxy;
- proxy = uncertainty × decision impact × answerability;
- proxy is not expected monetary value.

Migration: `20261017170000_evidence_uncertainty_engine.sql`

## Phase 3 — Opportunity & Market Choice

Detailed handoff: `docs/SCROLLMARKETER_PHASE3_MARKET_CHOICE.md`

- `strategic_market_options` adds market/segment, route-to-market, entry/timing, pioneering-cost and commitment analysis;
- unknown factors stay `NULL`;
- attractiveness requires a minimum known-factor base;
- decision readiness = attractiveness × evidence coverage × evidence confidence;
- scores are prioritisation proxies, not ROI/TAM/probability forecasts.

Migration: `20261017180000_market_choice_engine.sql`

## Phase 4 — Strategy Simulation

Detailed handoff: `docs/SCROLLMARKETER_PHASE4_STRATEGY_SIMULATION.md`

- scenarios, move/countermove branches, sensitivities;
- likelihood basis is unknown, manual assumption or observed historical frequency;
- ephemeral competitor snapshots are not durable behavioral history;
- unknown probabilities remain unknown.

Migration: `20261017190000_strategy_simulation_engine.sql`

## Phase 5 — Deterministic Governance & Authority

Detailed handoff: `docs/SCROLLMARKETER_PHASE5_GOVERNANCE_AUTHORITY.md`

- governance policies, approval requests, stop rules, deterministic evaluations, append-only action log;
- manual vs bounded-autonomous decision mode;
- bounded autonomy requires an explicitly configured policy and fails closed otherwise;
- decision/policy fingerprints prevent stale approval reuse;
- hard-to-reverse decisions require executive approval;
- existing content/prospect autopilot controls remain separate.

Migrations:

- `20261017200000_deterministic_governance_engine.sql`
- `20261017201000_governance_freshness_guards.sql`
- `20261017202000_governance_fail_closed_actions.sql`

## Phase 6 — Strategic Memory & Causal Learning

Detailed handoff: `docs/SCROLLMARKETER_PHASE6_STRATEGIC_MEMORY.md`

- extends durable `learning_events`; no parallel memory store;
- tactical `learning_insights` remains regenerated/non-causal;
- stores action/context, outcome, mechanism hypothesis, causal status, evidence, transferability and corrections;
- stronger causal/transfer labels require qualifying evidence/testing;
- corrections preserve history.

Migrations:

- `20261017210000_strategic_memory_causal_learning.sql`
- `20261017211000_strategic_memory_epistemic_guards.sql`

## Phase 7 — Commercial Decision Graph / World Model

Detailed handoff: `docs/SCROLLMARKETER_PHASE7_COMMERCIAL_WORLD_MODEL.md`

- `commercial_graph_nodes` and `commercial_graph_relationships` are `security_invoker` views over authoritative native records;
- semantic edges supplement structural relations;
- generic entities exist only where no canonical native record exists;
- owner/app integrity rejects foreign opaque UUIDs;
- memory reuse is separately reviewed by purpose/scope/fingerprint;
- reuse permission does not mean causal truth and never bypasses governance.

Migrations:

- `20261017220000_commercial_decision_graph.sql`
- `20261017221000_reviewed_memory_reuse.sql`
- `20261017222000_commercial_graph_memory_reuse_hardening.sql`
- `20261017223000_memory_reuse_review_history_guard.sql`

## Phase 8 — Controlled Decision Context Assembly

Detailed handoff: `docs/SCROLLMARKETER_PHASE8_CONTROLLED_DECISION_CONTEXT.md`

- immutable `strategic_context_snapshots`;
- deterministic context assembly from graph, validated observations, assumptions/inferences, unresolved unknowns, approved memory and governance;
- material context fingerprinting and immutable provenance;
- `generate-strategic-recommendations` creates proposed/manual decisions only;
- fabricated model references are discarded;
- weak evidence deterministically caps confidence;
- hard-to-reverse recommendations require executive approval;
- no execution side effects.

Migrations:

- `20261017230000_controlled_decision_context.sql`
- `20261017231000_strategic_decision_context_provenance.sql`
- `20261017232000_context_snapshot_provenance_guards.sql`

## Phase 9 — Recommendation-only Market Ranking & Scenario Planning

Detailed handoff: `docs/SCROLLMARKETER_PHASE9_MARKET_RANKING_SCENARIO_PLANNING.md`

- numeric market rank is deterministic from authoritative Phase 3 readiness data; AI cannot alter rank;
- insufficient evidence receives no numeric rank;
- ranking/assessment results are immutable snapshot-bound artifacts;
- scenario unknown likelihood remains `NULL`;
- manual likelihood remains visibly an assumption;
- unvalidated historical-frequency evidence is excluded from qualified aggregate stress;
- scenario assessment does not mutate scenario conclusions;
- market ranking does not mutate market scores/status;
- all outputs remain recommendation-only.

Migrations:

- `20261017240000_phase9_market_ranking_scenario_planning.sql`
- `20261017241000_phase9_epistemic_hardening.sql`

## Phase 10 — Experiment Portfolio & Real-options Planning

Detailed handoff: `docs/SCROLLMARKETER_PHASE10_EXPERIMENT_PORTFOLIO.md`

Phase 10 converts an already-approved strategic decision into a smaller bounded learning option.

Key controls:

- source decision must already be approved;
- experiment commitment can be reversible or partly reversible only;
- hypothesis, information objective, primary metric, cost ceiling, deadline, success conditions and kill conditions are mandatory;
- optional linkage to an open strategic question snapshots its information-value proxy;
- app/objective/market links are canonical to the source decision;
- a positive cost ceiling requires an explicit source-decision commitment, same currency, and cannot exceed that commitment;
- exact experiment plan + exact source decision are fingerprinted at review;
- material plan edits invalidate review and are forbidden after start;
- revocation preserves original approval history;
- start/resume requires fresh plan review, still-approved source decision and no current Phase 5 stop-rule breach;
- source-decision material changes or new stop-rule breaches stop running/paused experiment ledger state;
- observations are append-only for authenticated clients;
- structured kill gates and positive hard cost ceilings produce deterministic protective ledger stops;
- success observations do not automatically claim causation;
- `running` remains ledger state only—no external action is executed by Phase 10.

Deadline caveat: without a scheduler, clock-only expiry is enforced at start/resume and on later writes, not continuously at the exact deadline.

Migrations:

- `20261017250000_phase10_experiment_portfolio_real_options.sql`
- `20261017251000_phase10_experiment_hardening.sql`
- `20261017252000_phase10_relationship_integrity.sql`
- `20261017253000_phase10_governance_freshness.sql`

## Exact ordered strategic migration chain

1. `20261017162000_strategic_objectives_decision_ledger.sql`
2. `20261017170000_evidence_uncertainty_engine.sql`
3. `20261017180000_market_choice_engine.sql`
4. `20261017190000_strategy_simulation_engine.sql`
5. `20261017200000_deterministic_governance_engine.sql`
6. `20261017201000_governance_freshness_guards.sql`
7. `20261017202000_governance_fail_closed_actions.sql`
8. `20261017210000_strategic_memory_causal_learning.sql`
9. `20261017211000_strategic_memory_epistemic_guards.sql`
10. `20261017220000_commercial_decision_graph.sql`
11. `20261017221000_reviewed_memory_reuse.sql`
12. `20261017222000_commercial_graph_memory_reuse_hardening.sql`
13. `20261017223000_memory_reuse_review_history_guard.sql`
14. `20261017230000_controlled_decision_context.sql`
15. `20261017231000_strategic_decision_context_provenance.sql`
16. `20261017232000_context_snapshot_provenance_guards.sql`
17. `20261017240000_phase9_market_ranking_scenario_planning.sql`
18. `20261017241000_phase9_epistemic_hardening.sql`
19. `20261017250000_phase10_experiment_portfolio_real_options.sql`
20. `20261017251000_phase10_experiment_hardening.sql`
21. `20261017252000_phase10_relationship_integrity.sql`
22. `20261017253000_phase10_governance_freshness.sql`

Do **not** release `/strategy` into an environment where these migrations have not been reviewed and applied in this order through the controlled Lovable Cloud non-production migration path first.

## Release boundary

Repository lint/test/build is necessary but insufficient. It does not execute the SQL migration chain or prove managed PostgreSQL RLS, trigger ordering, RPC grants, `security_invoker` behavior, Edge Function deployment/authentication, cross-user isolation, or no-side-effect guarantees.

PR #9 must remain draft until managed-runtime validation passes the phase-specific gates in the detailed handoffs.

Nothing in Phases 1–10 should be called GA-ready merely because repository CI is green.

## Next controlled phase

After managed-runtime proof of Phase 10, the next useful slice is **Experiment Outcome -> Evidence -> Strategic Learning handoff**:

1. close completed/stopped experiment outcome explicitly;
2. generate reviewable evidence candidates from recorded observations;
3. create a postmortem/mechanism hypothesis without asserting causation;
4. require evidence review before stronger causal labels;
5. feed only reviewed learning through the existing Phase 7 memory-reuse contract.

Do not automatically turn a successful experiment into causal truth or an autonomous playbook.

## Engineering continuation rules

- Reverse-engineer current behavior before modifying it.
- Extend existing primitives where semantics match; avoid parallel systems.
- Keep migrations additive unless a separately reviewed data migration/removal is planned.
- RLS stays enabled for user-owned strategic data.
- Never expose service-role credentials to client code.
- Preserve epistemic labels and provenance.
- Preserve native domain records as canonical.
- No memory becomes automated context without reviewed reuse permission.
- No recommendation/experiment state becomes external execution without a separately governed executor.
- Exact branch head must pass lint/test/build after the final code/documentation commit chosen for merge.
- Managed-runtime migration validation and production release are separate gates.
