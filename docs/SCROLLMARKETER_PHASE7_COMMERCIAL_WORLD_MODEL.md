# ScrollMarketer Phase 7 — Commercial Decision Graph / Commercial World Model

Status: implemented on `feature/strategic-objectives-decision-ledger`; repository validation and managed-runtime validation are separate gates.

## Purpose

Phase 7 gives ScrollMarketer a queryable commercial world model without replacing the product's existing domain tables.

The core rule is:

> **Native business records remain authoritative. The graph exposes relationships between them; it does not copy them into a second source of truth.**

This matters because ScrollMarketer already has mature records for offerings, objectives, decisions, market options, scenarios, campaigns, personas, prospects, distribution targets, evidence and learning. Rebuilding those concepts as generic graph rows would create synchronization drift and weaken ownership/RLS guarantees.

Phase 7 therefore separates four things:

1. authoritative native records;
2. normalized read-only graph nodes;
3. structural relationships derived from native foreign keys;
4. explicit semantic relationships for claims the relational schema does not already encode.

It also adds a separate reviewed-memory reuse contract so the existence of strategic memory never silently turns into AI prompt context or autonomous authority.

## Ordered Phase 7 migrations

Phase 7 follows the nine migrations from Phases 1–6 and adds:

1. `supabase/migrations/20261017220000_commercial_decision_graph.sql`
2. `supabase/migrations/20261017221000_reviewed_memory_reuse.sql`
3. `supabase/migrations/20261017222000_commercial_graph_memory_reuse_hardening.sql`
4. `supabase/migrations/20261017223000_memory_reuse_review_history_guard.sql`

They remain unapplied to the managed Lovable Cloud runtime in this branch state.

## Native records remain canonical

The normalized graph uses native records for:

- offering/product: `apps`
- strategic objective: `growth_goals`
- strategic decision: `strategic_decisions`
- market/segment option: `strategic_market_options`
- strategic scenario: `strategic_scenarios`
- campaign: `campaigns`
- audience/persona: `personas`
- commercial prospect/account: `prospects`
- distribution opportunity/channel target: `distribution_targets`
- strategic learning: `learning_events`
- evidence/uncertainty: `strategic_evidence_items`

Those tables keep their existing write paths, RLS, business logic and lifecycle semantics.

The Commercial World Model does **not** create duplicate copies of them.

## Durable commercial entities

New table: `commercial_graph_entities`.

This table is intentionally narrow. It is for commercially important concepts that do not already have a canonical first-class record in ScrollMarketer, such as:

- a stable competitor;
- a partner;
- a channel concept;
- a customer segment that is not already represented by a native persona;
- a pricing offer;
- a customer need;
- a market concept;
- a regulator;
- a supplier;
- another explicit custom entity.

The UI tells the operator not to create one when a native ScrollMarketer record already represents the concept.

Entities can be offering-scoped or portfolio-scoped and remain owner-scoped by RLS.

## Graph nodes

View: `commercial_graph_nodes`.

It is a `security_invoker` normalized read view over the authoritative tables plus `commercial_graph_entities`.

Every node presents a common surface:

- `node_type`
- `node_id`
- `user_id`
- `app_id`
- `label`
- `state`
- `metadata`
- `created_at`

This is an indexing/query surface, not a replacement persistence model.

A node with `app_id = NULL` is portfolio/unscoped context; the graph must not pretend it belongs to a selected offering.

## Structural relationships

View: `commercial_graph_relationships`.

Structural relationships are derived from authoritative relationships already present in native tables. Examples include:

- offering → objective
- offering → market option
- offering → campaign
- offering → persona
- offering → prospect
- offering → distribution target
- objective → decision
- market option → decision
- decision → scenario
- decision/market/scenario → strategic learning
- strategic learning → supporting/challenging/context evidence

These edges are read-only consequences of the underlying records. They are **not copied** into the semantic edge table, and the UI does not offer a revoke action for them.

If a native relationship changes, the structural graph changes with it.

## Explicit semantic relationships

New table: `commercial_graph_edges`.

This stores relationships that the native schema does not already express, for example:

- offering `competes_with` competitor entity;
- offering `partners_with` partner entity;
- market option `distributed_through` a channel;
- decision `depends_on` a partner or evidence-backed condition;
- pricing offer `serves` a segment;
- entity `influences` a market decision.

Supported relationship labels are constrained in the database. A semantic edge also records:

