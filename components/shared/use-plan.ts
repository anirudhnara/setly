"use client";

import { useEffect, useState } from "react";
import { useGroup } from "@/lib/client";
import type { MapData } from "@/lib/types";
import { readStagedMap } from "@/components/shared/session";

export function usePlan(groupId: string) {
  const query = useGroup(groupId);
  const [staged, setStaged] = useState<MapData | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setStaged(readStagedMap(groupId));
    setHydrated(true);
  }, [groupId]);

  const serverMap = query.data?.map;
  const live = (serverMap?.slots.length ?? 0) > 0;
  const map = live ? serverMap ?? null : staged ?? serverMap ?? null;

  return { ...query, map, live, hydrated, mounted };
}
