import { Workspace } from "@/components/Workspace";
import { loadWorkspaceData } from "@/lib/ui/workspace-data.ts";

export const dynamic = "force-dynamic";

export default function Page() {
  const data = loadWorkspaceData();
  return <Workspace data={data} />;
}
