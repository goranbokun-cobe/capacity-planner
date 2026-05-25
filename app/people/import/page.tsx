import { prisma } from "@/lib/db";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const allSeniorities = await prisma.seniorityTier.findMany({
    where: { archivedAt: null, role: { archivedAt: null, team: { archivedAt: null } } },
    orderBy: { level: "asc" },
    include: { role: { include: { team: { select: { name: true } } } } },
  });

  return (
    <div className="p-6">
      <ImportClient allSeniorities={allSeniorities} />
    </div>
  );
}
