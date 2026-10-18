import { z } from "zod";

const envSchema = z
  .object({
    GEMINI_API_KEY: z.string().min(1).optional(),
    SERPAPI_KEY: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    ISSUER: z.enum(["mock", "stripe"]).default("mock"),
    MOCK_AI: z.enum(["0", "1"]).default("1"),
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
  });
}

export function mockAiEnabled() {
  return (process.env.MOCK_AI ?? "1") !== "0";
}

/** Demo laptop reset. Off unless this is exactly "1". */
export function demoResetEnabled() {
  return process.env.DEMO_RESET === "1";
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
