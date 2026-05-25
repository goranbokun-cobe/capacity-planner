import { fetchAllWithIncluded, type JsonApiResource } from "./client";

export interface ProductiveDeal {
  id: string;
  name: string;
  probability: number;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  stageStatus: "open" | "won" | "lost";
  clientName: string | null;
}

function relId(resource: JsonApiResource, name: string): string | null {
  const rel = (resource.relationships as Record<string, unknown> | undefined)?.[name] as
    | { data?: { id: string } }
    | undefined;
  return rel?.data?.id ?? null;
}

async function fetchDealsByStage(stageStatusId: string): Promise<ProductiveDeal[]> {
  const { data, included } = await fetchAllWithIncluded("/deals", {
    "filter[stage_status_id][]": stageStatusId,
    "filter[type]": "1",
    "include": "company",
  });

  return data.map((deal) => {
    const companyId = relId(deal, "company");
    const company = companyId
      ? included.find((r) => r.type === "companies" && r.id === companyId)
      : null;

    const stage = deal.attributes.stage_status_id as number;

    return {
      id: deal.id,
      name: (deal.attributes.name as string) || "Unnamed Deal",
      probability: (deal.attributes.probability as number) ?? 0,
      startDate: (deal.attributes.date as string | null) ?? null,
      endDate: (deal.attributes.end_date as string | null) ?? null,
      stageStatus: stage === 1 ? "open" : stage === 2 ? "won" : "lost",
      clientName: company ? ((company.attributes.name as string) ?? null) : null,
    };
  });
}

/** Fetch open (pipeline) and won (committed) deals. */
export async function fetchProductiveDeals(): Promise<ProductiveDeal[]> {
  const [open, won] = await Promise.all([
    fetchDealsByStage("1"),
    fetchDealsByStage("2"),
  ]);
  return [...open, ...won];
}
