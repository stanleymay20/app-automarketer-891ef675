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
- recommendations/decisions
- experiments/campaigns
- outcomes
- learnings

The graph must capture both current state and decision history.

## Implementation branch

Branch: `feature/strategic-objectives-decision-ledger`

The work deliberately extends existing primitives instead of creating a parallel product.

## Slice 1 — Strategic objectives and decision ledger

### Strategic objectives

Existing `growth_goals` remains the measurable objective table and gains additive strategic context:

- `objective_name`
- `strategic_rationale`
- `target_market`
- `target_segment`
- `assumptions`
- `constraints`
- `evidence_threshold`
- `commitment_class`
- `risk_tolerance`

Legacy goals remain valid. Missing strategic context must remain missing rather than being invented.

### Strategic decision ledger

New table: `strategic_decisions`.

It records:

- decision/action type
- recommendation and rationale
- evidence
- assumptions
- unknowns
- sensitivities
- confidence
- expected upside/downside
- reversibility
- optional capital commitment
- authority level
- status/approval/execution timestamps
- next information needed
- success/kill conditions
- outcome summary

RLS is owner-scoped. Recommendation and execution remain separate states.

### Strategy Command UI

Route: `/strategy`

Capabilities:

- select an offering/app
- create a strategic objective
- explicitly set market, segment, evidence gate and commitment class
- record a proposed strategic decision
- record confidence and next information needed
- approve/reject proposed decisions
- see active objectives and decision ledger

### Campaign integration

`generate-campaign` reads the active strategic objective and treats campaigns as subordinate execution. Its prompt is instructed to:

- use supplied evidence only
- avoid fabricating unknown context
- respect known market/segment constraints
- avoid unsupported claims
- prefer learning-oriented messaging when evidence is weak or commitment is hard to reverse

The campaign audit log captures a snapshot of the strategic objective used at generation time.

## Slice 2 — Evidence and uncertainty engine

Migration: `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`

### Evidence register

New table: `strategic_evidence_items`.

Every item must be explicitly classified as one of:

- `observation` — something actually observed or measured
- `inference` — an interpretation drawn from observations
- `assumption` — a belief being relied on but not established
- `unknown` — information that is currently missing

The record also carries source type/reference, confidence, evidence strength, impact if wrong, decision relevance, status and optional verification/resolution fields.

The UI must never promote an inference or assumption into an observation merely because confidence is high. Validation changes status; it does not rewrite provenance.

### Assumption and unknown lifecycle

Evidence states are:

- `active`
- `validated`
- `invalidated`
- `resolved`
- `superseded`

Unknowns can be resolved. Assumptions or inferences can be validated/invalidated while their original classification remains auditable.

### Decision questions

New table: `strategic_questions`.

Each question records current confidence, decision impact, answerability, urgency, effort, status and answer.

When a strategic decision is created with `next_information_needed`, a database trigger turns that statement into a tracked question. Hard-to-reverse decisions receive a higher default decision-impact input than reversible ones. These are explicit deterministic defaults, not model-generated certainty.

### Information-value proxy

`information_value_score = uncertainty × decision impact × answerability`

where uncertainty is `100 - current_confidence`, with inputs normalised to 0–100.

This score is **not expected monetary value**. It ranks questions by how much decision uncertainty they may reduce, given likely impact and answerability.

### Next-best-question workflow

`/strategy` contains an Evidence & Uncertainty panel that:

- shows observations, assumptions, unresolved unknowns and recorded confidence
- records evidence/uncertainty with provenance
- ranks open questions by information-value score and urgency
- exposes the highest-ranked question as the next best question
- records answers without pretending the answer itself is automatically verified evidence

## Slice 3 — Opportunity and market choice

Detailed handoff: `docs/SCROLLMARKETER_PHASE3_MARKET_CHOICE.md`

Migration: `supabase/migrations/20261017180000_market_choice_engine.sql`

New table: `strategic_market_options`.

Phase 3 adds evidence-aware market/segment ranking with:

- market and optional segment
- unmet need and competitor-gap evidence
- white-space hypothesis kept separate from white-space scoring
- route-to-market and distribution constraints
- entry mode and timing posture
- reversibility/commitment class and optional capital commitment
- ten explicit opportunity/risk factors
- evidence coverage and evidence confidence
- attractiveness, white-space and decision-readiness proxies
- next reversible validation test
- link from market option to proposed strategic decision

### Unknown-factor doctrine

Unknown factors remain `NULL`; they are never silently replaced by neutral scores or model guesses.

Attractiveness is not emitted until at least four of ten factors are known. Evidence coverage is always shown next to attractiveness.

`decision_readiness = attractiveness × evidence_coverage × evidence_confidence`

Coverage and confidence are normalised to 0–1. This is a prioritisation proxy, not ROI, NPV, TAM or probability of success.

### White-space doctrine

