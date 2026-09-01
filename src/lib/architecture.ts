import type { Edge } from "@xyflow/react";
import type { InfrastructureNode, InfrastructureType } from "@/lib/infrastructure";

export type ArchitectureConstraint = {
  maxMonthlyCost?: number;
  requiredRegions?: string[];
  minimumReplicas?: number;
};

export type ArchitectureFinding = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  nodeIds: string[];
};

export type ArchitectureValidation = {
  status: "healthy" | "warning" | "critical";
  resilienceScore: number;
  estimatedMonthlyCostUsdc: number;
  budgetHeadroomUsdc: number | null;
  findings: ArchitectureFinding[];
  disconnectedNodeIds: string[];
  regions: string[];
};

export function calculateMonthlyTotal(nodes: InfrastructureNode[]) {
  return nodes.reduce((sum, node) => sum + node.data.monthlyCost, 0);
}

export function cloneGraph(
  nodes: InfrastructureNode[],
  edges: Edge[],
): { nodes: InfrastructureNode[]; edges: Edge[] } {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: {
        ...node.data,
        config: {
          ...node.data.config,
          envVars: { ...node.data.config.envVars },
        },
      },
    })),
    edges: edges.map((edge) => ({
      ...edge,
      data: edge.data ? { ...edge.data } : edge.data,
      style: edge.style ? { ...edge.style } : edge.style,
    })),
  };
}

