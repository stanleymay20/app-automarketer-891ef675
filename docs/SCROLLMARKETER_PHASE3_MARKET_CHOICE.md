# ScrollMarketer Phase 3 — Opportunity and Market Choice

Status: implemented in draft PR #9; repository validation required on final head before merge
Date: 2026-10-17

## Purpose

This slice turns the earlier strategic doctrine into a concrete market/segment choice workflow without pretending that missing market facts are known.

The system should help answer:

- Which market/segment should we investigate first?
- Where might there be white space?
- Which route to market appears feasible?
- How much evidence supports the option?
- What are the pioneering, regulatory, competitive and capital burdens?
- What is the smallest reversible validation step before larger commitment?

It does **not** claim to forecast market success, TAM, ROI or competitor behavior from the scores alone.

## Existing capabilities reused

Phase 3 deliberately sits on top of existing ScrollMarketer primitives rather than creating a parallel intelligence stack:

- `market_signals`
- `competitor_signals`
- `distribution_targets`
- MMM/attribution evidence
- `strategic_evidence_items`
- `strategic_questions`
- `growth_goals`
- `strategic_decisions`

Existing distribution targets are shown as app-level route-to-market context only. They are not automatically treated as evidence that a particular country or segment is accessible.

## Database migration

Migration:

`supabase/migrations/20261017180000_market_choice_engine.sql`

Apply only after:

1. `20261017162000_strategic_objectives_decision_ledger.sql`
2. `20261017170000_evidence_uncertainty_engine.sql`

The Phase 3 migration creates `strategic_market_options` and adds an optional `market_option_id` link to `strategic_decisions`.

## Market option model

A market option contains:

- market
- optional segment
- linked strategic objective
- unmet need
- competitor gap
- white-space hypothesis
- route to market
- distribution constraints
- entry mode
- timing posture
- commitment class
- optional estimated commitment amount/currency
- ten evidence-backed factor scores
- evidence confidence
- evidence coverage
- attractiveness score
- decision-readiness score
- white-space proxy
- status
- next reversible test
- evidence/provenance notes

Unknown score inputs remain `NULL`.

## Factor model

Positive factors, where higher is more attractive:

- demand — weight 18%
- growth — 12%
- customer value — 14%
- strategic fit — 14%
- accessibility — 10%
- distribution readiness — 10%

Burden/risk factors, where higher is worse and therefore inverted for attractiveness:

- competition intensity — 8%
- regulatory risk — 5%
- pioneering cost — 5%
- capital intensity — 4%

Weights total 100% when all factors are known.

### Unknown-factor rule

Unknown factors are not replaced by `50`, zero, category averages, model guesses or any other silent default.

The weighted mean uses only known factors, and `evidence_coverage` records how much of the ten-factor model is actually populated.

The system refuses to publish an attractiveness score until at least four of the ten factors are known.

## Attractiveness score

For known positive factors, the observed score contributes directly.

For known burden factors, the score is inverted:

`attractive_component = 100 - burden_score`

The final attractiveness score is the weighted mean across known factors only.

This is a prioritisation model, not expected return.

## Evidence coverage

`evidence_coverage = known_factor_count / 10 × 100`

A high attractiveness score with 40% coverage must not be displayed as equivalent to the same attractiveness score with 100% coverage.

## Decision-readiness score

When attractiveness and evidence confidence are both available:

`decision_readiness = attractiveness × evidence_coverage × evidence_confidence`

Coverage and confidence are normalised to 0–1 before multiplication.

Example:

- attractiveness: 80
- coverage: 70%
- evidence confidence: 75%

Decision readiness = `80 × 0.70 × 0.75 = 42`

This intentionally penalises incomplete or weakly supported assessments.

It is **not** expected ROI, probability of success, TAM, NPV or financial return.

## White-space proxy

A white-space proxy is calculated only when all three inputs are known:

- demand
- customer value
- competition intensity

Formula:

`white_space = demand × 40% + customer_value × 25% + (100 - competition_intensity) × 35%`

This proxy is only a prioritisation aid. It does **not** prove that an unmet need exists or that a competitor is weak.

The UI therefore keeps `white_space_hypothesis` separate from `white_space_score`.

## Entry and timing model

Supported entry modes:

- unknown
- digital direct
- export
- partner
- license
- franchise
- joint venture
- owned operation
- other

Supported timing postures:

- unknown
- first mover
- fast follower
- wait

These are recorded strategic choices, not automatically generated truths.

## Commitment and pioneering cost

Each market option records:

- commitment class: reversible / partly reversible / hard to reverse
- optional estimated commitment amount
- pioneering-cost score
- capital-intensity score

The platform should prefer reversible validation while evidence is weak.

Phase 3 does not automatically authorize entry, subsidiary formation, pricing changes or capital deployment.

## Market Choice UI

`/strategy` now contains **Market choice & white space**.

Users can:

- add a market/segment option
- leave unknown scores blank
- edit assessments as evidence improves
- record route-to-market and distribution constraints
- record white-space hypotheses separately from scores
- choose entry mode and timing posture
- record pioneering/capital burden
- see attractiveness, coverage, confidence and decision readiness together
- see missing evidence explicitly
- mark an option candidate/rejected
- propose a reversible validation decision

## Decision integration

`strategic_decisions.market_option_id` links a proposed decision back to the assessment that generated it.

The **Propose validation** action deliberately creates a `test` decision, not an automatic `enter` decision.

The recommendation uses the option's explicit `next_test` when available. Otherwise it proposes a generic reversible validation step.

The decision's `next_information_needed` is populated from missing market factors when possible, which then flows into the existing strategic-question system.

## Ownership and security

`strategic_market_options` uses owner-scoped RLS.

Additional trigger validation ensures:

- the linked app belongs to the same user
- the linked strategic objective belongs to the same user
- a strategic decision cannot link to another user's market option

No service-role credential is exposed client-side.

## Important evidence rule

Existing AI-generated market/competitor signals are **not automatically promoted to verified market evidence**.

If a model-generated signal is used, it should remain classified as model/inference/hypothesis until its source is checked and the supporting observation is recorded in the evidence register.

This avoids turning plausible model output into false market certainty.

## Release gates

Do not merge/deploy Phase 3 merely because TypeScript compiles.

Required release sequence:

1. exact-head repository lint/test/build green
2. review all three strategic SQL migrations
3. apply migrations in order through the controlled Lovable Cloud path in non-production/preview
4. verify owner-scoped RLS with at least two test users
5. verify market option create/edit/rank behavior
6. verify NULL/unknown factors remain unknown
7. verify database scores against hand-calculated examples
8. verify market-option-to-decision linkage
9. verify `next_information_needed` creates/updates the expected strategic question behavior
10. verify campaign generation remains functional
11. only then consider merge and production release

## Next slice

Phase 4 is strategy simulation:

- scenario objects
- move/countermove trees
- sensitivity analysis
- competitor response probabilities only from observable historical behavior
- compare options under multiple plausible futures
- recommend reversible tests before hard-to-reverse commitments

Do not build a fake deterministic competitor oracle. Probabilities must remain evidence-backed and uncertainty must remain visible.
