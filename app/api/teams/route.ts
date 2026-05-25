import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  displayOrder: z.number().int().optional(),
});

export async function GET() {
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
        },
      },
    },
  });
  return NextResponse.json(teams);
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const maxOrder = await prisma.team.aggregate({ _max: { displayOrder: true } });
  const team = await prisma.team.create({
    data: {
      name: parsed.data.name,
      displayOrder: parsed.data.displayOrder ?? (maxOrder._max.displayOrder ?? 0) + 1,
    },
  });
  return NextResponse.json(team, { status: 201 });
}
