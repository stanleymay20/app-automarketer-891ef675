# ScrollMarketer Phase 8 — Controlled Decision Context Assembly

Status: repository implementation complete; managed-runtime validation required before merge/deployment.

## Objective

Phase 8 is the first safe consumer layer on top of the Commercial Decision Graph. It answers:

> Exactly what information is a recommendation workflow allowed to see, and what provenance proves that context was used?

The first consumer is intentionally recommendation-only. It may create **proposed strategic decisions** but cannot approve, execute, publish, spend, price, enter a market, contact prospects, or trigger another side effect.

## Core flow

`purpose -> selected app/focus -> deterministic context assembly -> immutable context fingerprint -> optional preview -> immutable snapshot -> AI recommendation -> deterministic citation validation -> proposed strategic decision -> human/governance review`

## Migrations

1. `supabase/migrations/20261017230000_controlled_decision_context.sql`
2. `supabase/migrations/20261017231000_strategic_decision_context_provenance.sql`
3. `supabase/migrations/20261017232000_context_snapshot_provenance_guards.sql`

These depend on all Phase 1–7 migrations being applied first.

## Context contract

`assemble_strategic_decision_context(...)` currently accepts only these recommendation-oriented purposes:

- `strategy_recommendation`
- `market_ranking`
- `scenario_planning`

It deliberately rejects bounded-autonomy context assembly in Phase 8.

The context contains:

### Offering

Authoritative `apps` fields for the selected offering.

### Strategic objectives

Current objectives with target market/segment, rationale, evidence threshold, commitment class, risk tolerance, constraints, assumptions, progress and deadline.

### Focused Commercial Decision Graph neighborhood

Only direct active relationships around the selected focus node are included. The focus must belong to the selected app. Portfolio/unscoped nodes cannot be silently used as an app-specific focus.

Graph relationships remain relational evidence only. A relationship never becomes proof of causation.

### Validated observations

Only `strategic_evidence_items` with:

- `item_type = observation`
- `status = validated`
- matching app ownership

are surfaced as `verified_observations`.

### Epistemic context

Active/validated `inference` and `assumption` records are supplied separately as `epistemic_context`. They are never merged into validated observations.

### Unresolved uncertainty

The context preserves:

- open `strategic_questions`, ranked by the existing information-value proxy;
- active `unknown` evidence records.

Recommendation generation is instructed to surface unresolved uncertainty rather than hide it.

### Approved strategic memory

Only records already visible through the Phase 7 `approved_strategic_memory_reuse` contract may enter the context, and only when the current purpose/scope permits reuse for the selected app.

A reviewed memory still carries its causal and transferability status. Approval for reuse does not turn a hypothesis into a fact.

### Governance context

Enabled app/portfolio strategic-governance policies are included. When the focus is a strategic decision, existing stop rules and approval requests are also included.

This context informs recommendations only. It does not grant execution authority or bypass Phase 5 governance.

## Context fingerprint

The deterministic context payload is fingerprinted before `assembled_at` is appended. The fingerprint therefore represents the material decision context rather than the clock time of the request.

`strategic_context_snapshots` stores:

- user/app
- purpose
- focus node
- context version
- fingerprint
- full context payload
- creation time

Authenticated users can read their snapshots but cannot directly insert/update/delete them. Snapshots are created through the controlled database function.

## Provenance immutability

Generated strategic decisions can link to the exact `strategy_recommendation` snapshot that produced them through `strategic_decisions.context_snapshot_id`.

The database rejects:

- cross-user snapshot links;
- cross-app snapshot links;
- non-strategy-recommendation snapshots on generated strategic decisions;
- later attempts to rewrite an existing decision's context snapshot.

A future `growth_recommendations.context_snapshot_id` link is also owner/app/purpose validated and immutable once set.

## Strategy recommendation generator

Edge function:

`supabase/functions/generate-strategic-recommendations/index.ts`

The function:

1. authenticates the user;
2. applies the existing rate-limit helper;
3. creates an immutable `strategy_recommendation` context snapshot;
4. sends only that controlled context to the model;
5. requires strict JSON recommendation output;
6. validates all cited observation/memory/question/unknown IDs against the actual snapshot;
7. drops fabricated/nonexistent references;
8. caps confidence when supporting context is weak;
9. inserts only `strategic_decisions.status = proposed`;
10. forces `execution_mode = manual`;
11. requires executive-approval authority for hard-to-reverse recommendations;
12. relies on the existing `next_information_needed` trigger to create tracked questions when appropriate.

