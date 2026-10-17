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

Each question records:

- current confidence
- decision impact
- answerability
- urgency
- expected effort
- status and answer

When a strategic decision is created with `next_information_needed`, a database trigger turns that statement into a tracked question. Hard-to-reverse decisions receive a higher default decision-impact input than reversible ones. These are explicit deterministic defaults, not model-generated certainty.

### Information-value proxy

The system uses a deterministic prioritisation proxy:

`information_value_score = uncertainty × decision impact × answerability`

where uncertainty is `100 - current_confidence`, and all inputs are normalised to 0–100. The stored score is therefore also 0–100.

This score is **not expected monetary value** and must not be presented as such. It ranks questions by how much decision uncertainty they may reduce, given likely impact and answerability. Urgency and effort remain visible separately rather than being hidden inside the score.

### Next-best-question workflow

`/strategy` contains an Evidence & Uncertainty panel that:

- shows observations, assumptions, unresolved unknowns and recorded confidence
- lets the user record evidence/uncertainty with provenance
- lets the user add decision questions
- ranks open questions by information-value score and urgency
- exposes the highest-ranked question as the next best question
- records answers without pretending the answer itself is automatically verified evidence
- asks the user to add supporting observations separately

This preserves the difference between learning that something was said and proving that the underlying claim is true.

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

Decision readiness is deliberately conservative:

`decision_readiness = attractiveness × evidence_coverage × evidence_confidence`

Coverage and confidence are normalised to 0–1. This is a prioritisation proxy, not ROI, NPV, TAM or probability of success.

### White-space doctrine

The white-space proxy requires demand, customer value and competition inputs. It does not prove an unmet need. The user records a white-space hypothesis separately, preserving the distinction between score and claim.

### Route-to-market reuse

The market-choice UI surfaces existing `distribution_targets` as app-level context. Existing distribution scores are not automatically treated as evidence that a specific country is accessible.

### Reversible validation integration

A market option can create a proposed `test` decision linked by `strategic_decisions.market_option_id`.

This deliberately does not create or approve an `enter` decision. Missing market factors populate `next_information_needed`, which flows into the strategic-question system.

### Ownership integrity

In addition to owner-scoped RLS, database triggers verify that linked app/objective/market-option records belong to the same user.

## Repository validation state

Latest exact head validated before this documentation update: `9268849dadd4eaa4fa93fecf2d7e0066d66c8d43`.

GitHub Actions run `39043640328` on that exact head:

- lint: PASS
- test: PASS
- build: PASS

Because this documentation update itself creates a new commit, it does not substitute for final exact-head validation before merge. Reconfirm CI on the final branch head.

## Important deployment constraint

The `/strategy` page now depends on all three additive database migrations, in order:

- `supabase/migrations/20261017162000_strategic_objectives_decision_ledger.sql`
- `supabase/migrations/20261017170000_evidence_uncertainty_engine.sql`
- `supabase/migrations/20261017180000_market_choice_engine.sql`

Do **not** deploy the UI to a runtime where these migrations have not been applied in order. Do not apply them directly to production without the normal controlled Lovable Cloud migration/release path and validation.

## Next implementation phases

### Phase 4 — Simulation

- scenario objects
- move/countermove trees
- sensitivity analysis
- competitor response probabilities based only on observable historical behavior
- compare market/strategy choices under multiple plausible futures
- reversible experiment recommendation before hard commitment

### Phase 5 — Authority and deterministic governance

- policy-backed authority thresholds
- approval requirements by risk/reversibility/capital/legal impact
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
