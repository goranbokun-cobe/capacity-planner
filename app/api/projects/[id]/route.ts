import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  clientName: z.string().max(200).optional().nullable(),
  status: z.enum(["pipeline", "committed", "running", "done", "lost"]).optional(),
  probability: z.number().int().min(0).max(100).optional().nullable(),
  pipelineCalcMode: z.enum(["weighted", "full"]).optional().nullable(),
  startWeekId: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
  endWeekId: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
  notes: z.string().optional().nullable(),
  colorTagOverride: z.string().optional().nullable(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      allocations: {
        include: { seniority: { include: { role: { include: { team: true } } } } },
        orderBy: [{ weekId: "asc" }, { seniorityId: "asc" }],
      },
    },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const project = await prisma.project.update({ where: { id }, data: parsed.data });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const project = await prisma.project.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
