import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProjectEditor } from "./ProjectEditor";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [project, allSeniorities, settings] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      include: {
        allocations: {
          include: {
            seniority: { include: { role: { include: { team: true } } } },
          },
          orderBy: [{ weekId: "asc" }],
        },
      },
    }),
    prisma.seniorityTier.findMany({
      where: { archivedAt: null, role: { archivedAt: null, team: { archivedAt: null } } },
      orderBy: { level: "asc" },
      include: { role: { include: { team: { select: { name: true, displayOrder: true } } } } },
    }),
    prisma.pipelineSettings.findFirst(),
  ]);

  if (!project) notFound();

  const colorBands = settings?.colorBands ? JSON.parse(settings.colorBands) : undefined;
  const defaultCalcMode = (settings?.defaultCalcMode ?? "weighted") as "weighted" | "full";

  return (
    <div className="p-6">
      <ProjectEditor
        project={project}
        allSeniorities={allSeniorities}
        colorBands={colorBands}
        defaultCalcMode={defaultCalcMode}
      />
    </div>
  );
}
