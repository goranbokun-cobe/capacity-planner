import { prisma } from "@/lib/db";
import { SettingsClient } from "./SettingsClient";
import { DEFAULT_COLOR_BANDS } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await prisma.pipelineSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultCalcMode: "weighted",
      colorBands: JSON.stringify(DEFAULT_COLOR_BANDS),
    },
  });

  const colorBands = JSON.parse(settings.colorBands);

  return (
    <div className="p-6 max-w-2xl">
      <SettingsClient
        defaultCalcMode={settings.defaultCalcMode as "weighted" | "full"}
        colorBands={colorBands}
      />
    </div>
  );
}
