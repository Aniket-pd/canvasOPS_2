export const architectureProfileIds = [
  "general",
  "saas",
  "ecommerce",
  "event-driven",
  "ai-application",
  "data-platform",
] as const;

export type ArchitectureProfileId = (typeof architectureProfileIds)[number];

export type ArchitectureBrief = {
  version: 1;
  profile: ArchitectureProfileId;
  systemName: string;
  objective: string;
  expectedTraffic: string;
  requiredRegions: string[];
  maxMonthlyCost: number;
  minimumReplicas: number;
  availabilityTarget: "best-effort" | "99.9" | "99.95" | "99.99";
  dataSensitivity: "public" | "internal" | "confidential" | "restricted";
  preferredTechnologies: string[];
  constraints: string[];
};

export type ArchitectureProfile = {
  id: ArchitectureProfileId;
  label: string;
  description: string;
  role: string;
  requiredChecks: string[];
  avoid: string[];
};

export const architectureProfiles: Record<
  ArchitectureProfileId,
  ArchitectureProfile
> = {
  general: {
    id: "general",
    label: "General system architect",
    description: "Balanced architecture for common production systems.",
    role: "Act as a pragmatic senior distributed-systems architect.",
    requiredChecks: [
      "Trace every user-facing request from entry point to data dependency.",
      "Identify single points of failure and disconnected components.",
      "Prefer the smallest architecture that satisfies the brief.",
    ],
    avoid: ["Unnecessary services", "Provider-specific component types"],
  },
  saas: {
    id: "saas",
    label: "SaaS architect",
    description: "Multi-tenant web products and internal business software.",
    role: "Act as a senior multi-tenant SaaS platform architect.",
    requiredChecks: [
      "Include identity and authorization boundaries.",
      "Explain tenant isolation and data ownership.",
      "Cover background work, observability, and safe regional failover.",
    ],
    avoid: ["Shared tenant secrets", "Stateful application services"],
  },
  ecommerce: {
    id: "ecommerce",
    label: "E-commerce architect",
    description: "Catalog, checkout, payments, inventory, and fulfillment.",
    role: "Act as a senior high-availability commerce architect.",
    requiredChecks: [
      "Separate checkout-critical and browse-only paths.",
      "Model payment providers as external systems.",
      "Protect inventory consistency and make event processing idempotent.",
    ],
    avoid: ["Payment data in ordinary services", "Synchronous fulfillment chains"],
  },
  "event-driven": {
    id: "event-driven",
    label: "Event-driven architect",
    description: "Queues, streams, workers, and asynchronous workflows.",
    role: "Act as a senior event-driven systems architect.",
    requiredChecks: [
      "Define producers, consumers, retry behavior, and dead-letter handling.",
      "Explain delivery and ordering assumptions.",
      "Make consumers idempotent and observable.",
    ],
    avoid: ["Unbounded retries", "Events without an owning producer"],
  },
  "ai-application": {
    id: "ai-application",
    label: "AI application architect",
    description: "AI features, RAG systems, agents, and model-backed products.",
    role: "Act as a senior AI application and platform architect.",
    requiredChecks: [
      "Model providers as external systems and background inference as workers.",
      "Explain sensitive-data boundaries, retrieval storage, and caching.",
      "Include evaluation, fallback, latency, and cost considerations.",
    ],
    avoid: ["Unbounded model calls", "Sensitive prompts without a trust boundary"],
  },
  "data-platform": {
    id: "data-platform",
    label: "Data-platform architect",
    description: "Ingestion, transformation, serving, and analytical workloads.",
    role: "Act as a senior data-platform and reliability architect.",
    requiredChecks: [
      "Separate ingestion, processing, storage, and serving paths.",
      "Explain data freshness, retention, lineage, and recovery.",
      "Use asynchronous processing for long-running transformations.",
    ],
    avoid: ["Unowned datasets", "Online traffic coupled to batch processing"],
  },
};

export const defaultArchitectureBrief: ArchitectureBrief = {
  version: 1,
  profile: "saas",
  systemName: "Production architecture",
  objective: "Serve a reliable multi-region web application for customers.",
  expectedTraffic: "Early growth: up to 100 requests/second",
  requiredRegions: ["bom-1", "sin-1"],
  maxMonthlyCost: 300,
  minimumReplicas: 2,
  availabilityTarget: "99.9",
  dataSensitivity: "confidential",
  preferredTechnologies: ["PostgreSQL", "Containers"],
  constraints: ["Prefer managed services", "No single-region application tier"],
};

export function normalizeArchitectureBrief(
  input: Partial<ArchitectureBrief>,
): ArchitectureBrief {
  const profile = architectureProfileIds.includes(
    input.profile as ArchitectureProfileId,
  )
    ? (input.profile as ArchitectureProfileId)
    : defaultArchitectureBrief.profile;
  return {
    ...defaultArchitectureBrief,
    ...input,
    version: 1,
    profile,
    systemName: input.systemName?.trim() || defaultArchitectureBrief.systemName,
    objective: input.objective?.trim() || defaultArchitectureBrief.objective,
    expectedTraffic:
      input.expectedTraffic?.trim() || defaultArchitectureBrief.expectedTraffic,
    requiredRegions: cleanList(
      input.requiredRegions ?? defaultArchitectureBrief.requiredRegions,
    ),
    preferredTechnologies: cleanList(
      input.preferredTechnologies ??
        defaultArchitectureBrief.preferredTechnologies,
    ),
    constraints: cleanList(
      input.constraints ?? defaultArchitectureBrief.constraints,
    ),
    maxMonthlyCost: Math.max(
      1,
      Math.min(100_000, Math.round(input.maxMonthlyCost ?? 300)),
    ),
    minimumReplicas: Math.max(
      1,
      Math.min(12, Math.round(input.minimumReplicas ?? 2)),
    ),
  };
}

export function architectureBriefFingerprint(brief: ArchitectureBrief) {
  const canonical = JSON.stringify(brief);
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `brief-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cleanList(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).slice(0, 12);
}
