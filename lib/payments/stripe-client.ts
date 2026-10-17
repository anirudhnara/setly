import Stripe from "stripe";
import { getEnv } from "@/lib/env";

let client: Stripe | null = null;

export function getStripe() {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}
