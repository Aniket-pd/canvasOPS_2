import type { Edge, Node } from "@xyflow/react";

export const infrastructureTypes = [
  "edge-worker",
  "api-service",
  "database",
  "storage",
  "queue",
] as const;

export type InfrastructureType = (typeof infrastructureTypes)[number];

export type InfrastructureConfig = {
  region: string;
  size: string;
  replicas: number;
  envVars: Record<string, string>;
};

export type InfrastructureNodeData = {
  label: string;
  type: InfrastructureType;
  config: InfrastructureConfig;
  monthlyCost: number;
  status: "healthy" | "draft" | "warning";
};

export type InfrastructureNode = Node<InfrastructureNodeData, "infrastructure">;

export const infrastructureCatalog: Record<
  InfrastructureType,
  { label: string; description: string; cost: number; accent: string }
> = {
  "edge-worker": {
    label: "Edge Worker",
    description: "Global request routing",
    cost: 18,
    accent: "#b8f34a",
  },
  "api-service": {
    label: "API Service",
    description: "Autoscaling compute",
    cost: 42,
    accent: "#67e8f9",
  },
  database: {
    label: "Postgres",
    description: "Managed relational data",
    cost: 76,
    accent: "#a78bfa",
  },
  storage: {
    label: "Object Storage",
    description: "Durable asset storage",
    cost: 12,
    accent: "#fb923c",
  },
  queue: {
    label: "Event Queue",
    description: "Async message delivery",
    cost: 24,
    accent: "#f472b6",
  },
};

export const defaultConfig = (
  type: InfrastructureType,
  overrides: Partial<InfrastructureConfig> = {},
): InfrastructureConfig => ({
  region: "bom-1",
  size: type === "database" ? "db-standard-2" : "standard-1",
  replicas: type === "database" ? 2 : 1,
  envVars: {},
  ...overrides,
});

export function monthlyCostFor(type: InfrastructureType, replicas: number) {
  const includedReplicas = defaultConfig(type).replicas;
  return Math.round(
    infrastructureCatalog[type].cost * Math.max(1, replicas / includedReplicas),
  );
}

export const initialNodes: InfrastructureNode[] = [
  {
    id: "edge-worker-1",
    type: "infrastructure",
    position: { x: 80, y: 220 },
    data: {
      label: "Global Gateway",
      type: "edge-worker",
      config: defaultConfig("edge-worker", { region: "global" }),
      monthlyCost: 18,
      status: "healthy",
    },
  },
  {
    id: "api-service-2",
    type: "infrastructure",
    position: { x: 380, y: 110 },
    data: {
      label: "API Primary",
      type: "api-service",
      config: defaultConfig("api-service"),
      monthlyCost: 42,
      status: "healthy",
    },
  },
  {
    id: "api-service-3",
    type: "infrastructure",
    position: { x: 380, y: 340 },
    data: {
      label: "API Replica",
      type: "api-service",
      config: defaultConfig("api-service", { region: "sin-1" }),
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
    source: "edge-worker-1",
    target: "api-service-2",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "edge-1-3",
    source: "edge-worker-1",
    target: "api-service-3",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "edge-2-4",
    source: "api-service-2",
    target: "database-4",
    type: "smoothstep",
  },
  {
    id: "edge-3-4",
    source: "api-service-3",
    target: "database-4",
    type: "smoothstep",
  },
  {
    id: "edge-2-5",
    source: "api-service-2",
    target: "storage-5",
    type: "smoothstep",
  },
];
