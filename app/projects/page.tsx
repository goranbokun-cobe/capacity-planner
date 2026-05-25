import { prisma } from "@/lib/db";
import { ProjectsClient } from "./ProjectsClient";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [projects, settings] = await Promise.all([
    prisma.project.findMany({
      where: { archivedAt: null },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { _count: { select: { allocations: true } } },
    }),
    prisma.pipelineSettings.findFirst(),
  ]);

  const colorBands = settings?.colorBands ? JSON.parse(settings.colorBands) : undefined;

  return (
    <div className="p-6">
      <ProjectsClient projects={projects} colorBands={colorBands} />
    </div>
  );
}
