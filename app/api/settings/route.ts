import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  defaultCalcMode: z.enum(["weighted", "full"]).optional(),
  colorBands: z.string().optional(), // JSON string
  utilThresholds: z.string().optional(), // JSON string stored in colorBands col for now
});

export async function GET() {
  const settings = await prisma.pipelineSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultCalcMode: "weighted",
      colorBands: JSON.stringify([
        { minPct: 0,   maxPct: 24,  color: "#C7C7CC", label: "Long shot"  },
        { minPct: 25,  maxPct: 49,  color: "#A5C8FF", label: "Possible"   },
        { minPct: 50,  maxPct: 74,  color: "#FFD27F", label: "Likely"     },
        { minPct: 75,  maxPct: 99,  color: "#FF9F70", label: "Hot"        },
        { minPct: 100, maxPct: 100, color: "#34C759", label: "Won"        },
      ]),
    },
  });
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await prisma.pipelineSettings.update({
    where: { id: 1 },
    data: parsed.data,
  });
  return NextResponse.json(settings);
}
