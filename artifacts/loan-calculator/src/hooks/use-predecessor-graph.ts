import { useMemo, useState, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { getGetLoanQueryOptions, getGetFileQueryOptions, type Loan } from "@workspace/api-client-react";

export interface PredecessorGraphResult {
  predecessors: Loan[];
  isReady: boolean;
  error: Error | null;
}

export function usePredecessorGraph(initialLoans: Loan[] | undefined | null, expectedClientId: string): PredecessorGraphResult {
  const [discoveredIds, setDiscoveredIds] = useState<string[]>([]);

  const initialIdsSet = useMemo(() => {
    return new Set((initialLoans ?? []).map((l) => l.id));
  }, [initialLoans]);

  // Start with immediate external predecessors
  useEffect(() => {
    if (!initialLoans) return;
    const roots = initialLoans
      .map((l) => l.predecessorAgreementId)
      .filter((id): id is string => !!id && !initialIdsSet.has(id));
      
    setDiscoveredIds((prev) => {
      const next = new Set([...prev, ...roots]);
      if (next.size !== prev.length) {
        return Array.from(next).sort();
      }
      return prev;
    });
  }, [initialLoans, initialIdsSet]);

  const queries = useQueries({
    queries: discoveredIds.map((id) => getGetLoanQueryOptions(id)),
  });

  // Discover further external predecessors
  useEffect(() => {
    let changed = false;
    const next = new Set(discoveredIds);
    for (const q of queries) {
      const pId = q.data?.predecessorAgreementId;
      if (pId && !initialIdsSet.has(pId) && !next.has(pId)) {
        next.add(pId);
        changed = true;
      }
    }
    if (changed) {
      setDiscoveredIds(Array.from(next).sort());
    }
  }, [queries, discoveredIds, initialIdsSet]);

  const fetchedLoans = useMemo(() => {
    return queries.map(q => q.data).filter((l): l is Loan => !!l);
  }, [queries]);

  // To validate client ID, we must fetch the files for these external predecessors.
  const fileIdsToFetch = useMemo(() => {
    return Array.from(new Set(fetchedLoans.map((l) => l.fileId))).sort();
  }, [fetchedLoans]);

  const fileQueries = useQueries({
    queries: fileIdsToFetch.map((id) => getGetFileQueryOptions(id)),
  });

  return useMemo(() => {
    if (!initialLoans) {
      return { predecessors: [], isReady: false, error: null };
    }

    const fetchedMap = new Map<string, Loan>();
    let error: Error | null = null;
    let isReady = true;

    for (let i = 0; i < discoveredIds.length; i++) {
      const q = queries[i];
      if (q.isError) {
        error = new Error(`Failed to fetch predecessor loan ${discoveredIds[i]}`);
        isReady = false;
      } else if (q.isSuccess && q.data) {
        fetchedMap.set(q.data.id, q.data);
      } else {
        isReady = false;
      }
    }

    // Check file queries for client validation
    const fileClientMap = new Map<string, string>();
    for (let i = 0; i < fileIdsToFetch.length; i++) {
      const fq = fileQueries[i];
      if (fq.isError) {
        error = new Error(`Failed to fetch file ${fileIdsToFetch[i]} to validate predecessor`);
        isReady = false;
      } else if (fq.isSuccess && fq.data) {
        fileClientMap.set(fq.data.id, fq.data.clientId);
      } else {
        isReady = false;
      }
    }

    if (isReady && !error) {
      for (const loan of fetchedMap.values()) {
        const fileClientId = fileClientMap.get(loan.fileId);
        if (fileClientId !== expectedClientId) {
          error = new Error(`Predecessor loan ${loan.id} belongs to a different client`);
          isReady = false;
          break;
        }
      }
    }

    // Graph validation: detect cycles
    const allKnown = new Map<string, Loan>();
    for (const l of initialLoans) allKnown.set(l.id, l);
    for (const l of fetchedMap.values()) allKnown.set(l.id, l);

    if (isReady && !error) {
      const visited = new Set<string>();
      const visiting = new Set<string>();

      const checkCycle = (id: string) => {
        if (visited.has(id)) return;
        if (visiting.has(id)) {
          error = new Error(`Cycle detected in predecessor graph for loan ${id}`);
          isReady = false;
          return;
        }
        visiting.add(id);
        const node = allKnown.get(id);
        if (node?.predecessorAgreementId) {
          checkCycle(node.predecessorAgreementId);
        }
        visiting.delete(id);
        visited.add(id);
      };

      for (const id of allKnown.keys()) {
        if (error) break;
        checkCycle(id);
      }
    }

    return {
      predecessors: Array.from(fetchedMap.values()),
      isReady,
      error,
    };
  }, [initialLoans, discoveredIds, queries, fileIdsToFetch, fileQueries, expectedClientId]);
}
