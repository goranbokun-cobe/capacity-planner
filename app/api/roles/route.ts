import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  teamId: z.string().cuid(),
  name: z.string().min(1).max(100),
  displayOrder: z.number().int().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const maxOrder = await prisma.role.aggregate({
    where: { teamId: parsed.data.teamId },
    _max: { displayOrder: true },
  });

  const role = await prisma.role.create({
    data: {
      teamId: parsed.data.teamId,
      name: parsed.data.name,
      displayOrder: parsed.data.displayOrder ?? (maxOrder._max.displayOrder ?? 0) + 1,
    },
    include: { seniorities: { orderBy: { level: "asc" } } },
  });
  return NextResponse.json(role, { status: 201 });
}
