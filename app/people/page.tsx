import { prisma } from "@/lib/db";
import { PeopleEditor } from "./PeopleEditor";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const [people, allSeniorities] = await Promise.all([
    prisma.person.findMany({
      where: { archivedAt: null, seniority: { role: { archivedAt: null, team: { archivedAt: null } } } },
      orderBy: { fullName: "asc" },
      include: {
        seniority: {
          include: {
            role: { include: { team: true } },
          },
        },
        overrides: { orderBy: { weekId: "asc" } },
      },
    }),
    prisma.seniorityTier.findMany({
      where: { archivedAt: null, role: { archivedAt: null, team: { archivedAt: null } } },
      orderBy: { level: "asc" },
      include: {
        role: { include: { team: true } },
      },
    }),
  ]);

  return (
    <div className="p-6">
      <PeopleEditor initialPeople={people} allSeniorities={allSeniorities} />
    </div>
  );
}
