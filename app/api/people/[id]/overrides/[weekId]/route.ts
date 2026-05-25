import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; weekId: string }> }
) {
  const { id, weekId } = await params;
  try {
    await prisma.capacityOverride.delete({
      where: { personId_weekId: { personId: id, weekId } },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
