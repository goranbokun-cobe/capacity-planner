import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Standard seniority tiers used by most teams
const STANDARD_TIERS = [
  { name: "Junior", level: 1, defaultCapacity: 1.0 },
  { name: "Medior", level: 2, defaultCapacity: 1.0 },
  { name: "Senior", level: 3, defaultCapacity: 1.0 },
  { name: "Lead",   level: 4, defaultCapacity: 1.0 },
];

// Design has an extra Principal tier above Lead
const DESIGN_TIERS = [
  ...STANDARD_TIERS,
  { name: "Principal", level: 5, defaultCapacity: 1.0 },
];

// The 7 Cobe teams with their roles
const TEAMS: {
  name: string;
  displayOrder: number;
  roles: { name: string; tiers: typeof STANDARD_TIERS }[];
}[] = [
  {
    name: "Mobile",
    displayOrder: 1,
    roles: [
      { name: "iOS Engineer",     tiers: STANDARD_TIERS },
      { name: "Android Engineer", tiers: STANDARD_TIERS },
    ],
  },
  {
    name: "Frontend",
    displayOrder: 2,
    roles: [
      { name: "Frontend Engineer", tiers: STANDARD_TIERS },
    ],
  },
  {
    name: "Backend",
    displayOrder: 3,
    roles: [
      { name: "Backend Engineer", tiers: STANDARD_TIERS },
    ],
  },
  {
    name: "DevOps",
    displayOrder: 4,
    roles: [
      { name: "DevOps Engineer", tiers: STANDARD_TIERS },
    ],
  },
  {
    name: "QA",
    displayOrder: 5,
    roles: [
      { name: "QA Engineer", tiers: STANDARD_TIERS },
    ],
  },
  {
    name: "Design",
    displayOrder: 6,
    roles: [
      { name: "Product Designer", tiers: DESIGN_TIERS },
      { name: "UX Researcher",    tiers: DESIGN_TIERS },
    ],
  },
  {
    name: "PM",
    displayOrder: 7,
    roles: [
      { name: "Product Manager", tiers: STANDARD_TIERS },
    ],
  },
];

// Default pipeline color bands (§6.5)
const DEFAULT_COLOR_BANDS = JSON.stringify([
  { minPct: 0,   maxPct: 24,  color: "#C7C7CC", label: "Long shot"  },
  { minPct: 25,  maxPct: 49,  color: "#A5C8FF", label: "Possible"   },
  { minPct: 50,  maxPct: 74,  color: "#FFD27F", label: "Likely"     },
  { minPct: 75,  maxPct: 99,  color: "#FF9F70", label: "Hot"        },
  { minPct: 100, maxPct: 100, color: "#34C759", label: "Won"        },
]);

async function main() {
  console.log("Seeding database…");

  // Upsert teams, roles, seniority tiers
  for (const teamDef of TEAMS) {
    const team = await prisma.team.upsert({
      where: { name: teamDef.name },
      update: { displayOrder: teamDef.displayOrder },
      create: { name: teamDef.name, displayOrder: teamDef.displayOrder },
    });

    for (const roleDef of teamDef.roles) {
      const role = await prisma.role.upsert({
        where: { teamId_name: { teamId: team.id, name: roleDef.name } },
        update: {},
        create: { teamId: team.id, name: roleDef.name },
      });

      for (const tierDef of roleDef.tiers) {
        await prisma.seniorityTier.upsert({
          where: { roleId_name: { roleId: role.id, name: tierDef.name } },
          update: { level: tierDef.level, defaultCapacity: tierDef.defaultCapacity },
          create: {
            roleId: role.id,
            name: tierDef.name,
            level: tierDef.level,
            defaultCapacity: tierDef.defaultCapacity,
          },
        });
      }
    }

    console.log(`  ✓ ${teamDef.name} (${teamDef.roles.length} role(s))`);
  }

  // Upsert singleton pipeline settings
  await prisma.pipelineSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultCalcMode: "weighted",
      colorBands: DEFAULT_COLOR_BANDS,
    },
  });
  console.log("  ✓ PipelineSettings (singleton)");

  // Sample pipeline deal so there's something to look at
  const existing = await prisma.project.findFirst({ where: { name: "Sample Pipeline Deal" } });
  if (!existing) {
    await prisma.project.create({
      data: {
        name: "Sample Pipeline Deal",
        clientName: "Demo Client",
        status: "pipeline",
        probability: 60,
        pipelineCalcMode: null,
        startWeekId: "2026-W24",
        endWeekId: "2026-W34",
      },
    });
    console.log("  ✓ Sample Pipeline Deal (pipeline, 60%)");
  }

  console.log("\nSeed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
