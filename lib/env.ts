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
