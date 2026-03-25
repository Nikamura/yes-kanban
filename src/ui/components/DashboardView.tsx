import { useState } from "react";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { TokenDashboard } from "./TokenDashboard";
import type { Id } from "../../../convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";

type Tab = "analytics" | "tokens";

export function DashboardView({ projectId }: { projectId: Id<"projects"> }) {
  const [activeTab, setActiveTab] = useState<Tab>("analytics");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="dashboard-wrapper">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as Tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="h-auto w-full shrink-0 justify-start rounded-none border-b border-border bg-transparent px-4 pt-2" variant="line">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="tokens">Token Usage</TabsTrigger>
        </TabsList>
        <TabsContent value="analytics" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <AnalyticsDashboard projectId={projectId} />
        </TabsContent>
        <TabsContent value="tokens" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <TokenDashboard projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
