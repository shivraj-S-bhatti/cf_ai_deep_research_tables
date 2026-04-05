import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DebugWorkspace } from "@/components/debug/DebugWorkspace";
import type { ThreadDetailsResponse } from "@/lib/contracts";
import { apiClient } from "@/lib/api-client";

export default function DebugRunPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const [searchParams] = useSearchParams();
  const [thread, setThread] = useState<ThreadDetailsResponse | null>(null);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void apiClient.getThread(threadId).then((snapshot) => {
      if (!cancelled) setThread(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const runId = useMemo(() => {
    const fromQuery = searchParams.get("runId");
    if (fromQuery) return fromQuery;
    return thread?.latestRun?.id ?? null;
  }, [searchParams, thread?.latestRun?.id]);

  if (!threadId) {
    return null;
  }

  return (
    <DebugWorkspace
      threadId={threadId}
      runId={runId}
      mode="page"
      threadQuery={thread?.thread.queryRaw ?? null}
    />
  );
}
