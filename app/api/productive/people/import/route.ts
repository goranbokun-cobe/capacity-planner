import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  people: z.array(
    z.object({
      productiveId: z.string(),
      fullName: z.string().min(1),
      email: z.string().email().nullable(),
      seniorityId: z.string().cuid(),
      baseCapacity: z.number().min(0).max(1).optional(),
    })
  ),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const results = { created: 0, skipped: 0, errors: [] as string[] };

  for (const p of parsed.data.people) {
    try {
      // Skip if already imported (upsert by productiveId)
      await prisma.person.upsert({
        where: { productiveId: p.productiveId },
        update: {
          // On re-import, update name and email but not seniority/capacity
          fullName: p.fullName,
          email: p.email,
        },
        create: {
          productiveId: p.productiveId,
          fullName: p.fullName,
          email: p.email,
          seniorityId: p.seniorityId,
          baseCapacity: p.baseCapacity ?? 1.0,
        },
      });
      results.created++;
    } catch (e) {
      results.errors.push(`${p.fullName}: ${String(e)}`);
      results.skipped++;
    }
  }

  return NextResponse.json(results, { status: 201 });
}
