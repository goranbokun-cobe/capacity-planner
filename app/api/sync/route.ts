import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runTimeOffSync } from "@/lib/productive/sync";

export async function POST() {
  const job = await prisma.syncJob.create({
    data: { status: "running" },
  });

  try {
    const stats = await runTimeOffSync(prisma);
    const failed = stats.errors.length > 0;

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: failed ? "failed" : "ok",
        finishedAt: new Date(),
        message: failed ? stats.errors[0] : null,
        stats: JSON.stringify(stats),
      },
    });

    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: "failed", finishedAt: new Date(), message: String(err) },
    });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  const jobs = await prisma.syncJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  return NextResponse.json(jobs);
}
