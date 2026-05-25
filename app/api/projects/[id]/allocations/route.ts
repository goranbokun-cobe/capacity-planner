import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const upsertSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  seniorityId: z.string().cuid(),
  fte: z.number().min(0).max(99),
  notes: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const body = await req.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { weekId, seniorityId, fte, notes } = parsed.data;

  // Delete if FTE drops to 0 to keep the DB clean
  if (fte === 0) {
    await prisma.allocation.deleteMany({
      where: { projectId, weekId, seniorityId },
    });
    return NextResponse.json({ deleted: true });
  }

  const allocation = await prisma.allocation.upsert({
    where: { projectId_weekId_seniorityId: { projectId, weekId, seniorityId } },
    update: { fte, notes: notes ?? null },
    create: { projectId, weekId, seniorityId, fte, notes: notes ?? null },
  });
  return NextResponse.json(allocation, { status: 201 });
}
