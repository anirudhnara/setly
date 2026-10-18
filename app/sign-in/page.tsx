import { Suspense } from "react";
import { SignInForm } from "@/app/sign-in/sign-in-form";

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="sign-in-shell"><p className="sign-in-status">Loading sign-in…</p></main>}>
      <SignInForm />
    </Suspense>
  );
}
