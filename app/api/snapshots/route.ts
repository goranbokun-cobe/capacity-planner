import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { SnapshotPayload } from "@/lib/snapshots";
import { collectPayload } from "@/lib/snapshot-payload";

/** GET /api/snapshots — list all snapshots (no payload). */
export async function GET() {
  const snapshots = await prisma.snapshot.findMany({
    select: { id: true, label: true, takenAt: true, notes: true },
    orderBy: { takenAt: "desc" },
  });
  return NextResponse.json(snapshots);
}

/** POST /api/snapshots — take a new snapshot.
 *  Accepts optional `payload` to save a pre-built payload (e.g. from what-if). */
export async function POST(req: Request) {
  const {
    label,
    notes,
    payload: providedPayload,
  }: { label: string; notes?: string; payload?: SnapshotPayload } = await req.json();

  if (!label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const payload = providedPayload ?? await collectPayload();
  const snapshot = await prisma.snapshot.create({
    data: {
      label: label.trim(),
      notes: notes?.trim() ?? null,
      payload: JSON.stringify(payload),
    },
    select: { id: true, label: true, takenAt: true, notes: true },
  });

  return NextResponse.json(snapshot, { status: 201 });
}
