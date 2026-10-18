import { z } from "zod";

const envSchema = z
  .object({
    GEMINI_API_KEY: z.string().min(1).optional(),
    SERPAPI_KEY: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    STRIPE_SECRET_KEY: z.string().regex(/^sk_test_/, "Only Stripe test keys are allowed").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    ISSUER: z.enum(["mock", "stripe"]).default("mock"),
    MOCK_AI: z.enum(["0", "1"]).default("1"),
    BESTBUY_API_KEY: z.string().min(1).optional(),
    EBAY_CLIENT_ID: z.string().min(1).optional(),
    EBAY_CLIENT_SECRET: z.string().min(1).optional(),
    CHECKOUT_ZINC: z.enum(["off", "sandbox", "live"]).default("off"),
    ZINC_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.MOCK_AI !== "1") {
      if (!value.GEMINI_API_KEY) {
        ctx.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "Required when MOCK_AI is not 1" });
      }
      if (!value.SERPAPI_KEY) {
        ctx.addIssue({ code: "custom", path: ["SERPAPI_KEY"], message: "Required when MOCK_AI is not 1" });
      }
    }
    if (value.ISSUER === "stripe") {
      if (!value.STRIPE_SECRET_KEY) {
        ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "Required when ISSUER is stripe" });
      }
      if (!value.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({ code: "custom", path: ["STRIPE_WEBHOOK_SECRET"], message: "Required when ISSUER is stripe" });
      }
    }
    if (value.CHECKOUT_ZINC !== "off") {
      const prefix = value.CHECKOUT_ZINC === "sandbox" ? "zn_test_" : "zn_live_";
      if (!value.ZINC_API_KEY?.startsWith(prefix)) {
        ctx.addIssue({ code: "custom", path: ["ZINC_API_KEY"], message: `Must start with ${prefix} when CHECKOUT_ZINC is ${value.CHECKOUT_ZINC}` });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function present(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
}

/** Reads process env. Gemini and SerpApi keys are optional while MOCK_AI=1. Stripe keys are optional while ISSUER=mock. */
export function getEnv(): Env {
  return envSchema.parse({
    GEMINI_API_KEY: present(process.env.GEMINI_API_KEY),
    SERPAPI_KEY: present(process.env.SERPAPI_KEY),
    DATABASE_URL: present(process.env.DATABASE_URL),
    STRIPE_SECRET_KEY: present(process.env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: present(process.env.STRIPE_WEBHOOK_SECRET),
    NEXT_PUBLIC_APP_URL: present(process.env.NEXT_PUBLIC_APP_URL),
    ISSUER: present(process.env.ISSUER),
    MOCK_AI: present(process.env.MOCK_AI),
    BESTBUY_API_KEY: present(process.env.BESTBUY_API_KEY),
    EBAY_CLIENT_ID: present(process.env.EBAY_CLIENT_ID),
    EBAY_CLIENT_SECRET: present(process.env.EBAY_CLIENT_SECRET),
    CHECKOUT_ZINC: present(process.env.CHECKOUT_ZINC),
    ZINC_API_KEY: present(process.env.ZINC_API_KEY),
  });
}

/** Zinc lane mode. `off` runs the in-repo simulator and makes no network calls. */
export function checkoutZincMode(): Env["CHECKOUT_ZINC"] {
  const mode = process.env.CHECKOUT_ZINC;
  return mode === "sandbox" || mode === "live" ? mode : "off";
}

export function mockAiEnabled() {
  return (process.env.MOCK_AI ?? "1") !== "0";
}

/** Demo laptop reset. Off unless this is exactly "1". */
export function demoResetEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEMO_RESET === "1";
}

const firebaseWebConfigSchema = z.object({
  apiKey: z.string().min(1),
  authDomain: z.string().min(1),
  projectId: z.string().min(1),
  appId: z.string().min(1),
});

export type FirebaseWebConfig = z.infer<typeof firebaseWebConfigSchema>;

export const FIREBASE_SETUP_MESSAGE =
  "Add NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID to .env.local, then restart the dev server.";

function firebaseWebEnv() {
  return {
    apiKey: present(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: present(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: present(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: present(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  };
}

/** Public web config, or null when any of the four values is missing. */
export function readFirebaseWebConfig(): FirebaseWebConfig | null {
  const parsed = firebaseWebConfigSchema.safeParse(firebaseWebEnv());
  return parsed.success ? parsed.data : null;
}

/** Public web config for Firebase Auth. Required when the sign-in screen initializes. */
export function getFirebaseWebConfig(): FirebaseWebConfig {
  const config = readFirebaseWebConfig();
  if (!config) throw new Error(FIREBASE_SETUP_MESSAGE);
  return config;
}

const firebaseAdminCredentialsSchema = z.object({
  projectId: z.string().min(1),
  clientEmail: z.string().min(1),
  privateKey: z.string().min(1),
});

export type FirebaseAdminCredentials = z.infer<typeof firebaseAdminCredentialsSchema>;

/** Service account fields for verifying ID tokens. Null when any field is missing so callers can fail closed. */
export function getFirebaseAdminCredentials(): FirebaseAdminCredentials | null {
  const privateKey = present(process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, "\n");
  const parsed = firebaseAdminCredentialsSchema.safeParse({
    projectId: present(process.env.FIREBASE_PROJECT_ID),
    clientEmail: present(process.env.FIREBASE_CLIENT_EMAIL),
    privateKey,
  });
  return parsed.success ? parsed.data : null;
}

/** Server-only secret for the destructive local demo reset. */
export function demoResetToken() {
  const token = process.env.DEMO_RESET_TOKEN;
  return token && token.length >= 32 ? token : null;
}
