import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  clientName: z.string().max(200).optional().nullable(),
  status: z.enum(["pipeline", "committed", "running", "done", "lost"]),
  probability: z.number().int().min(0).max(100).optional().nullable(),
  pipelineCalcMode: z.enum(["weighted", "full"]).optional().nullable(),
  startWeekId: z.string().regex(/^\d{4}-W\d{2}$/),
  endWeekId: z.string().regex(/^\d{4}-W\d{2}$/),
  notes: z.string().optional().nullable(),
  colorTagOverride: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { allocations: true } },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const project = await prisma.project.create({ data: parsed.data });
  return NextResponse.json(project, { status: 201 });
}
