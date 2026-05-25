import { prisma } from "@/lib/db";
import { SnapshotsClient } from "./SnapshotsClient";

export const dynamic = "force-dynamic";

export default async function SnapshotsPage() {
  const snapshots = await prisma.snapshot.findMany({
    select: { id: true, label: true, takenAt: true, notes: true },
    orderBy: { takenAt: "desc" },
  });

  const serialized = snapshots.map((s) => ({
    id: s.id,
    label: s.label,
    takenAt: s.takenAt.toISOString(),
    notes: s.notes ?? null,
  }));

  return (
    <div className="p-6">
      <SnapshotsClient initial={serialized} />
    </div>
  );
}
