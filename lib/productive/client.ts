/**
 * Thin Productive.io API v2 client.
 * JSON:API format — relationships require explicit ?include= to get IDs.
 */

const BASE = "https://api.productive.io/api/v2";

function getHeaders() {
  const token = process.env.PRODUCTIVE_API_TOKEN;
  const orgId = process.env.PRODUCTIVE_ORG_ID;
  if (!token || !orgId) {
    throw new Error(
      "PRODUCTIVE_API_TOKEN and PRODUCTIVE_ORG_ID must be set in .env"
    );
  }
  return {
    "X-Auth-Token": token,
    "X-Organization-Id": orgId,
    "Content-Type": "application/vnd.api+json",
  };
}

export interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: {
    current_page: number;
    total_pages: number;
    total_count: number;
    page_size: number;
  };
}

export type ParamValue = string | string[];
export type Params = Record<string, ParamValue>;

/** Fetch a single page from a Productive endpoint. */
export async function fetchPage(
  path: string,
  params: Params = {}
): Promise<JsonApiResponse> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const val of v) url.searchParams.append(k, val);
    } else {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: getHeaders(),
    next: { revalidate: 0 }, // no Next.js caching — always fresh
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Productive API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<JsonApiResponse>;
}

/** Fetch all pages, also accumulating the `included` sideload array. */
export async function fetchAllWithIncluded(
  path: string,
  params: Params = {},
  maxRecords = 1000
): Promise<{ data: JsonApiResource[]; included: JsonApiResource[] }> {
  const allData: JsonApiResource[] = [];
  const includedMap = new Map<string, JsonApiResource>(); // key = "type:id"
  let page = 1;

  while (true) {
    const resp = await fetchPage(path, {
      ...params,
      "page[number]": String(page),
      "page[size]": "200",
    });

    const items = Array.isArray(resp.data) ? resp.data : [resp.data];
    allData.push(...items);

    for (const inc of resp.included ?? []) {
      includedMap.set(`${inc.type}:${inc.id}`, inc);
    }

    const meta = resp.meta;
    if (!meta || page >= meta.total_pages || allData.length >= maxRecords) break;
    page++;
  }

  return { data: allData, included: [...includedMap.values()] };
}

/** Fetch all pages of a list endpoint, up to a hard cap of 1000 records. */
export async function fetchAll(
  path: string,
  params: Params = {}
): Promise<JsonApiResource[]> {
  const results: JsonApiResource[] = [];
  let page = 1;

  while (true) {
    const data = await fetchPage(path, {
      ...params,
      "page[number]": String(page),
      "page[size]": "200",
    });

    const items = Array.isArray(data.data) ? data.data : [data.data];
    results.push(...items);

    const meta = data.meta;
    if (!meta || page >= meta.total_pages || results.length >= 1000) break;
    page++;
  }

  return results;
}