export function architectureHash(nodes: InfrastructureNode[], edges: Edge[]) {
  const canonical = JSON.stringify({
    nodes: nodes
      .map((node) => ({
        id: node.id,
        type: node.data.type,
        label: node.data.label,
        config: node.data.config,
        monthlyCost: node.data.monthlyCost,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        type: edge.label ?? "data",
      }))
      .sort((a, b) =>
        `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`),
      ),
  });

  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `cops-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function validateArchitecture(
  nodes: InfrastructureNode[],
  edges: Edge[],
  constraints: ArchitectureConstraint = {},
): ArchitectureValidation {
  const findings: ArchitectureFinding[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const total = calculateMonthlyTotal(nodes);
  const disconnected = nodes
    .filter(
      (node) =>
        !edges.some(
          (edge) => edge.source === node.id || edge.target === node.id,
        ),
    )
    .map((node) => node.id);

  if (disconnected.length > 0) {
    findings.push({
      id: "disconnected-nodes",
      severity: "critical",
      title: "Disconnected resources",
      detail: `${disconnected.length} resource${disconnected.length === 1 ? " is" : "s are"} outside every traffic path.`,
      nodeIds: disconnected,
    });
  }

  const invalidEdges = edges.filter(
    (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target),
  );
  if (invalidEdges.length > 0) {
    findings.push({
      id: "invalid-edges",
      severity: "critical",
      title: "Invalid dependencies",
      detail: `${invalidEdges.length} connection${invalidEdges.length === 1 ? " references" : "s reference"} a missing resource.`,
      nodeIds: [],
    });
  }

  if (
    constraints.maxMonthlyCost !== undefined &&
    total > constraints.maxMonthlyCost
  ) {
    findings.push({
      id: "budget-exceeded",
      severity: "critical",
      title: "Monthly budget exceeded",
      detail: `$${total} is $${total - constraints.maxMonthlyCost} above the $${constraints.maxMonthlyCost} limit.`,
      nodeIds: [],
    });
  }

  const minimumReplicas = constraints.minimumReplicas ?? 2;
  const apiRegions = new Map<string, InfrastructureNode[]>();
  for (const node of nodes.filter((item) => item.data.type === "api-service")) {
    const regionalApis = apiRegions.get(node.data.config.region) ?? [];
    regionalApis.push(node);
    apiRegions.set(node.data.config.region, regionalApis);
  }
  for (const [region, regionalApis] of apiRegions) {
    const regionalReplicas = regionalApis.reduce(
      (sum, node) => sum + node.data.config.replicas,
      0,
    );
    if (regionalReplicas < minimumReplicas) {
      findings.push({
        id: `api-replicas-${region}`,
        severity: "warning",
        title: `${region} API capacity has limited redundancy`,
        detail: `${regionalReplicas} total replica${regionalReplicas === 1 ? "" : "s"} configured; policy requires ${minimumReplicas}.`,
        nodeIds: regionalApis.map((node) => node.id),
      });
    }
  }

  for (const node of nodes.filter((item) => item.data.type === "database")) {
    if (node.data.config.replicas < minimumReplicas) {
      findings.push({
        id: `replicas-${node.id}`,
        severity: "warning",
        title: `${node.data.label} has limited redundancy`,
        detail: `${node.data.config.replicas} replica configured; policy requires ${minimumReplicas}.`,
        nodeIds: [node.id],
      });
    }
  }

  const regions = Array.from(
    new Set(
      nodes
        .map((node) => node.data.config.region)
        .filter((region) => region !== "global"),
    ),
  ).sort();
  const requiredRegions = constraints.requiredRegions ?? [];
  for (const region of requiredRegions) {
    const regionalNodes = nodes.filter(
      (node) => node.data.config.region === region,
    );
    const hasApi = regionalNodes.some(
      (node) => node.data.type === "api-service",
    );
    if (!hasApi) {
      findings.push({
        id: `missing-api-${region}`,
        severity: "critical",
        title: `No API capacity in ${region}`,
        detail: "Regional failover cannot serve requests without an API service.",
        nodeIds: [],
      });
    }
  }

  const dataTypes: InfrastructureType[] = ["database", "storage", "queue"];
  for (const type of dataTypes) {
    const resources = nodes.filter((node) => node.data.type === type);
    if (resources.length === 1 && resources[0].data.config.replicas < 2) {
      findings.push({
        id: `single-${type}`,
        severity: "warning",
        title: `Single ${type.replace("-", " ")}`,
        detail: "This service can become a single point of failure.",
        nodeIds: [resources[0].id],
      });
    }
  }

  if (!nodes.some((node) => node.data.config.region === "global")) {
    findings.push({
      id: "no-global-entry",
      severity: "warning",
      title: "No global entry point",
      detail: "Traffic has no global routing layer for regional failover.",
      nodeIds: [],
    });
  }

  const penalty = findings.reduce(
    (sum, finding) =>
      sum +
      (finding.severity === "critical"
        ? 25
        : finding.severity === "warning"
          ? 9
          : 2),
    0,
  );
  const resilienceScore = Math.max(0, 100 - penalty);
  const status = findings.some((finding) => finding.severity === "critical")
    ? "critical"
    : findings.some((finding) => finding.severity === "warning")
      ? "warning"
      : "healthy";

  return {
    status,
    resilienceScore,
    estimatedMonthlyCostUsdc: total,
    budgetHeadroomUsdc:
      constraints.maxMonthlyCost === undefined
        ? null
        : constraints.maxMonthlyCost - total,
    findings,
    disconnectedNodeIds: disconnected,
    regions,
  };
}

const layerOrder: Record<InfrastructureType, number> = {
  "edge-worker": 0,
  "api-service": 1,
  database: 2,
  storage: 2,
  queue: 2,
};

export function autoLayoutArchitecture(
  nodes: InfrastructureNode[],
  direction: "LR" | "TB",
  groupBy: "layer" | "region",
) {
  const sorted = [...nodes].sort((a, b) => {
    const primary =
      groupBy === "region"
        ? a.data.config.region.localeCompare(b.data.config.region)
        : layerOrder[a.data.type] - layerOrder[b.data.type];
    return primary || a.data.label.localeCompare(b.data.label);
  });
  const counters = new Map<string, number>();
  const regions = Array.from(
    new Set(sorted.map((node) => node.data.config.region)),
  ).sort((a, b) => (a === "global" ? -1 : b === "global" ? 1 : a.localeCompare(b)));

  return sorted.map((node) => {
    const layer = layerOrder[node.data.type];
    const regionIndex = Math.max(0, regions.indexOf(node.data.config.region));
    const key = groupBy === "region" ? node.data.config.region : String(layer);
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);

    const logicalX = groupBy === "region" ? regionIndex : layer;
    const logicalY = index;
    const x = 80 + logicalX * 340;
    const y = 100 + logicalY * 150;
    return {
      ...node,
      position: direction === "LR" ? { x, y } : { x: y, y: x },
    };
  });
}
