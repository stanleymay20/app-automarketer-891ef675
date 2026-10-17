import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type CommercialNodeType =
  | "app"
  | "objective"
  | "decision"
  | "market_option"
  | "scenario"
  | "campaign"
  | "persona"
  | "prospect"
  | "distribution_target"
  | "learning"
  | "evidence"
  | "entity";

export type DurableCommercialEntityType =
  | "competitor"
  | "partner"
  | "channel"
  | "segment"
  | "pricing_offer"
  | "customer_need"
  | "market"
  | "regulator"
  | "supplier"
  | "custom";

export type CommercialRelationType =
  | "targets"
  | "serves"
  | "competes_with"
  | "distributed_through"
  | "partners_with"
  | "priced_as"
  | "supported_by"
  | "challenged_by"
  | "informs"
  | "executes"
  | "produced"
  | "learned_from"
  | "tests"
  | "transfers_to"
  | "depends_on"
  | "influences"
  | "related_to";

export type MemoryReusePurpose =
  | "strategy_recommendation"
  | "campaign_generation"
  | "content_generation"
  | "prospect_qualification"
  | "market_ranking"
  | "scenario_planning"
  | "bounded_autonomy";

export type MemoryReuseScope = "source_app" | "target_app" | "portfolio";
export type MemoryReuseStatus = "pending" | "approved" | "rejected" | "revoked";

export interface CommercialGraphNode {
  node_type: CommercialNodeType;
  node_id: string;
  user_id: string;
  app_id: string | null;
  label: string;
  state: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CommercialGraphRelationship {
  relation_id: string;
  user_id: string;
  app_id: string | null;
  edge_scope: "app" | "portfolio";
  source_type: CommercialNodeType;
  source_id: string;
  relation_type: CommercialRelationType | string;
  target_type: CommercialNodeType;
  target_id: string;
  basis: "manual" | "evidence" | "review" | "structural";
  confidence: number | null;
  evidence_item_id: string | null;
  metadata: Record<string, unknown>;
  status: "active" | "revoked";
  created_at: string;
}

export interface StrategicMemoryForReview {
  id: string;
  app_id: string | null;
  learning_kind: string;
  lesson: string;
  mechanism_hypothesis: string | null;
  causal_status: string;
  confidence: number | null;
  transferability_status: string;
  status: string;
  updated_at: string;
}

export interface StrategicMemoryReuseReview {
  id: string;
  user_id: string;
  learning_event_id: string;
  reuse_scope: MemoryReuseScope;
  target_app_id: string | null;
  allowed_purposes: MemoryReusePurpose[];
  status: MemoryReuseStatus;
  rationale: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  learning_fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovedMemoryReuse {
  review_id: string;
  learning_event_id: string;
  source_app_id: string | null;
  reuse_scope: MemoryReuseScope;
  target_app_id: string | null;
  allowed_purposes: MemoryReusePurpose[];
  lesson: string;
  mechanism_hypothesis: string | null;
  causal_status: string;
  confidence: number | null;
  transferability_status: string;
  expires_at: string | null;
}

export interface CreateCommercialEntityInput {
  app_id?: string;
  entity_type: DurableCommercialEntityType;
  label: string;
  description?: string;
  external_reference?: string;
  attributes?: Record<string, unknown>;
}

export interface CreateCommercialEdgeInput {
  app_id?: string;
  edge_scope?: "app" | "portfolio";
  source_type: CommercialNodeType;
  source_id: string;
  relation_type: CommercialRelationType;
  target_type: CommercialNodeType;
  target_id: string;
  basis?: "manual" | "evidence" | "review";
  confidence?: number;
  evidence_item_id?: string;
  notes?: string;
}

export interface CreateMemoryReuseReviewInput {
  learning_event_id: string;
  reuse_scope: MemoryReuseScope;
  target_app_id?: string;
  allowed_purposes: MemoryReusePurpose[];
  rationale?: string;
  expires_at?: string;
}

const db = supabase as any;

export function useCommercialWorldModel(appId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["commercial-world-model", user?.id, appId ?? "portfolio"],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return {
          nodes: [] as CommercialGraphNode[],
          relationships: [] as CommercialGraphRelationship[],
          strategicMemories: [] as StrategicMemoryForReview[],
          reuseReviews: [] as StrategicMemoryReuseReview[],
          approvedReuse: [] as ApprovedMemoryReuse[],
        };
      }

