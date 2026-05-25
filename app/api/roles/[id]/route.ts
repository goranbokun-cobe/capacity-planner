import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayOrder: z.number().int().optional(),
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
  try {
    const role = await prisma.role.update({ where: { id }, data: parsed.data });
    return NextResponse.json(role);
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
    const role = await prisma.role.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json(role);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
