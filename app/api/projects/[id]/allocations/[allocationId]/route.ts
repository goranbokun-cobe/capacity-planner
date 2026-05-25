import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; allocationId: string }> }
) {
  const { allocationId } = await params;
  try {
    await prisma.allocation.delete({ where: { id: allocationId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
