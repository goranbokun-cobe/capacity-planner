import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  seniorityId: z.string().cuid(),
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  baseCapacity: z.number().min(0).max(1).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
});

export async function GET() {
  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    orderBy: { fullName: "asc" },
    include: {
      seniority: {
        include: {
          role: { include: { team: true } },
        },
      },
      overrides: { orderBy: { weekId: "asc" } },
    },
  });
  return NextResponse.json(people);
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const person = await prisma.person.create({
    data: {
      seniorityId: parsed.data.seniorityId,
      fullName: parsed.data.fullName,
      email: parsed.data.email ?? null,
      baseCapacity: parsed.data.baseCapacity ?? 1.0,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    },
    include: {
      seniority: { include: { role: { include: { team: true } } } },
      overrides: true,
    },
  });
  return NextResponse.json(person, { status: 201 });
}
