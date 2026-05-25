import { prisma } from "@/lib/db";
import { SyncClient } from "./SyncClient";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const jobs = await prisma.syncJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  const serialized = jobs.map((j) => ({
    id: j.id,
    startedAt: j.startedAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
    status: j.status,
    message: j.message ?? null,
    stats: j.stats ?? null,
  }));

  return (
    <div className="p-6 max-w-3xl">
      <SyncClient jobs={serialized} />
    </div>
  );
}
