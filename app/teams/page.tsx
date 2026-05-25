import { prisma } from "@/lib/db";
import { TeamsEditor } from "./TeamsEditor";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    where: { archivedAt: null },
    orderBy: { displayOrder: "asc" },
    include: {
      roles: {
        where: { archivedAt: null },
        orderBy: { displayOrder: "asc" },
        include: {
          seniorities: {
            where: { archivedAt: null },
            orderBy: { level: "asc" },
          },
          _count: { select: { seniorities: { where: { archivedAt: null } } } },
        },
      },
    },
  });

  // Person count per seniority
  const personCounts = await prisma.person.groupBy({
    by: ["seniorityId"],
    where: { archivedAt: null },
    _count: true,
  });
  const countBySeniority = Object.fromEntries(
    personCounts.map((r) => [r.seniorityId, r._count])
  );

  return (
    <div className="p-6">
      <TeamsEditor initialTeams={teams} personCountBySeniority={countBySeniority} />
    </div>
  );
}
