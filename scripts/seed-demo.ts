import { seedDemoGroup } from "@/lib/db/queries";

if (!process.env.DATABASE_URL) {
  console.log("No DATABASE_URL. grp_apartment loads in memory when the server starts.");
} else {
  seedDemoGroup()
    .then(() => {
      console.log("Seeded grp_apartment into Postgres.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Seed failed");
      process.exit(1);
    });
}
