/**
 * Best-effort title → seniority tier matcher.
 * Returns a seniorityId if confident, null otherwise.
 * The import UI always lets the user override.
 */

interface SeniorityOption {
  id: string;
  name: string; // "Junior" | "Medior" | "Senior" | "Lead" | "Principal"
  role: { name: string; team: { name: string } };
}

// ── Seniority keyword → tier name ───────────────────────────────

const SENIORITY_PATTERNS: [RegExp, string][] = [
  [/\bprincipal\b/i,              "Principal"],
  [/\blead\b/i,                   "Lead"],
  [/\bsenior\b|\bsr\.?\b/i,       "Senior"],
  [/\bmedior\b|\bmid[\s-]?level\b|\bmid\b/i, "Medior"],
  [/\bjunior\b|\bjr\.?\b/i,       "Junior"],
];

// ── Team keyword → team name ─────────────────────────────────────

const TEAM_PATTERNS: [RegExp, string][] = [
  [/\bios\b/i,                        "Mobile"],
  [/\bandroid\b/i,                    "Mobile"],
  [/\bmobile\b/i,                     "Mobile"],
  [/\bfrontend\b|\bfront[\s-]end\b|\bfe\b/i, "Frontend"],
  [/\bbackend\b|\bback[\s-]end\b|\bbe\b/i,   "Backend"],
  [/\bdevops\b|\bsre\b|\binfrastructure\b|\bcloud\b/i, "DevOps"],
  [/\bqa\b|\bquality\b|\btesting\b|\btester\b/i, "QA"],
  [/\bdesign\b|\bux\b|\bui\b|\bproduct design\b/i, "Design"],
  [/\bproduct manager\b|\bpm\b|\bproject manager\b/i, "PM"],
];

function matchSeniority(title: string): string | null {
  for (const [re, name] of SENIORITY_PATTERNS) {
    if (re.test(title)) return name;
  }
  return null;
}

function matchTeam(title: string): string | null {
  for (const [re, name] of TEAM_PATTERNS) {
    if (re.test(title)) return name;
  }
  return null;
}

/**
 * Given a Productive job title and our full list of seniority tiers,
 * return the best-matching seniorityId or null.
 *
 * Scoring:
 *   2 pts — seniority name matches
 *   2 pts — team name matches
 * Returns the highest-scoring tier (or null if score = 0).
 */
export function autoMatchTitle(
  title: string | null,
  options: SeniorityOption[]
): string | null {
  if (!title || options.length === 0) return null;

  const wantedSeniority = matchSeniority(title);
  const wantedTeam = matchTeam(title);

  // If we couldn't extract either signal, bail out rather than guess
  if (!wantedSeniority && !wantedTeam) return null;

  let bestId: string | null = null;
  let bestScore = 0;

  for (const opt of options) {
    let score = 0;
    if (wantedSeniority && opt.name === wantedSeniority) score += 2;
    if (wantedTeam && opt.role.team.name === wantedTeam) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestId = opt.id;
    }
  }

  // Require BOTH team AND seniority to match (4 pts) to avoid false positives.
  // Team-only matches (2 pts) would just default to the first tier (Junior) which is misleading.
  return bestScore >= 4 ? bestId : null;
}
