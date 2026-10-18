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
    // A few connections so a group read's parallel queries actually run in parallel.
    const client = postgres(url, { max: 6, prepare: false });
    database = drizzle(client, { schema });
  }
  return database;
}
