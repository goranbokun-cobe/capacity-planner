import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** GET /api/snapshots/[id] — full snapshot including payload. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}

/** DELETE /api/snapshots/[id] */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.snapshot.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
