import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  roleId: z.string().cuid(),
  name: z.string().min(1).max(100),
  level: z.number().int().min(1),
  defaultCapacity: z.number().min(0).max(1).optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const tier = await prisma.seniorityTier.create({
    data: {
      roleId: parsed.data.roleId,
      name: parsed.data.name,
      level: parsed.data.level,
      defaultCapacity: parsed.data.defaultCapacity ?? 1.0,
    },
  });
  return NextResponse.json(tier, { status: 201 });
}
