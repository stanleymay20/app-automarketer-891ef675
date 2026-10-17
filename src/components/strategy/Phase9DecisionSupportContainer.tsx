import { MarketScenarioDecisionSupportPanel } from "@/components/strategy/MarketScenarioDecisionSupportPanel";
import { useStrategicObjectives } from "@/hooks/useStrategy";

export function Phase9DecisionSupportContainer({ appId }: { appId?: string }) {
  const { data: objectives = [] } = useStrategicObjectives(appId);
  return <MarketScenarioDecisionSupportPanel appId={appId} objectives={objectives} />;
}
