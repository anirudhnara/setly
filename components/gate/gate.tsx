"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { readYou, stageYou } from "@/components/shared/session";

export function Gate() {
  const router = useRouter();
  const [name, setName] = useState("");

  useEffect(() => {
    if (readYou()) router.replace("/home");
  }, [router]);

  function enter() {
    const clean = name.trim();
    if (clean.length < 2) return;
    stageYou(clean);
    router.push("/home");
  }

  return (
    <div className="orbit frame">
      <form
        className="enter"
        onSubmit={(event) => {
          event.preventDefault();
          enter();
        }}
      >
        <JarvisMark size={96} />
        <label htmlFor="your-name">Your name</label>
        <input id="your-name" autoFocus autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" disabled={name.trim().length < 2}>Enter</button>
      </form>
    </div>
  );
}
