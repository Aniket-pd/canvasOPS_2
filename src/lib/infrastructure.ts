import type { Edge, Node } from "@xyflow/react";

export const infrastructureTypes = [
  "client",
  "service",
  "api-gateway",
  "load-balancer",
  "database",
  "cache",
  "storage",
  "queue",
  "external-system",
  "auth-service",
  "worker",
  "group",
  "note",
] as const;

export type InfrastructureType = (typeof infrastructureTypes)[number];

export type InfrastructureConfig = {
  region: string;
  size: string;
  replicas: number;
  envVars: Record<string, string>;
  technology: string;
  description: string;
  owner: string;
  environment: string;
  customProperties: Record<string, string>;
  inputPorts: string[];
  outputPorts: string[];
};

export type InfrastructureNodeData = {
  label: string;
  type: InfrastructureType;
  config: InfrastructureConfig;
  monthlyCost: number;
  status: "healthy" | "draft" | "warning";
  collapsed?: boolean;
  groupSize?: { width: number; height: number };
};

export type InfrastructureNode = Node<InfrastructureNodeData, "infrastructure">;

export function nodeReference(nodeId: string) {
  const numericSuffix = nodeId.match(/-(\d+)$/)?.[1];
  return numericSuffix
    ? `N${numericSuffix}`
    : `N-${nodeId.slice(-4).toUpperCase()}`;
}

export type ComponentCategory =
  | "Applications"
  | "Compute"
  | "Data"
  | "Integration"
  | "Organization";

export type ComponentDefinition = {
  label: string;
  description: string;
  category: ComponentCategory;
  cost: number;
  accent: string;
  defaultTechnology: string;
  defaultSize: string;
  defaultRegion?: string;
  defaultReplicas?: number;
  inputPorts: string[];
  outputPorts: string[];
  connectable: boolean;
  container?: boolean;
};

export const infrastructureCatalog: Record<
  InfrastructureType,
  ComponentDefinition
> = {
  client: {
    label: "Client Application",
    description: "Web, mobile, or desktop client",
    category: "Applications",
    cost: 0,
    accent: "#38bdf8",
    defaultTechnology: "Web",
    defaultSize: "n/a",
    defaultRegion: "global",
    inputPorts: ["response"],
    outputPorts: ["request"],
    connectable: true,
  },
  service: {
    label: "Service",
    description: "Backend application or microservice",
    category: "Compute",
    cost: 42,
    accent: "#67e8f9",
    defaultTechnology: "Container",
    defaultSize: "standard-1",
    inputPorts: ["request"],
    outputPorts: ["response", "event"],
    connectable: true,
  },
  "api-gateway": {
    label: "API Gateway",
    description: "Public API entry and routing",
    category: "Integration",
    cost: 18,
    accent: "#b8f34a",
    defaultTechnology: "Managed Gateway",
    defaultSize: "standard-1",
    defaultRegion: "global",
    inputPorts: ["public-request"],
    outputPorts: ["service-request"],
    connectable: true,
  },
  "load-balancer": {
    label: "Load Balancer",
    description: "Distributes traffic across services",
    category: "Integration",
    cost: 22,
    accent: "#84cc16",
    defaultTechnology: "Managed Load Balancer",
    defaultSize: "standard-1",
    inputPorts: ["traffic"],
    outputPorts: ["balanced-traffic"],
    connectable: true,
  },
  database: {
    label: "Database",
    description: "Relational, NoSQL, or vector data",
    category: "Data",
    cost: 76,
    accent: "#a78bfa",
    defaultTechnology: "PostgreSQL",
    defaultSize: "db-standard-2",
    defaultReplicas: 2,
    inputPorts: ["query", "write"],
    outputPorts: ["result", "change-event"],
    connectable: true,
  },
  cache: {
    label: "Cache",
    description: "Low-latency temporary data",
    category: "Data",
    cost: 28,
    accent: "#fbbf24",
    defaultTechnology: "Redis",
    defaultSize: "cache-standard-1",
    inputPorts: ["get", "set"],
    outputPorts: ["value"],
    connectable: true,
  },
  storage: {
    label: "File / Object Storage",
    description: "Files, media, assets, and backups",
    category: "Data",
    cost: 12,
    accent: "#fb923c",
    defaultTechnology: "Object Storage",
    defaultSize: "usage-based",
    inputPorts: ["write"],
    outputPorts: ["read"],
    connectable: true,
  },
  queue: {
    label: "Queue / Event Stream",
    description: "Asynchronous messages and events",
    category: "Integration",
    cost: 24,
    accent: "#f472b6",
    defaultTechnology: "Message Queue",
    defaultSize: "standard-1",
    inputPorts: ["publish"],
    outputPorts: ["consume"],
    connectable: true,
  },
  "external-system": {
    label: "External System",
    description: "Third-party API or external dependency",
    category: "Integration",
    cost: 0,
    accent: "#94a3b8",
    defaultTechnology: "External API",
    defaultSize: "n/a",
    defaultRegion: "global",
    inputPorts: ["request"],
    outputPorts: ["response", "webhook"],
    connectable: true,
  },
  "auth-service": {
    label: "Authentication Service",
    description: "Identity, login, and authorization",
    category: "Compute",
    cost: 35,
    accent: "#2dd4bf",
    defaultTechnology: "OIDC / OAuth",
    defaultSize: "standard-1",
    inputPorts: ["credentials", "token-request"],
    outputPorts: ["identity", "token"],
    connectable: true,
  },
  worker: {
    label: "Background Worker",
    description: "Asynchronous and long-running processing",
    category: "Compute",
    cost: 32,
    accent: "#c084fc",
    defaultTechnology: "Container Worker",
    defaultSize: "standard-1",
    inputPorts: ["job", "event"],
    outputPorts: ["result", "event"],
    connectable: true,
  },
  group: {
    label: "System Boundary",
    description: "Collapsible group of related components",
    category: "Organization",
    cost: 0,
    accent: "#eab308",
    defaultTechnology: "Logical boundary",
    defaultSize: "n/a",
    defaultRegion: "global",
    inputPorts: [],
    outputPorts: [],
    connectable: false,
    container: true,
  },
  note: {
    label: "Design Note",
    description: "Requirement, decision, or explanation",
    category: "Organization",
    cost: 0,
    accent: "#facc15",
    defaultTechnology: "Documentation",
    defaultSize: "n/a",
    defaultRegion: "global",
    inputPorts: [],
    outputPorts: [],
    connectable: false,
  },
};