The white-space proxy requires demand, customer value and competition inputs. It does not prove an unmet need. The user records a white-space hypothesis separately.

### Route-to-market reuse

The market-choice UI surfaces existing `distribution_targets` as app-level context. Existing distribution scores are not automatically treated as evidence that a specific country is accessible.

### Reversible validation integration

A market option can create a proposed `test` decision linked by `strategic_decisions.market_option_id`.

This deliberately does not create or approve an `enter` decision. Missing market factors populate `next_information_needed`, which flows into the strategic-question system.

### Ownership integrity

In addition to owner-scoped RLS, database triggers verify that linked app/objective/market-option records belong to the same user.

## Slice 4 — Strategy simulation

Detailed handoff: `docs/SCROLLMARKETER_PHASE4_STRATEGY_SIMULATION.md`

Migration: `supabase/migrations/20261017190000_strategy_simulation_engine.sql`

Phase 4 adds:

- `strategic_scenarios`
- `strategic_scenario_branches`
- `strategic_sensitivity_tests`
- move/countermove trees
- explicit decision-holds / decision-changes assessment
- reversible response planning
- low/base/high sensitivity cases
- scenario conclusions

### Competitor-history constraint

Reverse engineering showed that current `competitor_signals` are refreshed by deleting prior app-level signals and inserting a new snapshot. They are therefore **not durable behavioral history** and must not be used to manufacture competitor-response probabilities.

Historical competitor-response evidence must be stored as explicit `strategic_evidence_items` observations.

### Likelihood doctrine

A scenario branch has one of three likelihood bases:

- `unknown` — likelihood remains `NULL`
- `manual_assumption` — an explicit subjective percentage, always labeled as assumption
- `observed_frequency` — requires linked observation evidence plus response/comparable counts

For observed frequency:

`historical_frequency = observed_response_count / comparable_event_count × 100`

The result is descriptive history, not a calibrated guarantee of future behavior.

### Stress proxy

For a branch that may change the decision and has known likelihood:

`stress_score = likelihood × absolute impact`

This is a prioritisation aid, not expected loss or expected financial value.

### Robustness view

The Scenario Lab reports how often the current decision holds or changes across **assessed branches**. This is intentionally not probability-weighted.

### Sensitivity doctrine

Sensitivity cases store explicit low/base/high inputs and outcomes. The system does not invent the ranges or outputs, and every case records whether its basis is observation, experiment, assumption, model or other.

### Scenario Lab UI

`/strategy` now supports:

- create scenario linked to objective/decision/market option
- define base move and decision question
- add root branches and nested countermoves
- leave likelihood unknown
- record manual assumptions explicitly
- use historical frequency only with observation evidence
- assess impact and whether the decision holds/changes
- prepare a response and its reversibility
- record sensitivity cases
- save a scenario conclusion

## Repository validation state

Latest code head validated before the Phase 4 documentation commits:

`d5b201f7d5671952a04f93754e48519902515918`

GitHub Actions run `39044192891`:

- lint: PASS
- test: PASS
- build: PASS

Documentation commits after that code validation still require final exact-head CI before merge.

## Important deployment constraint

The `/strategy` page now depends on all four additive database migrations, in order:

- `supabase/migrations/20261017162000_strategic_objectives_decision_ledger.sql`
- `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`
- `supabase/migrations/20261017180000_market_choice_engine.sql`
- `supabase/migrations/20261017190000_strategy_simulation_engine.sql`

Do **not** deploy the UI to a runtime where these migrations have not been applied in order. Do not apply them directly to production without the normal controlled Lovable Cloud migration/release path and validation.

## Next implementation phases

### Phase 5 — Authority and deterministic governance

- policy-backed authority thresholds
- approval requirements by risk/reversibility/capital/legal/brand impact
- bounded autonomous execution
- kill conditions and automatic stop rules
- complete decision/action audit chain

Thresholds must be explicitly configured or approved; do not invent arbitrary capital limits in code.

### Phase 6 — Strategic memory and causal learning

Store:

- action
- context
- outcome
- mechanism hypothesis
- confidence
- transferability

Use postmortems for both wins and failures. Do not confuse correlation with causation.

### Phase 7 — Commercial world model

Unify company, market, customer, competitor, product, pricing, channel, partner, strategy, experiment and outcome entities into a queryable Commercial Decision Graph.

## Engineering continuation rules

- Reverse-engineer current behavior before modifying it.
- Prefer extending existing tables/functions when semantics genuinely match.
- Avoid parallel implementations.
- Keep migrations additive until data migration/removal is explicitly planned.
- RLS must remain enabled for user-owned strategic data.
- Never expose service-role credentials to the client.
- Do not call work complete until exact branch/head has passed the repository's required build/lint/test checks.
- Do not merge or deploy merely because code compiles.
- Database migration application, managed-runtime validation and production release are separate gates.
