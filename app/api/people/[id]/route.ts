import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  seniorityId: z.string().cuid().optional(),
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().nullable(),
  baseCapacity: z.number().min(0).max(1).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
});

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

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startDate !== undefined) {
    data.startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null;
  }
  if (parsed.data.endDate !== undefined) {
    data.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  }

  try {
    const person = await prisma.person.update({
      where: { id },
      data,
      include: {
        seniority: { include: { role: { include: { team: true } } } },
        overrides: { orderBy: { weekId: "asc" } },
      },
    });
    return NextResponse.json(person);
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
    const person = await prisma.person.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json(person);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