The function does not approve or execute a decision.

## Confidence guardrails

Model confidence is not accepted blindly.

Current deterministic caps:

- no cited validated observation and no cited approved memory -> confidence <= 60;
- fewer than two cited validated observations and no cited `supported` memory -> confidence <= 80.

These are conservative caps, not claims that 60/80 correspond to statistical probabilities.

## Citation/provenance doctrine

Model output may cite only IDs already present in the snapshot:

- `evidence_refs` -> validated observation IDs;
- `memory_refs` -> approved strategic learning IDs;
- `question_refs` -> open strategic question IDs;
- `unknown_refs` -> active unknown-evidence IDs.

Unknown or fabricated IDs are discarded before database insertion.

The strategic decision's `evidence` field stores only validated observation IDs. The immutable `context_snapshot_id` is the provenance link for the full context, including approved memories and governance state.

## UI

`DecisionContextPanel` is mounted in `/strategy` after the Commercial World Model.

It supports:

- purpose selection;
- app-scoped focus selection;
- deterministic context preview without any model call;
- counts for graph nodes, relationships, validated facts, assumptions/inferences, open questions, unknowns, approved memories and policies;
- visible context warnings;
- inspection of validated observations, unresolved questions and approved memory;
- visible context fingerprint/version;
- recent immutable recommendation-context snapshots;
- explicit `Generate proposed decisions` action only for `strategy_recommendation`.

The UI explicitly states that recommendation generation does not approve or execute anything.

## What Phase 8 does NOT do

Phase 8 does not:

- automatically feed all stored memory into prompts;
- use regenerated `learning_insights` as strategic memory;
- invent missing market facts;
- treat graph edges as causal proof;
- authorize bounded autonomy;
- execute recommendations;
- bypass approval/governance policy;
- connect campaign/content generation to strategic memory yet;
- convert `market_ranking` or `scenario_planning` previews into autonomous actions.

## Managed-runtime validation gates

Repository lint/test/build is necessary but not sufficient. Before merge/deployment validate in controlled Lovable Cloud non-production:

1. all earlier Phase 1–7 migrations plus the three Phase 8 migrations apply in exact order;
2. `assemble_strategic_decision_context` rejects unauthenticated calls;
3. foreign app UUIDs are rejected;
4. foreign/cross-app focus nodes are rejected;
5. unsupported purposes, especially `bounded_autonomy`, are rejected;
6. context limits outside documented ranges are rejected;
7. validated observations include only validated `observation` records;
8. assumptions/inferences remain separate from observations;
9. open questions and unknown evidence stay visible;
10. pending/rejected/revoked/expired/stale memory grants never enter context;
11. purpose/scope rules for approved memories are respected;
12. `security_invoker` graph views continue to honor two-user RLS;
13. context fingerprint is stable for materially identical context and changes when material context changes;
14. authenticated clients cannot directly insert/update/delete snapshots;
15. snapshot creation writes the expected strategic audit event;
16. generated decisions point to the exact snapshot used;
17. cross-user/cross-app/wrong-purpose snapshot links are rejected;
18. decision snapshot provenance cannot be rewritten after insert;
19. future growth-recommendation snapshot links have the same ownership/app/provenance protection;
20. model-fabricated evidence/memory/question/unknown IDs are discarded;
21. no-support and weak-support confidence caps are enforced;
22. hard-to-reverse generated decisions use `executive_approval` authority;
23. every generated decision remains `proposed` and `manual` execution mode;
24. generated `next_information_needed` creates a tracked strategic question as expected;
25. no campaign, prospect outreach, publishing, pricing, spend or other external side effect occurs;
26. existing manual strategic-decision creation still works;
27. existing Phase 1–7 functionality remains unchanged.

## Next controlled slice

Phase 9 should reuse the same context contract for additional **recommendation-only** workflows, beginning with evidence-aware market ranking and scenario-planning assistance. Do not introduce autonomous execution until the Phase 8 context/snapshot/provenance behavior has been proven in the managed runtime.
