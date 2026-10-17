import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDb() {
  if (!database) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    const client = postgres(url, { max: 1 });
    database = drizzle(client, { schema });
  }
  return database;
}
