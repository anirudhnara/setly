import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JarvisMark } from "@/components/shared/jarvis-mark";

export function GroupLoading() {
  return (
    <div className="group-state" role="status">
      <JarvisMark size={48} live />
      <p>Syncing the group…</p>
    </div>
  );
}

export function GroupMissing() {
  return (
    <div className="group-state">
      <JarvisMark size={48} />
      <h1>This group isn’t available.</h1>
      <p>It may have been removed, or you aren’t a member yet. Ask for a fresh invite link, or start your own set.</p>
      <Link className="btn btn-accent" href="/home">Start a new set <ArrowRight aria-hidden="true" /></Link>
    </div>
  );
}
