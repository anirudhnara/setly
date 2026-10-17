import useSWR from "swr";
import type {
  AuthorizeRequest,
  AuthorizeResponse,
  CreateGroupRequest,
  CreateGroupResponse,
  CreateSlotRequest,
  CreateSlotResponse,
  DeleteSlotResponse,
  DemoCheckoutRequest,
  DemoCheckoutResponse,
  GenerateMapRequest,
  GenerateMapResponse,
  GetGroupResponse,
  JoinGroupRequest,
  JoinGroupResponse,
  LockGroupRequest,
  LockGroupResponse,
  PasteMapRequest,
  PasteMapResponse,
  PayRequest,
  PayResponse,
  ReturnItemRequest,
  ReturnItemResponse,
  SlotOptionsResponse,
  StripeWebhookRequest,
  StripeWebhookResponse,
  UpdateSlotRequest,
  UpdateSlotResponse,
} from "@/lib/contracts";
import type { GroupState } from "@/lib/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      /* Keep the status when the body isn't JSON. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function post<T>(path: string, body: unknown) {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function createGroup(body: CreateGroupRequest) {
  return post<CreateGroupResponse>("/api/groups", body);
}

export function getGroup(groupId: string) {
  return request<GetGroupResponse>(`/api/groups/${encodeURIComponent(groupId)}`);
}

export function joinGroup(groupId: string, body: JoinGroupRequest) {
  return post<JoinGroupResponse>(`/api/groups/${encodeURIComponent(groupId)}/join`, body);
}

export function lockGroup(groupId: string, body: LockGroupRequest) {
  return post<LockGroupResponse>(`/api/groups/${encodeURIComponent(groupId)}/lock`, body);
}

export function generateMap(body: GenerateMapRequest) {
  return post<GenerateMapResponse>("/api/maps/generate", body);
}

export function pasteMap(body: PasteMapRequest) {
  return post<PasteMapResponse>("/api/maps/paste", body);
}

export function createSlot(body: CreateSlotRequest) {
  return post<CreateSlotResponse>("/api/slots", body);
}

export function updateSlot(slotId: string, body: UpdateSlotRequest) {
  return request<UpdateSlotResponse>(`/api/slots/${encodeURIComponent(slotId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteSlot(slotId: string) {
  return request<DeleteSlotResponse>(`/api/slots/${encodeURIComponent(slotId)}`, { method: "DELETE" });
}

export function getSlotOptions(slotId: string) {
  return request<SlotOptionsResponse>(`/api/slots/${encodeURIComponent(slotId)}/options`);
}

export function payShare(body: PayRequest) {
  return post<PayResponse>("/api/pay", body);
}

export function postStripeWebhook(body: StripeWebhookRequest) {
  return post<StripeWebhookResponse>("/api/webhooks/stripe", body);
}

export function authorizeCard(body: AuthorizeRequest) {
  return post<AuthorizeResponse>("/api/issuing/authorize", body);
}

export function runDemoCheckout(body: DemoCheckoutRequest) {
  return post<DemoCheckoutResponse>("/api/checkout/run", body);
}

export function returnItem(body: ReturnItemRequest) {
  return post<ReturnItemResponse>("/api/returns", body);
}

/** Polls the full group snapshot. Screens should read group state through this hook. */
export function useGroup(groupId: string) {
  return useSWR<GroupState>(`/api/groups/${encodeURIComponent(groupId)}`, (url: string) => request<GroupState>(url), {
    refreshInterval: 1000,
  });
}
