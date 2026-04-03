import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLogEntry {
  id: string;
  user_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export function useAuditLog(limit = 20) {
  return useQuery({
    queryKey: ["audit_log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as AuditLogEntry[];
    },
  });
}
