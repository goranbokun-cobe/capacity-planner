import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  capacity: z.number().min(0).max(1),
  reason: z.string().max(200).optional().nullable(),
  source: z.enum(["manual", "productive"]).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const overrides = await prisma.capacityOverride.findMany({
    where: { personId: id },
    orderBy: { weekId: "asc" },
  });
  return NextResponse.json(overrides);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const override = await prisma.capacityOverride.upsert({
    where: { personId_weekId: { personId: id, weekId: parsed.data.weekId } },
    update: {
      capacity: parsed.data.capacity,
      reason: parsed.data.reason ?? null,
    },
    create: {
      personId: id,
      weekId: parsed.data.weekId,
      capacity: parsed.data.capacity,
      reason: parsed.data.reason ?? null,
      source: parsed.data.source ?? "manual",
    },
  });
  return NextResponse.json(override, { status: 201 });
}