- app or portfolio scope;
- manual/evidence/review basis;
- optional confidence;
- optional evidence link;
- notes/metadata;
- active/revoked lifecycle.

### Unknown remains unknown

Confidence is nullable. The graph does not inject a default probability or confidence into a relationship merely because the relationship is recorded.

### Evidence-backed edge

If `basis = evidence`, a linked evidence item is required.

That does not transform the edge into an observed fact automatically; the evidence object's own classification/status still matters.

### App vs portfolio scope

An app-scoped edge cannot silently connect nodes from different offerings. Cross-offering relationships require explicit portfolio scope.

Portfolio edges keep `app_id = NULL` rather than being misrepresented as belonging to either offering.

## Generic node ownership resolver

Function: `commercial_graph_node_app(user_id, node_type, node_id)`.

The resolver verifies that a referenced node exists and belongs to the requesting user before a semantic edge can be stored.

The hardening migration deliberately fixes the initial resolver so an unknown or foreign UUID raises rather than being interpreted as an unscoped node.

## Strategic-memory reuse is a separate permission layer

New table: `strategic_memory_reuse_reviews`.

Phase 6 answered:

> What did we learn, what evidence supports it, how causal is the mechanism hypothesis, and does it transfer?

Phase 7 adds a different question:

> Even if this is valid strategic memory, **may an AI workflow reuse it for this purpose and scope?**

Those questions are intentionally separate.

A strategic learning event does **not** become prompt context merely because it exists or has `causal_status = supported`.

## Reuse purposes

The review contract currently recognizes:

- `strategy_recommendation`
- `campaign_generation`
- `content_generation`
- `prospect_qualification`
- `market_ranking`
- `scenario_planning`
- `bounded_autonomy`

A review is explicit about which purpose is authorized.

## Reuse scope

A review has one of three scopes:

- `source_app` — original offering only;
- `target_app` — one specifically named different offering;
- `portfolio` — portfolio-wide reuse where allowed.

Portfolio scope is deliberately **not allowed** for bounded autonomy.

## Review lifecycle

Review states are:

- `pending`
- `approved`
- `rejected`
- `revoked`

Creating a review does not authorize reuse; it starts `pending`.

Only active, approved, unexpired, freshness-matching reviews appear in `approved_strategic_memory_reuse`.

## Freshness binding

Approved memory reuse is bound to a `learning_fingerprint` covering the material learning state, including:

- application context;
- learning kind and lesson;
- action/context;
- outcome;
- mechanism hypothesis;
- causal status/confidence;
- transferability state/scope/conditions;
- source snapshot;
- learning status;
- correction/supersession link.

If those material fields change, the approved grant stops appearing in the approved reuse view.

The memory must be reviewed again rather than silently inheriting the old permission.

## Approval-history integrity

An approved reuse grant is materially immutable.

Changing its:

- learning;
- scope;
- target app;
- purposes;
- rationale/review notes;
- expiry;
- fingerprint;
- approval identity/timestamp

requires revoking the old grant and creating a fresh review.

Rejected/revoked reviews are closed history.

Revocation preserves the original approval identity; it changes permission state rather than rewriting who originally approved the reuse.

## Bounded-autonomy reuse is stricter

A reuse review that includes `bounded_autonomy` must satisfy stronger conditions:

- the strategic learning is active;
- its current causal status is `supported`;
- portfolio-wide bounded-autonomy permission is rejected;
- cross-offering reuse requires `transferability_status = tested`;
- cross-offering reuse requires a completed **supporting** transfer test for that exact target offering.

The runtime permission function then rechecks current support rather than trusting the old label alone. It requires current validated supporting observation evidence or a completed supporting transfer test.

This permission still does **not** bypass Phase 5 governance. Memory reuse permission and execution authority are independent gates.

## Approved-memory read contract

View: `approved_strategic_memory_reuse`.

It exposes only reviewed strategic memory that is:

- approved;
- active;
- unexpired;
- still identical to the material learning state that was approved.

Function: `strategic_memory_reuse_allowed(...)`.

The function answers a narrow deterministic question: whether a given learning may be reused for a particular purpose/target offering.

A `true` result means **permission**, not:

- proof of causation;
- a recommendation to act;
- governance approval;
- budget approval;
- legal/brand approval;
- guarantee that the learning remains commercially useful.

## Audit chain

Memory-reuse review changes are appended to the existing `strategic_action_log`.

