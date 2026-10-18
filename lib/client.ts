import useSWR from "swr";
import { currentIdToken } from "@/lib/auth/client";
import type {
  ApproveCheckoutRequest,
  ApproveCheckoutResponse,
  AuthorizeRequest,
  AuthorizeResponse,
  CreateGroupRequest,
  CreateGroupResponse,
  CreateSlotRequest,
  CreateSlotResponse,
  CurrentUserResponse,
  DeleteSlotResponse,
  DemoCheckoutRequest,
  DemoCheckoutResponse,
  GenerateMapRequest,
  GenerateMapResponse,
  GetGroupResponse,
  GuidedPurchaseRequest,
  GuidedPurchaseResponse,
  JoinGroupRequest,
  JoinGroupResponse,
  LockGroupResponse,
  MyGroupsResponse,
  PasteMapRequest,
  PasteMapResponse,
  PayRequest,
  PayResponse,
  ReturnItemRequest,
  ReturnItemResponse,
  SettleCheckoutRequest,
  SettleCheckoutResponse,
  SlotOptionsResponse,
  StartCheckoutRequest,
  StartCheckoutResponse,
  StripeWebhookRequest,
  StripeWebhookResponse,
  UpdateSlotRequest,
  UpdateSlotResponse,
} from "@/lib/contracts";
import type { InterviewRequest, InterviewResponse } from "@/lib/ai/interview";
import type { ChooseRequest, ChooseResponse, RefineRequest, RefineResponse } from "@/lib/ai/refine";
import type { AddRequest, SuggestRequest, SuggestResponse } from "@/lib/ai/suggest";
import type { GroupState } from "@/lib/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window === "undefined" ? null : await currentIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

export function getCurrentUser() {
  return request<CurrentUserResponse>("/api/me");
}

export function listMyGroups() {
  return request<MyGroupsResponse>("/api/groups");
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

export function lockGroup(groupId: string) {
  return post<LockGroupResponse>(`/api/groups/${encodeURIComponent(groupId)}/lock`, {});
}

export function generateMap(body: GenerateMapRequest) {
  return post<GenerateMapResponse>("/api/maps/generate", body);
}

/** Grows and saves the group's first set from its prompt. Returns the group with its set. */
export function growMap(groupId: string) {
  return post<GetGroupResponse>("/api/maps/grow", { groupId });
}

/** Ideas to grow one branch of a saved set. */
export function suggestIdeas(body: SuggestRequest) {
  return post<SuggestResponse>("/api/maps/suggest", body);
}

/** Adds one idea to a branch and returns the updated group. */
export function addIdea(body: AddRequest) {
  return post<GetGroupResponse>("/api/maps/add", body);
}

/** Warms the AI connection when the chat opens. Best effort. */
export function warmInterview() {
  return request<{ ok: boolean }>("/api/maps/interview").catch(() => null);
}

/** The whole questionnaire for a new set, planned once from the first message. */
export function planInterview(body: InterviewRequest) {
  return post<InterviewResponse>("/api/maps/interview", body);
}

/** Regrows the group's saved set from feedback and loved or passed-on items. */
export function refineMap(body: RefineRequest) {
  return post<RefineResponse>("/api/maps/refine", body);
}

/** Saves one of a slot's options as its pick. The server re-reads the product from search. */
export function chooseProduct(body: ChooseRequest) {
  return post<ChooseResponse>("/api/maps/choose", body);
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

/** Creates one order per store and buys from each through its lane. Organizer only. */
export function startCheckout(body: StartCheckoutRequest) {
  return post<StartCheckoutResponse>("/api/checkout/start", body);
}

/** Approves or declines a store that quoted more than its cap. */
export function approveCheckout(body: ApproveCheckoutRequest) {
  return post<ApproveCheckoutResponse>("/api/checkout/approve", body);
}

/** Records that a member bought a guided store's items with the group card. */
export function recordGuidedPurchase(body: GuidedPurchaseRequest) {
  return post<GuidedPurchaseResponse>("/api/checkout/guided", body);
}

/** Refunds unspent buffer once every store order is finished. */
export function settleCheckout(body: SettleCheckoutRequest) {
  return post<SettleCheckoutResponse>("/api/checkout/settle", body);
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
