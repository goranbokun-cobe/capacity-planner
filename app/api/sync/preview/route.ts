import { NextResponse } from "next/server";
import { fetchProductiveDeals } from "@/lib/productive/deals";
import { prisma } from "@/lib/db";

export async function GET() {
  const [deals, projects] = await Promise.all([
    fetchProductiveDeals(),
    prisma.project.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, clientName: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ deals, projects });
}
