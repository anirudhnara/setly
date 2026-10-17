import { Suspense, type ReactNode } from "react";

/** Dynamic group id streams in, so the nav can prerender with Cache Components on. */
export function GroupSlot({
  params,
  children,
}: {
  params: Promise<{ groupId: string }>;
  children: (groupId: string) => ReactNode;
}) {
  return (
    <Suspense fallback={<p className="orbit-status">Syncing the group…</p>}>
      <Resolved params={params}>{children}</Resolved>
    </Suspense>
  );
}

async function Resolved({
  params,
  children,
}: {
  params: Promise<{ groupId: string }>;
  children: (groupId: string) => ReactNode;
}) {
  const { groupId } = await params;
  return children(groupId);
}