export const defaultConfig = (
  type: InfrastructureType,
  overrides: Partial<InfrastructureConfig> = {},
): InfrastructureConfig => ({
  region: infrastructureCatalog[type].defaultRegion ?? "bom-1",
  size: infrastructureCatalog[type].defaultSize,
  replicas: infrastructureCatalog[type].defaultReplicas ?? 1,
  envVars: {},
  technology: infrastructureCatalog[type].defaultTechnology,
  description: infrastructureCatalog[type].description,
  owner: "Unassigned",
  environment: "production",
  customProperties: {},
  inputPorts: [...infrastructureCatalog[type].inputPorts],
  outputPorts: [...infrastructureCatalog[type].outputPorts],
  ...overrides,
});

export function monthlyCostFor(type: InfrastructureType, replicas: number) {
  const includedReplicas = defaultConfig(type).replicas;
  return Math.round(
    infrastructureCatalog[type].cost * Math.max(1, replicas / includedReplicas),
  );
}

export function isConnectableType(type: InfrastructureType) {
  return infrastructureCatalog[type].connectable;
}

const legacyTypeMap: Record<string, InfrastructureType> = {
  "edge-worker": "api-gateway",
  "api-service": "service",
};

export function migrateInfrastructureNodes(nodes: InfrastructureNode[]) {
  return nodes.map((node) => {
    const rawType = String(node.data.type);
    const type = legacyTypeMap[rawType] ??
      (infrastructureTypes.includes(rawType as InfrastructureType)
        ? (rawType as InfrastructureType)
        : "service");
    const base = defaultConfig(type);
    const rawConfig = node.data.config as Partial<InfrastructureConfig>;
    const replicas = rawConfig.replicas ?? base.replicas;
    return {
      ...node,
      connectable: infrastructureCatalog[type].connectable,
      style:
        type === "group"
          ? { width: 620, height: 360, ...node.style }
          : node.style,
      data: {
        ...node.data,
        type,
        config: {
          ...base,
          ...rawConfig,
          envVars: { ...base.envVars, ...(rawConfig.envVars ?? {}) },
          customProperties: {
            ...base.customProperties,
            ...(rawConfig.customProperties ?? {}),
          },
          inputPorts: [...(rawConfig.inputPorts ?? base.inputPorts)],
          outputPorts: [...(rawConfig.outputPorts ?? base.outputPorts)],
        },
        monthlyCost: monthlyCostFor(type, replicas),
        collapsed: node.data.collapsed ?? false,
        groupSize:
          type === "group"
            ? (node.data.groupSize ?? { width: 620, height: 360 })
            : node.data.groupSize,
      },
    } satisfies InfrastructureNode;
  }).sort((a, b) => {
    if (a.data.type === "group" && b.data.type !== "group") return -1;
    if (a.data.type !== "group" && b.data.type === "group") return 1;
    return 0;
  });
}

export const initialNodes: InfrastructureNode[] = [
  {
    id: "api-gateway-1",
    type: "infrastructure",
    position: { x: 80, y: 220 },
    data: {
      label: "Global Gateway",
      type: "api-gateway",
      config: defaultConfig("api-gateway"),
      monthlyCost: 18,
      status: "healthy",
    },
  },
  {
    id: "service-2",
    type: "infrastructure",
    position: { x: 380, y: 110 },
    data: {
      label: "API Primary",
      type: "service",
      config: defaultConfig("service"),
      monthlyCost: 42,
      status: "healthy",
    },
  },
  {
    id: "service-3",
    type: "infrastructure",
    position: { x: 380, y: 340 },
    data: {
      label: "API Replica",
      type: "service",
      config: defaultConfig("service", { region: "sin-1" }),
      monthlyCost: 42,
      status: "healthy",
    },
  },
  {
    id: "database-4",
    type: "infrastructure",
    position: { x: 720, y: 150 },
    data: {
      label: "Production DB",
      type: "database",
      config: defaultConfig("database", {
        envVars: { POOL_SIZE: "20", BACKUPS: "daily" },
      }),
      monthlyCost: 76,
      status: "healthy",
    },
  },
  {
    id: "storage-5",
    type: "infrastructure",
    position: { x: 720, y: 380 },
    data: {
      label: "Asset Bucket",
      type: "storage",
      config: defaultConfig("storage"),
      monthlyCost: 12,
      status: "healthy",
    },
  },
];

export const initialEdges: Edge[] = [
  {
    id: "edge-1-2",
    source: "api-gateway-1",
    target: "service-2",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "edge-1-3",
    source: "api-gateway-1",
    target: "service-3",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "edge-2-4",
    source: "service-2",
    target: "database-4",
    type: "smoothstep",
  },
  {
    id: "edge-3-4",
    source: "service-3",
    target: "database-4",
    type: "smoothstep",
  },
  {
    id: "edge-2-5",
    source: "service-2",
    target: "storage-5",
    type: "smoothstep",
  },
];