      const [nodesRes, relationshipsRes, memoriesRes, reviewsRes, approvedRes] = await Promise.all([
        db.from("commercial_graph_nodes")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(700),
        db.from("commercial_graph_relationships")
          .select("*")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1000),
        db.from("learning_events")
          .select("id,app_id,learning_kind,lesson,mechanism_hypothesis,causal_status,confidence,transferability_status,status,updated_at")
          .eq("user_id", user.id)
          .neq("learning_kind", "operational")
          .order("created_at", { ascending: false })
          .limit(200),
        db.from("strategic_memory_reuse_reviews")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200),
        db.from("approved_strategic_memory_reuse")
          .select("review_id,learning_event_id,source_app_id,reuse_scope,target_app_id,allowed_purposes,lesson,mechanism_hypothesis,causal_status,confidence,transferability_status,expires_at")
          .eq("user_id", user.id)
          .limit(200),
      ]);

      const firstError = [nodesRes, relationshipsRes, memoriesRes, reviewsRes, approvedRes]
        .find((result) => result.error)?.error;
      if (firstError) throw firstError;

      const allNodes = (nodesRes.data ?? []) as CommercialGraphNode[];
      const allRelationships = (relationshipsRes.data ?? []) as CommercialGraphRelationship[];
      const allMemories = (memoriesRes.data ?? []) as StrategicMemoryForReview[];
      const allReviews = (reviewsRes.data ?? []) as StrategicMemoryReuseReview[];
      const allApproved = (approvedRes.data ?? []) as ApprovedMemoryReuse[];

      if (!appId) {
        return {
          nodes: allNodes,
          relationships: allRelationships,
          strategicMemories: allMemories,
          reuseReviews: allReviews,
          approvedReuse: allApproved,
        };
      }

      const visibleNodes = allNodes.filter((node) =>
        node.app_id === appId ||
        node.app_id === null ||
        (node.node_type === "app" && node.node_id === appId)
      );
      const visibleKeys = new Set(visibleNodes.map((node) => `${node.node_type}:${node.node_id}`));
      const visibleRelationships = allRelationships.filter((edge) =>
        edge.app_id === appId ||
        edge.edge_scope === "portfolio" ||
        visibleKeys.has(`${edge.source_type}:${edge.source_id}`) ||
        visibleKeys.has(`${edge.target_type}:${edge.target_id}`)
      );
      const visibleMemories = allMemories.filter((memory) => memory.app_id === appId || memory.app_id === null);
      const visibleMemoryIds = new Set(visibleMemories.map((memory) => memory.id));
      const visibleReviews = allReviews.filter((review) =>
        visibleMemoryIds.has(review.learning_event_id) || review.target_app_id === appId
      );
      const visibleApproved = allApproved.filter((review) =>
        review.source_app_id === appId || review.target_app_id === appId || review.reuse_scope === "portfolio"
      );

      return {
        nodes: visibleNodes,
        relationships: visibleRelationships,
        strategicMemories: visibleMemories,
        reuseReviews: visibleReviews,
        approvedReuse: visibleApproved,
      };
    },
  });
}

function invalidateWorldModel(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["commercial-world-model"] });
  qc.invalidateQueries({ queryKey: ["strategic-memory"] });
  qc.invalidateQueries({ queryKey: ["strategic-governance"] });
}

export function useCreateCommercialEntity() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateCommercialEntityInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("commercial_graph_entities").insert({
        user_id: user.id,
        app_id: input.app_id ?? null,
        entity_type: input.entity_type,
        label: input.label.trim(),
        description: input.description?.trim() || null,
        external_reference: input.external_reference?.trim() || null,
        attributes: input.attributes ?? {},
        status: "active",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateWorldModel(qc);
      toast({ title: "Commercial entity added", description: "Native records remain authoritative; this entity exists only because no canonical native record represents it." });
    },
    onError: (error: Error) => toast({ title: "Could not add commercial entity", description: error.message, variant: "destructive" }),
  });
}

export function useCreateCommercialEdge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateCommercialEdgeInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("commercial_graph_edges").insert({
        user_id: user.id,
        app_id: input.app_id ?? null,
        edge_scope: input.edge_scope ?? "app",
        source_type: input.source_type,
        source_id: input.source_id,
        relation_type: input.relation_type,
        target_type: input.target_type,
        target_id: input.target_id,
        basis: input.basis ?? "manual",
        confidence: input.confidence ?? null,
        evidence_item_id: input.evidence_item_id ?? null,
        notes: input.notes?.trim() || null,
        status: "active",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateWorldModel(qc);
      toast({ title: "Commercial relationship recorded" });
    },
    onError: (error: Error) => toast({ title: "Could not record relationship", description: error.message, variant: "destructive" }),
  });
}

export function useRevokeCommercialEdge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("commercial_graph_edges")
        .update({ status: "revoked" })
        .eq("id", id)
        .eq("user_id", user.id)
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateWorldModel(qc),
    onError: (error: Error) => toast({ title: "Could not revoke relationship", description: error.message, variant: "destructive" }),
  });
}

export function useCreateMemoryReuseReview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateMemoryReuseReviewInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_memory_reuse_reviews").insert({
        user_id: user.id,
        learning_event_id: input.learning_event_id,
        reuse_scope: input.reuse_scope,
        target_app_id: input.reuse_scope === "target_app" ? input.target_app_id ?? null : null,
        allowed_purposes: input.allowed_purposes,
        rationale: input.rationale?.trim() || null,
        expires_at: input.expires_at || null,
        status: "pending",
      }).select().single();
      if (error) throw error;
      return data as StrategicMemoryReuseReview;
    },
    onSuccess: () => {
      invalidateWorldModel(qc);
      toast({ title: "Memory reuse review created", description: "The memory is still unavailable to agents until explicitly approved." });
    },
    onError: (error: Error) => toast({ title: "Could not create reuse review", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateMemoryReuseReview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status, review_notes }: {
      id: string;
      status: "approved" | "rejected" | "revoked";
      review_notes?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_memory_reuse_reviews")
        .update({
          status,
          review_notes: review_notes?.trim() || null,
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .select().single();
      if (error) throw error;
      return data as StrategicMemoryReuseReview;
    },
    onSuccess: (review) => {
      invalidateWorldModel(qc);
      toast({ title: `Memory reuse ${review.status}` });
    },
    onError: (error: Error) => toast({ title: "Could not update reuse review", description: error.message, variant: "destructive" }),
  });
}