This lets the commercial decision history eventually connect:

`evidence → decision → execution → outcome → learning → reuse review → later decision`

without silently hiding which past knowledge influenced a new decision.

## Strategy Command UI

`/strategy` now includes **Commercial World Model**.

The current UI supports:

- graph node count;
- structural vs explicit semantic relationship counts;
- fresh approved-memory count;
- focused-node neighborhood inspection;
- adding a durable competitor/partner/channel/etc. only when no native record exists;
- explicit semantic relationship creation;
- manual vs evidence basis;
- optional confidence instead of invented certainty;
- app vs portfolio scope;
- revoking explicit semantic edges;
- creating pending memory-reuse reviews;
- approving/rejecting reviews;
- revoking approved reuse permission;
- visually distinguishing a fresh approved grant from an approved grant that has become stale/expired.

## What Phase 7 does not claim

Phase 7 does **not** yet mean:

- the graph is a magical complete ontology of the external market;
- ephemeral `competitor_signals` are stable competitor entities;
- inferred semantic edges are automatically facts;
- every commercial concept must be copied into `commercial_graph_entities`;
- approved memory is automatically injected into prompts;
- campaign/content generation is already reading `approved_strategic_memory_reuse`;
- bounded-autonomous executors are already consuming strategic memory;
- a reuse permission grants strategic execution authority;
- repository CI proves Postgres view/trigger/RLS behavior in Lovable Cloud.

Those boundaries are intentional.

## Required managed-runtime validation

Before merge/release, after applying **all ordered strategic migrations** in controlled Lovable Cloud non-production/preview, verify at minimum:

### Graph / RLS

- two-user RLS isolation for `commercial_graph_entities` and `commercial_graph_edges`;
- `security_invoker` graph views expose only records visible through underlying RLS;
- unknown UUIDs are rejected by the generic graph-node resolver;
- another user's node UUID is rejected;
- app-scoped edges reject cross-app links;
- portfolio edges require explicit portfolio scope and remain `app_id = NULL`;
- evidence-basis edges reject missing/foreign evidence;
- graph entities reject foreign app links;
- structural edges reflect native relationship changes without copied-edge synchronization;
- structural relationships cannot be mutated as semantic rows;
- explicit semantic edges can be revoked without altering native records.

### Native-source integrity

- app/objective/decision/market/scenario/campaign/persona/prospect/distribution/evidence/learning nodes match their native records;
- app-null native records remain visibly portfolio/unscoped;
- competitor signals are not silently promoted into stable competitors;
- product/UI review prevents duplicate canonical native objects being recreated as generic graph entities.

### Memory reuse

- pending/rejected/revoked reviews do not appear in approved reuse;
- expired reviews do not appear in approved reuse;
- learning material change makes an approved grant stale immediately;
- invalidating/superseding a learning removes approved reuse eligibility;
- approved grant material fields/rationale/reviewer history cannot be rewritten;
- approved → revoked preserves original approval identity;
- rejected/revoked review cannot be resurrected;
- a changed approval requires revoke + fresh review;
- duplicate open approval for the same learning/scope/target is rejected;
- target-app review rejects a foreign app;
- portfolio bounded-autonomy review is rejected;
- bounded-autonomy approval requires currently supported causal status;
- cross-app bounded-autonomy approval requires tested transferability and a completed supporting transfer test for the exact target app;
- bounded-autonomy permission rechecks current qualifying support at use time;
- memory reuse permission does not bypass Phase 5 governance.

### Regression

- existing content/prospect automation behavior remains unchanged;
- existing operational `learning_events` writes remain compatible;
- tactical `learning_insights` behavior remains unchanged;
- campaign generation continues working without Phase 7 memory reuse because automatic consumption is not yet wired;
- `/strategy` Phase 1–6 panels remain functional.

## Next controlled phase

The next phase should **consume** this world model carefully rather than add another parallel knowledge store.

A suitable Phase 8 is **Controlled Decision Context Assembly**:

1. select the target offering and requested purpose;
2. retrieve the relevant graph neighborhood;
3. retrieve evidence with provenance and unknowns;
4. retrieve only fresh, purpose-approved strategic memory;
5. retrieve governing policy/authority state;
6. return a provenance-rich context package;
7. start by feeding recommendation-only workflows, not bounded execution.

That allows ScrollMarketer to use what it knows without letting accumulated AI-generated history become unreviewed self-reinforcing truth.
