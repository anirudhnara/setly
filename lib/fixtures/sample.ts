import apartmentMapJson from "@/fixtures/apartment-map.json";
import campingMapJson from "@/fixtures/camping-map.json";
import groupStateJson from "@/fixtures/group-state.json";
import type { GroupState, MapData } from "@/lib/types";

function withoutNote<T extends { _note: string }>(value: T): Omit<T, "_note"> {
  const { _note: note, ...rest } = value;
  if (!note.startsWith("Sample")) {
    throw new Error("Fixture is missing its sample-data note");
  }
  return rest;
}

export function loadApartmentMap(): MapData {
  return withoutNote(apartmentMapJson) as unknown as MapData;
}

export function loadCampingMap(): MapData {
  return withoutNote(campingMapJson) as unknown as MapData;
}

export function loadGroupState(): GroupState {
  return withoutNote(groupStateJson) as unknown as GroupState;
}

export function loadMapForPrompt(text: string): MapData {
  return /camp|tent|trail/i.test(text) ? loadCampingMap() : loadApartmentMap();
}
