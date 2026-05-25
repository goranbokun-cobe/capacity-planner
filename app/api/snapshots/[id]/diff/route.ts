import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { diffPayloads, type SnapshotPayload } from "@/lib/snapshots";
import { collectPayload } from "@/lib/snapshot-payload";

/** GET /api/snapshots/[id]/diff — diff snapshot against current live state. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const snapshotPayload: SnapshotPayload = JSON.parse(snapshot.payload);
  const currentPayload = await collectPayload();
  const diff = diffPayloads(snapshotPayload, currentPayload);

  return NextResponse.json(diff);
}
