import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchProductivePeople } from "@/lib/productive/people";
import { autoMatchTitle } from "@/lib/productive/matcher";

export interface ProductivePersonRow {
  productiveId: string;
  fullName: string;
  email: string | null;
  title: string | null;
  /** seniorityId our matcher guessed, or null */
  suggestedSeniorityId: string | null;
  /** true if already in our DB with this productiveId */
  alreadyImported: boolean;
}

export async function GET() {
  try {
    const [productivePeople, existingPeople, allSeniorities] = await Promise.all([
      fetchProductivePeople(),
      prisma.person.findMany({
        where: { productiveId: { not: null }, archivedAt: null },
        select: { productiveId: true },
      }),
      prisma.seniorityTier.findMany({
        where: { archivedAt: null },
        orderBy: { level: "asc" },
        include: { role: { include: { team: true } } },
      }),
    ]);

    const importedIds = new Set(existingPeople.map((p) => p.productiveId));

    const rows: ProductivePersonRow[] = productivePeople.map((pp) => ({
      productiveId: pp.id,
      fullName: pp.fullName,
      email: pp.email,
      title: pp.title,
      suggestedSeniorityId: autoMatchTitle(pp.title, allSeniorities),
      alreadyImported: importedIds.has(pp.id),
    }));

    // Sort: un-imported first, then alphabetically
    rows.sort((a, b) => {
      if (a.alreadyImported !== b.alreadyImported)
        return a.alreadyImported ? 1 : -1;
      return a.fullName.localeCompare(b.fullName);
    });

    return NextResponse.json({ people: rows, totalInProductive: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
