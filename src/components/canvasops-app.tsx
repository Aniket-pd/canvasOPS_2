"use client";

import "@mcp-b/global";

import {
  addEdge,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useWebMCP } from "@mcp-b/react-webmcp";
import {
  Activity,
  AlertTriangle,
  Box,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Cloud,
  Copy,
  Database,
  GripVertical,
  HardDrive,
  History,
  Layers3,
  LayoutDashboard,
  RadioTower,
  RotateCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { InfrastructureNodeCard } from "@/components/infrastructure-node";
import { PaymentDialog } from "@/components/payment-dialog";
import {
  type ArchitectureProposal,
  ProposalDialog,
} from "@/components/proposal-dialog";
import { Button } from "@/components/ui/button";
import {
  architectureHash,
  autoLayoutArchitecture,
  calculateMonthlyTotal,
  cloneGraph,
  validateArchitecture,
} from "@/lib/architecture";
import {
  defaultConfig,
  infrastructureCatalog,
  infrastructureTypes,
  initialEdges,
  initialNodes,
  monthlyCostFor,
  type InfrastructureConfig,
  type InfrastructureNode,
  type InfrastructureType,
} from "@/lib/infrastructure";
import { simulateX402Settlement } from "@/lib/x402-mock";

const nodeTypes = { infrastructure: InfrastructureNodeCard };
const STORAGE_KEY = "canvasops.graph.v2";

const configSchema = z
  .object({
    region: z.string().min(2).max(32).optional(),
    size: z.string().min(2).max(40).optional(),
    replicas: z.number().int().min(1).max(12).optional(),
    env_vars: z.record(z.string().min(1).max(64), z.string().max(500)).optional(),
    label: z.string().min(1).max(64).optional(),
  })
  .strict();

const analyzeArchitectureSchema = z.object({}).strict();
const addInfrastructureNodeSchema = z
  .object({
    type: z.enum(infrastructureTypes),
    x: z.number().min(-5000).max(5000),
    y: z.number().min(-5000).max(5000),
    config: configSchema.optional(),
  })
  .strict();
const connectNodesSchema = z
  .object({
    source_id: z.string().min(1).max(128),
    target_id: z.string().min(1).max(128),
    connection_type: z.enum(["data", "request", "event", "replication"]),
  })
  .strict();
const disconnectNodesSchema = z
  .object({
    source_id: z.string().min(1).max(128),
    target_id: z.string().min(1).max(128),
  })
  .strict();
const moveNodeSchema = z
  .object({
    node_id: z.string().min(1).max(128),
    x: z.number().min(-5000).max(5000),
    y: z.number().min(-5000).max(5000),
  })
  .strict();
const removeNodeSchema = z
  .object({ node_id: z.string().min(1).max(128) })
  .strict();
const updateNodeConfigSchema = z
  .object({
    node_id: z.string().min(1).max(128),
    region: z.string().min(2).max(32).optional(),
    size: z.string().min(2).max(40).optional(),
    replicas: z.number().int().min(1).max(12).optional(),
    env_vars: z.record(z.string().min(1).max(64), z.string().max(500)).optional(),
    label: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    ({ region, size, replicas, env_vars, label }) =>
      region !== undefined ||
      size !== undefined ||
      replicas !== undefined ||
      env_vars !== undefined ||
      label !== undefined,
    { message: "Provide at least one configuration field." },
  );
const autoLayoutSchema = z
  .object({
    direction: z.enum(["LR", "TB"]).default("LR"),
    group_by: z.enum(["layer", "region"]).default("layer"),
  })
  .strict();
const validateArchitectureSchema = z
  .object({
    max_monthly_cost_usdc: z.number().positive().max(100_000).optional(),
    required_regions: z.array(z.string().min(2).max(32)).max(8).optional(),
    minimum_replicas: z.number().int().min(1).max(12).optional(),
  })
  .strict();
const simulateOutageSchema = z
  .object({
    region: z.string().min(2).max(32),
    mode: z.enum(["start", "recover"]).default("start"),
  })
  .strict();
const undoSchema = z.object({}).strict();
const provisionAndPaySchema = z
  .object({
    total_cost_usdc: z.number().positive().max(100_000),
    architecture_hash: z.string().min(8).max(64).optional(),
  })
  .strict();

const planOperationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add_node"),
      ref: z.string().min(1).max(64),
      type: z.enum(infrastructureTypes),
      x: z.number().min(-5000).max(5000),
      y: z.number().min(-5000).max(5000),
      config: configSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("move_node"),
      node_id: z.string().min(1).max(128),
      x: z.number().min(-5000).max(5000),
      y: z.number().min(-5000).max(5000),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove_node"),
      node_id: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("connect_nodes"),
      source_ref: z.string().min(1).max(128),
      target_ref: z.string().min(1).max(128),
      connection_type: z.enum(["data", "request", "event", "replication"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("disconnect_nodes"),
      source_id: z.string().min(1).max(128),
      target_id: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_node"),
      node_id: z.string().min(1).max(128),
      config: configSchema,
    })
    .strict(),
]);
const proposeArchitecturePlanSchema = z
  .object({
    summary: z.string().min(8).max(240),
    max_monthly_cost_usdc: z.number().positive().max(100_000).optional(),
    operations: z.array(planOperationSchema).min(1).max(24),
  })
  .strict();

type ToolEvent = {
  id: number;
  tool: string;
  summary: string;
  input: string;
  time: string;
  status: "success" | "cancelled" | "pending";
};

type GraphHistoryEntry = {
  id: number;
  label: string;
  before: ReturnType<typeof cloneGraph>;
  after: ReturnType<typeof cloneGraph>;
};

type LegacyInteractionClient = {
  requestUserInteraction?<T>(callback: () => Promise<T>): Promise<T>;
};

type LegacyModelContext = {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean };
      execute: (
        input: unknown,
        interactionClient?: LegacyInteractionClient,
      ) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ): Promise<unknown>;
};

type PaymentReceipt = Awaited<ReturnType<typeof simulateX402Settlement>>;
type PlanInput = z.infer<typeof proposeArchitecturePlanSchema>;

const paletteIcons: Record<
  InfrastructureType,
  React.ComponentType<{ className?: string }>
> = {
  "edge-worker": RadioTower,
  "api-service": ServerCog,
  database: Database,
  storage: HardDrive,
  queue: Workflow,
};

const browserPrompts = [
  "Validate this architecture for Mumbai and Singapore, with at least 2 replicas and a $300 monthly budget.",
  "Propose a safe plan to make this architecture highly available under $300. Ask me to approve before applying it.",
  "Simulate a Mumbai outage, explain the affected paths, then recover the region. Do not deploy.",
];

const registeredToolNames = [
  "analyze_current_architecture",
  "validate_architecture",
  "propose_architecture_plan",
  "add_infrastructure_node",
  "move_node",
  "remove_node",
  "connect_nodes",
  "disconnect_nodes",
  "update_node_config",
  "auto_layout_architecture",
  "simulate_region_outage",
  "undo_last_change",
  "redo_last_change",
  "provision_and_pay",
];

function nowLabel() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function nextNodeId(nodes: InfrastructureNode[]) {
  return (
    nodes.reduce((highest, node) => {
      const match = node.id.match(/-(\d+)$/);
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1
  );
}

export function CanvasOpsApp() {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<InfrastructureNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [flow, setFlow] =
    useState<ReactFlowInstance<InfrastructureNode, Edge> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<"agent" | "config">("agent");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [history, setHistory] = useState<GraphHistoryEntry[]>([]);
  const [redoEntries, setRedoEntries] = useState<GraphHistoryEntry[]>([]);
  const [activeOutage, setActiveOutage] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ArchitectureProposal | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    "review" | "signing" | "settled"
  >("review");
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [paymentHash, setPaymentHash] = useState("");
  const [paymentReceipt, setPaymentReceipt] =
    useState<PaymentReceipt | null>(null);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const historyRef = useRef(history);
  const redoRef = useRef(redoEntries);
  const nextIdRef = useRef(nextNodeId(initialNodes));
  const historyIdRef = useRef(1);
  const toolEventIdRef = useRef(1);
  const hydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const dragStartRef = useRef<ReturnType<typeof cloneGraph> | null>(null);
  const paymentResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const proposalResolverRef = useRef<((approved: boolean) => void) | null>(null);

  const applyGraph = useCallback(
    (nextNodes: InfrastructureNode[], nextEdges: Edge[]) => {
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
    },
    [setEdges, setNodes],
  );

  const pushHistory = useCallback((entry: GraphHistoryEntry) => {
    const next = [...historyRef.current, entry].slice(-30);
    historyRef.current = next;
    setHistory(next);
    redoRef.current = [];
    setRedoEntries([]);
  }, []);

  const commitGraph = useCallback(
    (label: string, nextNodes: InfrastructureNode[], nextEdges: Edge[]) => {
      const before = cloneGraph(nodesRef.current, edgesRef.current);
      const after = cloneGraph(nextNodes, nextEdges);
      pushHistory({ id: historyIdRef.current++, label, before, after });
      applyGraph(after.nodes, after.edges);
    },
    [applyGraph, pushHistory],
  );

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [edges, nodes]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          nodes: InfrastructureNode[];
          edges: Edge[];
        };
        if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          applyGraph(parsed.nodes, parsed.edges);
          nextIdRef.current = nextNodeId(parsed.nodes);
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      hydratedRef.current = true;
    }
  }, [applyGraph]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
  }, [edges, nodes]);

  const logToolEvent = useCallback(
    (
      tool: string,
      summary: string,
      input: unknown,
      status: ToolEvent["status"] = "success",
    ) => {
      setToolEvents((entries) =>
        [
          {
            id: toolEventIdRef.current++,
            tool,
            summary,
            input: JSON.stringify(input),
            time: nowLabel(),
            status,
          },
          ...entries,
        ].slice(0, 30),
      );
    },
    [],
  );

  const copyPrompt = useCallback(async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      window.setTimeout(() => setCopiedPrompt(null), 1600);
    } catch {
      setCopiedPrompt(null);
    }
  }, []);

  const createNode = useCallback(
    (
      input: z.infer<typeof addInfrastructureNodeSchema>,
      id = `${input.type}-${nextIdRef.current++}`,
    ) => {
      const catalog = infrastructureCatalog[input.type];
      const baseConfig = defaultConfig(input.type);
      const replicas = input.config?.replicas ?? baseConfig.replicas;
      return {
        id,
        type: "infrastructure" as const,
        position: { x: input.x, y: input.y },
        data: {
          type: input.type,
          label: input.config?.label ?? catalog.label,
          config: {
            region: input.config?.region ?? baseConfig.region,
            size: input.config?.size ?? baseConfig.size,
            replicas,
            envVars: input.config?.env_vars ?? baseConfig.envVars,
          },
          monthlyCost: monthlyCostFor(input.type, replicas),
          status: "healthy" as const,
        },
      } satisfies InfrastructureNode;
    },
    [],
  );

  const addInfrastructureNode = useCallback(
    (input: z.infer<typeof addInfrastructureNodeSchema>) => {
      const node = createNode(input);
      commitGraph(
        `Added ${node.data.label}`,
        [...nodesRef.current, node],
        edgesRef.current,
      );
      return {
        success: true,
        node_id: node.id,
        label: node.data.label,
        position: node.position,
        monthly_cost_usdc: node.data.monthlyCost,
      };
    },
    [commitGraph, createNode],
  );

  const connectInfrastructureNodes = useCallback(
    (input: z.infer<typeof connectNodesSchema>) => {
      const sourceExists = nodesRef.current.some(
        (node) => node.id === input.source_id,
      );
      const targetExists = nodesRef.current.some(
        (node) => node.id === input.target_id,
      );
      if (!sourceExists || !targetExists) {
        throw new Error(
          `Cannot connect nodes: ${!sourceExists ? input.source_id : input.target_id} does not exist.`,
        );
      }
      const duplicate = edgesRef.current.some(
        (edge) =>
          edge.source === input.source_id && edge.target === input.target_id,
      );
      if (duplicate) return { success: true, already_connected: true };

      const edge: Edge = {
        id: `edge-${input.source_id}-${input.target_id}`,
        source: input.source_id,
        target: input.target_id,
        type: "smoothstep",
        animated:
          input.connection_type === "event" ||
          input.connection_type === "request",
        label: input.connection_type,
      };
      commitGraph(
        `Connected ${input.source_id} to ${input.target_id}`,
        nodesRef.current,
        [...edgesRef.current, edge],
      );
      return {
        success: true,
        edge_id: edge.id,
        connection_type: input.connection_type,
      };
    },
    [commitGraph],
  );

  const disconnectInfrastructureNodes = useCallback(
    (input: z.infer<typeof disconnectNodesSchema>) => {
      const nextEdges = edgesRef.current.filter(
        (edge) =>
          !(edge.source === input.source_id && edge.target === input.target_id),
      );
      if (nextEdges.length === edgesRef.current.length) {
        throw new Error("The requested connection does not exist.");
      }
      commitGraph(
        `Disconnected ${input.source_id} from ${input.target_id}`,
        nodesRef.current,
        nextEdges,
      );
      return { success: true, removed_edges: 1 };
    },
    [commitGraph],
  );

  const moveInfrastructureNode = useCallback(
    (input: z.infer<typeof moveNodeSchema>) => {
      if (!nodesRef.current.some((node) => node.id === input.node_id)) {
        throw new Error(`Node ${input.node_id} does not exist.`);
      }
      const nextNodes = nodesRef.current.map((node) =>
        node.id === input.node_id
          ? { ...node, position: { x: input.x, y: input.y } }
          : node,
      );
      commitGraph(`Moved ${input.node_id}`, nextNodes, edgesRef.current);
      return {
        success: true,
        node_id: input.node_id,
        position: { x: input.x, y: input.y },
      };
    },
    [commitGraph],
  );

  const removeInfrastructureNode = useCallback(
    (input: z.infer<typeof removeNodeSchema>) => {
      const target = nodesRef.current.find((node) => node.id === input.node_id);
      if (!target) throw new Error(`Node ${input.node_id} does not exist.`);
      const nextNodes = nodesRef.current.filter(
        (node) => node.id !== input.node_id,
      );
      const nextEdges = edgesRef.current.filter(
        (edge) =>
          edge.source !== input.node_id && edge.target !== input.node_id,
      );
      const removedEdges = edgesRef.current.length - nextEdges.length;
      commitGraph(`Removed ${target.data.label}`, nextNodes, nextEdges);
      return {
        success: true,
        removed_node_id: input.node_id,
        removed_edges: removedEdges,
        monthly_savings_usdc: target.data.monthlyCost,
      };
    },
    [commitGraph],
  );

  const updateInfrastructureNode = useCallback(
    (input: z.infer<typeof updateNodeConfigSchema>) => {
      const target = nodesRef.current.find((node) => node.id === input.node_id);
      if (!target) throw new Error(`Node ${input.node_id} does not exist.`);
      const nextNodes = nodesRef.current.map((node) => {
        if (node.id !== input.node_id) return node;
        const replicas = input.replicas ?? node.data.config.replicas;
        return {
          ...node,
          data: {
            ...node.data,
            label: input.label ?? node.data.label,
            monthlyCost: monthlyCostFor(node.data.type, replicas),
            config: {
              ...node.data.config,
              region: input.region ?? node.data.config.region,
              size: input.size ?? node.data.config.size,
              replicas,
              envVars: input.env_vars
                ? { ...node.data.config.envVars, ...input.env_vars }
                : node.data.config.envVars,
            },
          },
        };
      });
      commitGraph(`Updated ${target.data.label}`, nextNodes, edgesRef.current);
      return {
        success: true,
        node_id: input.node_id,
        updated_fields: Object.keys(input).filter((key) => key !== "node_id"),
        monthly_cost_usdc:
          nextNodes.find((node) => node.id === input.node_id)?.data.monthlyCost ??
          0,
      };
    },
    [commitGraph],
  );

  const analyzeArchitecture = useCallback(() => {
    const validation = validateArchitecture(
      nodesRef.current,
      edgesRef.current,
    );
    return {
      node_count: nodesRef.current.length,
      edge_count: edgesRef.current.length,
      estimated_monthly_cost_usdc: validation.estimatedMonthlyCostUsdc,
      architecture_hash: architectureHash(nodesRef.current, edgesRef.current),
      resilience_score: validation.resilienceScore,
      disconnected_node_ids: validation.disconnectedNodeIds,
      nodes: nodesRef.current.map((node) => ({
        id: node.id,
        type: node.data.type,
        label: node.data.label,
        position: node.position,
        config: node.data.config,
        status: node.data.status,
        monthly_cost_usdc: node.data.monthlyCost,
      })),
      edges: edgesRef.current.map((edge) => ({
        id: edge.id,
        source_id: edge.source,
        target_id: edge.target,
        connection_type: edge.label ?? "data",
      })),
    };
  }, []);

  const undoLastChange = useCallback(() => {
    const latest = historyRef.current.at(-1);
    if (!latest) return { success: false, status: "nothing_to_undo" };
    const nextHistory = historyRef.current.slice(0, -1);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    const nextRedo = [...redoRef.current, latest].slice(-30);
    redoRef.current = nextRedo;
    setRedoEntries(nextRedo);
    applyGraph(latest.before.nodes, latest.before.edges);
    return { success: true, reverted: latest.label };
  }, [applyGraph]);

  const redoLastChange = useCallback(() => {
    const latest = redoRef.current.at(-1);
    if (!latest) return { success: false, status: "nothing_to_redo" };
    const nextRedo = redoRef.current.slice(0, -1);
    redoRef.current = nextRedo;
    setRedoEntries(nextRedo);
    const nextHistory = [...historyRef.current, latest].slice(-30);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    applyGraph(latest.after.nodes, latest.after.edges);
    return { success: true, replayed: latest.label };
  }, [applyGraph]);

  const runAutoLayout = useCallback(
    (input: z.infer<typeof autoLayoutSchema>) => {
      const nextNodes = autoLayoutArchitecture(
        nodesRef.current,
        input.direction,
        input.group_by,
      );
      commitGraph(
        `Auto-layout by ${input.group_by}`,
        nextNodes,
        edgesRef.current,
      );
      window.setTimeout(() => void flow?.fitView({ padding: 0.2, duration: 500 }), 40);
      return {
        success: true,
        direction: input.direction,
        group_by: input.group_by,
        positioned_node_ids: nextNodes.map((node) => node.id),
      };
    },
    [commitGraph, flow],
  );

  const simulateOutage = useCallback(
    (input: z.infer<typeof simulateOutageSchema>) => {
      const recovering = input.mode === "recover";
      const affectedIds = nodesRef.current
        .filter((node) => node.data.config.region === input.region)
        .map((node) => node.id);
      if (!recovering && affectedIds.length === 0) {
        throw new Error(`No resources are deployed in ${input.region}.`);
      }
      const affectedSet = new Set(affectedIds);
      const nextNodes = nodesRef.current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          status: recovering
            ? ("healthy" as const)
            : affectedSet.has(node.id)
              ? ("warning" as const)
              : node.data.status,
        },
      }));
      const nextEdges = edgesRef.current.map((edge) => {
        const affected =
          affectedSet.has(edge.source) || affectedSet.has(edge.target);
        return {
          ...edge,
          animated: recovering
            ? edge.label === "request" || edge.label === "event"
            : affected
              ? false
              : edge.animated,
          style: recovering
            ? undefined
            : affected
              ? { stroke: "#f87171", strokeWidth: 2 }
              : edge.style,
        };
      });
      commitGraph(
        recovering ? `Recovered ${input.region}` : `Simulated ${input.region} outage`,
        nextNodes,
        nextEdges,
      );
      setActiveOutage(recovering ? null : input.region);
      return {
        success: true,
        mode: input.mode,
        region: input.region,
        affected_node_ids: affectedIds,
        affected_connection_count: edgesRef.current.filter(
          (edge) => affectedSet.has(edge.source) || affectedSet.has(edge.target),
        ).length,
      };
    },
    [commitGraph],
  );

  const previewPlan = useCallback(
    (input: PlanInput) => {
      const graph = cloneGraph(nodesRef.current, edgesRef.current);
      let simulatedNodes = graph.nodes;
      let simulatedEdges = graph.edges;
      let simulatedId = nextIdRef.current;
      const aliases = new Map<string, string>();
      const changes: string[] = [];
      const resolveRef = (reference: string) => aliases.get(reference) ?? reference;

      for (const operation of input.operations) {
        if (operation.action === "add_node") {
          if (aliases.has(operation.ref)) {
            throw new Error(`Duplicate plan ref: ${operation.ref}.`);
          }
          const id = `${operation.type}-${simulatedId++}`;
          aliases.set(operation.ref, id);
          const node = createNode(
            {
              type: operation.type,
              x: operation.x,
              y: operation.y,
              config: operation.config,
            },
            id,
          );
          simulatedNodes = [...simulatedNodes, node];
          changes.push(`Add ${node.data.label} in ${node.data.config.region}`);
        } else if (operation.action === "move_node") {
          if (!simulatedNodes.some((node) => node.id === operation.node_id)) {
            throw new Error(`Node ${operation.node_id} does not exist.`);
          }
          simulatedNodes = simulatedNodes.map((node) =>
            node.id === operation.node_id
              ? { ...node, position: { x: operation.x, y: operation.y } }
              : node,
          );
          changes.push(`Move ${operation.node_id} to a clear position`);
        } else if (operation.action === "remove_node") {
          if (!simulatedNodes.some((node) => node.id === operation.node_id)) {
            throw new Error(`Node ${operation.node_id} does not exist.`);
          }
          simulatedNodes = simulatedNodes.filter(
            (node) => node.id !== operation.node_id,
          );
          simulatedEdges = simulatedEdges.filter(
            (edge) =>
              edge.source !== operation.node_id &&
              edge.target !== operation.node_id,
          );
          changes.push(`Remove ${operation.node_id} and its dependencies`);
        } else if (operation.action === "connect_nodes") {
          const source = resolveRef(operation.source_ref);
          const target = resolveRef(operation.target_ref);
          if (
            !simulatedNodes.some((node) => node.id === source) ||
            !simulatedNodes.some((node) => node.id === target)
          ) {
            throw new Error("Plan connection references an unknown node.");
          }
          if (
            !simulatedEdges.some(
              (edge) => edge.source === source && edge.target === target,
            )
          ) {
            simulatedEdges = [
              ...simulatedEdges,
              {
                id: `edge-${source}-${target}`,
                source,
                target,
                type: "smoothstep",
                animated:
                  operation.connection_type === "request" ||
                  operation.connection_type === "event",
                label: operation.connection_type,
              },
            ];
          }
          changes.push(`Connect ${source} → ${target} as ${operation.connection_type}`);
        } else if (operation.action === "disconnect_nodes") {
          simulatedEdges = simulatedEdges.filter(
            (edge) =>
              !(
                edge.source === operation.source_id &&
                edge.target === operation.target_id
              ),
          );
          changes.push(`Disconnect ${operation.source_id} → ${operation.target_id}`);
        } else {
          const target = simulatedNodes.find(
            (node) => node.id === operation.node_id,
          );
          if (!target) throw new Error(`Node ${operation.node_id} does not exist.`);
          simulatedNodes = simulatedNodes.map((node) => {
            if (node.id !== operation.node_id) return node;
            const replicas =
              operation.config.replicas ?? node.data.config.replicas;
            return {
              ...node,
              data: {
                ...node.data,
                label: operation.config.label ?? node.data.label,
                monthlyCost: monthlyCostFor(node.data.type, replicas),
                config: {
                  ...node.data.config,
                  region: operation.config.region ?? node.data.config.region,
                  size: operation.config.size ?? node.data.config.size,
                  replicas,
                  envVars: operation.config.env_vars
                    ? {
                        ...node.data.config.envVars,
                        ...operation.config.env_vars,
                      }
                    : node.data.config.envVars,
                },
              },
            };
          });
          changes.push(`Update ${operation.node_id} configuration`);
        }
      }
      return {
        nextNodes: simulatedNodes,
        nextEdges: simulatedEdges,
        nextId: simulatedId,
        changes,
      };
    },
    [createNode],
  );

  const requestProposalConfirmation = useCallback(
    (nextProposal: ArchitectureProposal) => {
      setProposal(nextProposal);
      return new Promise<boolean>((resolve) => {
        proposalResolverRef.current = resolve;
      });
    },
    [],
  );

  const requestPaymentConfirmation = useCallback(
    (total: number, hash: string) => {
      setPaymentTotal(total);
      setPaymentHash(hash);
      setPaymentReceipt(null);
      setPaymentStatus("review");
      setPaymentOpen(true);
      return new Promise<boolean>((resolve) => {
        paymentResolverRef.current = resolve;
      });
    },
    [],
  );

  const provisionArchitecture = useCallback(
    async (
      input: z.infer<typeof provisionAndPaySchema>,
      interactionClient?: LegacyInteractionClient,
    ) => {
      const verifiedTotal = calculateMonthlyTotal(nodesRef.current);
      const verifiedHash = architectureHash(nodesRef.current, edgesRef.current);
      if (input.total_cost_usdc !== verifiedTotal) {
        throw new Error(
          `Payment total mismatch: live graph is $${verifiedTotal}, not $${input.total_cost_usdc}. Analyze again before deployment.`,
        );
      }
      if (
        input.architecture_hash !== undefined &&
        input.architecture_hash !== verifiedHash
      ) {
        throw new Error(`Architecture changed after analysis. Expected ${verifiedHash}.`);
      }
      const showConfirmation = () =>
        requestPaymentConfirmation(verifiedTotal, verifiedHash);
      let approved: boolean;
      if (interactionClient?.requestUserInteraction) {
        try {
          approved = await interactionClient.requestUserInteraction(
            showConfirmation,
          );
        } catch {
          approved = await showConfirmation();
        }
      } else {
        approved = await showConfirmation();
      }
      if (!approved) return { success: false, status: "cancelled_by_user" };

      setPaymentStatus("signing");
      const receipt = await simulateX402Settlement(verifiedTotal, verifiedHash);
      setPaymentReceipt(receipt);
      setPaymentStatus("settled");
      return {
        success: true,
        status: "mock_deployed",
        verified_total_usdc: verifiedTotal,
        architecture_hash: verifiedHash,
        receipt,
      };
    },
    [requestPaymentConfirmation],
  );

  const proposeArchitecturePlan = useCallback(
    async (parsed: PlanInput) => {
      const preview = previewPlan(parsed);
      const beforeCost = calculateMonthlyTotal(nodesRef.current);
      const afterCost = calculateMonthlyTotal(preview.nextNodes);
      const nextProposal: ArchitectureProposal = {
        summary: parsed.summary,
        changes: preview.changes,
        beforeCost,
        afterCost,
        maxMonthlyCost: parsed.max_monthly_cost_usdc,
        architectureHash: architectureHash(
          preview.nextNodes,
          preview.nextEdges,
        ),
      };
      logToolEvent(
        "propose_architecture_plan",
        `Plan ready: ${preview.changes.length} changes, $${beforeCost} → $${afterCost}.`,
        parsed,
        "pending",
      );
      const approved = await requestProposalConfirmation(nextProposal);
      if (!approved) {
        logToolEvent(
          "propose_architecture_plan",
          "Human rejected the proposed architecture plan.",
          parsed,
          "cancelled",
        );
        return { success: false, status: "rejected_by_user" };
      }
      commitGraph(parsed.summary, preview.nextNodes, preview.nextEdges);
      nextIdRef.current = preview.nextId;
      logToolEvent(
        "propose_architecture_plan",
        `Human approved and applied ${preview.changes.length} changes as one undoable transaction.`,
        parsed,
      );
      return {
        success: true,
        status: "applied",
        changes_applied: preview.changes.length,
        estimated_monthly_cost_usdc: afterCost,
        architecture_hash: nextProposal.architectureHash,
      };
    },
    [
      commitGraph,
      logToolEvent,
      previewPlan,
      requestProposalConfirmation,
    ],
  );

  useWebMCP(
    {
      name: "analyze_current_architecture",
      description:
        "Read the complete live graph, positions, configuration, connections, cost, resilience score, and architecture fingerprint. Call before modifying an unfamiliar architecture.",
      inputSchema: analyzeArchitectureSchema,
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const parsed = analyzeArchitectureSchema.parse(input);
        const result = analyzeArchitecture();
        logToolEvent(
          "analyze_current_architecture",
          `Analyzed ${result.node_count} nodes at $${result.estimated_monthly_cost_usdc}/month; resilience ${result.resilience_score}/100.`,
          parsed,
        );
        return result;
      },
    },
    [analyzeArchitecture, logToolEvent],
  );

  useWebMCP(
    {
      name: "validate_architecture",
      description:
        "Deterministically validate the live architecture against budget, region, replica, connectivity, and failover policies without changing it.",
      inputSchema: validateArchitectureSchema,
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const parsed = validateArchitectureSchema.parse(input);
        const result = validateArchitecture(nodesRef.current, edgesRef.current, {
          maxMonthlyCost: parsed.max_monthly_cost_usdc,
          requiredRegions: parsed.required_regions,
          minimumReplicas: parsed.minimum_replicas,
        });
        logToolEvent(
          "validate_architecture",
          `${result.status.toUpperCase()}: resilience ${result.resilienceScore}/100 with ${result.findings.length} finding(s).`,
          parsed,
        );
        return {
          status: result.status,
          resilience_score: result.resilienceScore,
          estimated_monthly_cost_usdc: result.estimatedMonthlyCostUsdc,
          budget_headroom_usdc: result.budgetHeadroomUsdc,
          disconnected_node_ids: result.disconnectedNodeIds,
          regions: result.regions,
          findings: result.findings.map((finding) => ({
            id: finding.id,
            severity: finding.severity,
            title: finding.title,
            detail: finding.detail,
            node_ids: finding.nodeIds,
          })),
        };
      },
    },
    [logToolEvent],
  );

  useWebMCP(
    {
      name: "add_infrastructure_node",
      description:
        "Add exactly one cloud component at deterministic coordinates. Analyze first to avoid overlap. For multi-step changes, prefer propose_architecture_plan.",
      inputSchema: addInfrastructureNodeSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = addInfrastructureNodeSchema.parse(input);
        const result = addInfrastructureNode(parsed);
        logToolEvent(
          "add_infrastructure_node",
          `Added ${result.label} at (${result.position.x}, ${result.position.y}).`,
          parsed,
        );
        return result;
      },
    },
    [addInfrastructureNode, logToolEvent],
  );

  useWebMCP(
    {
      name: "move_node",
      description: "Move one existing node to exact canvas coordinates.",
      inputSchema: moveNodeSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = moveNodeSchema.parse(input);
        const result = moveInfrastructureNode(parsed);
        logToolEvent(
          "move_node",
          `Moved ${parsed.node_id} to (${parsed.x}, ${parsed.y}).`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, moveInfrastructureNode],
  );

  useWebMCP(
    {
      name: "remove_node",
      description:
        "Remove one existing node and all attached edges. This mutation is undoable.",
      inputSchema: removeNodeSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = removeNodeSchema.parse(input);
        const result = removeInfrastructureNode(parsed);
        logToolEvent(
          "remove_node",
          `Removed ${parsed.node_id} and ${result.removed_edges} attached connection(s).`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, removeInfrastructureNode],
  );

  useWebMCP(
    {
      name: "connect_nodes",
      description:
        "Create a validated directional connection between two exact node IDs.",
      inputSchema: connectNodesSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = connectNodesSchema.parse(input);
        const result = connectInfrastructureNodes(parsed);
        logToolEvent(
          "connect_nodes",
          "already_connected" in result && result.already_connected
            ? `${parsed.source_id} and ${parsed.target_id} were already connected.`
            : `Connected ${parsed.source_id} → ${parsed.target_id} as ${parsed.connection_type}.`,
          parsed,
        );
        return result;
      },
    },
    [connectInfrastructureNodes, logToolEvent],
  );

  useWebMCP(
    {
      name: "disconnect_nodes",
      description: "Remove one exact directional connection between two nodes.",
      inputSchema: disconnectNodesSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = disconnectNodesSchema.parse(input);
        const result = disconnectInfrastructureNodes(parsed);
        logToolEvent(
          "disconnect_nodes",
          `Disconnected ${parsed.source_id} → ${parsed.target_id}.`,
          parsed,
        );
        return result;
      },
    },
    [disconnectInfrastructureNodes, logToolEvent],
  );

  useWebMCP(
    {
      name: "update_node_config",
      description:
        "Update a node label, region, instance size, replicas, and/or environment variables. Cost is recalculated from replicas.",
      inputSchema: updateNodeConfigSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = updateNodeConfigSchema.parse(input);
        const result = updateInfrastructureNode(parsed);
        logToolEvent(
          "update_node_config",
          `Updated ${parsed.node_id}: ${result.updated_fields.join(", ")}.`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, updateInfrastructureNode],
  );

  useWebMCP(
    {
      name: "auto_layout_architecture",
      description:
        "Arrange every live node into a deterministic layer- or region-based pattern and fit the canvas.",
      inputSchema: autoLayoutSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = autoLayoutSchema.parse(input);
        const result = runAutoLayout(parsed);
        logToolEvent(
          "auto_layout_architecture",
          `Arranged ${result.positioned_node_ids.length} nodes by ${parsed.group_by}.`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, runAutoLayout],
  );

  useWebMCP(
    {
      name: "simulate_region_outage",
      description:
        "Start or recover a regional outage. Affected nodes and traffic paths are highlighted without provisioning anything.",
      inputSchema: simulateOutageSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = simulateOutageSchema.parse(input);
        const result = simulateOutage(parsed);
        logToolEvent(
          "simulate_region_outage",
          parsed.mode === "start"
            ? `Simulated ${parsed.region} outage across ${result.affected_node_ids.length} resource(s).`
            : `Recovered ${parsed.region}.`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, simulateOutage],
  );

  useWebMCP(
    {
      name: "undo_last_change",
      description: "Revert the most recent canvas mutation as one atomic action.",
      inputSchema: undoSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = undoSchema.parse(input);
        const result = undoLastChange();
        logToolEvent(
          "undo_last_change",
          result.success ? `Reverted: ${result.reverted}.` : "Nothing to undo.",
          parsed,
          result.success ? "success" : "cancelled",
        );
        return result;
      },
    },
    [logToolEvent, undoLastChange],
  );

  useWebMCP(
    {
      name: "redo_last_change",
      description:
        "Replay the most recently undone human or agent mutation as one atomic action.",
      inputSchema: undoSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = undoSchema.parse(input);
        const result = redoLastChange();
        logToolEvent(
          "redo_last_change",
          result.success ? `Replayed: ${result.replayed}.` : "Nothing to replay.",
          parsed,
          result.success ? "success" : "cancelled",
        );
        return result;
      },
    },
    [logToolEvent, redoLastChange],
  );

  useWebMCP(
    {
      name: "propose_architecture_plan",
      description:
        "Preview a strict multi-operation architecture plan with a cost diff. The human must approve the in-page proposal before changes apply atomically.",
      inputSchema: proposeArchitecturePlanSchema,
      annotations: { readOnlyHint: false },
      execute: (input) =>
        proposeArchitecturePlan(proposeArchitecturePlanSchema.parse(input)),
    },
    [proposeArchitecturePlan],
  );

  useEffect(() => {
    const modelContext = document.modelContext as unknown as
      | LegacyModelContext
      | undefined;
    if (!modelContext) return;
    const controller = new AbortController();

    void modelContext.registerTool(
      {
        name: "provision_and_pay",
        title: "Provision architecture and authorize x402 payment",
        description:
          "Verify the supplied total and optional architecture hash against the live graph, request human approval, then mock-settle via x402.",
        inputSchema: z.toJSONSchema(provisionAndPaySchema) as Record<
          string,
          unknown
        >,
        annotations: { readOnlyHint: false },
        execute: async (input, interactionClient) => {
          const parsed = provisionAndPaySchema.parse(input);
          logToolEvent(
            "provision_and_pay",
            `Verifying a $${parsed.total_cost_usdc} deployment quote.`,
            parsed,
            "pending",
          );
          const result = await provisionArchitecture(parsed, interactionClient);
          logToolEvent(
            "provision_and_pay",
            result.success
              ? `Human approved settlement for ${result.architecture_hash}.`
              : "Human cancelled deployment; no settlement occurred.",
            parsed,
            result.success ? "success" : "cancelled",
          );
          return result;
        },
      },
      { signal: controller.signal },
    );

    return () => controller.abort();
  }, [
    logToolEvent,
    provisionArchitecture,
  ]);

  const monthlyTotal = useMemo(() => calculateMonthlyTotal(nodes), [nodes]);
  const liveHash = useMemo(() => architectureHash(nodes, edges), [edges, nodes]);
  const liveValidation = useMemo(
    () =>
      validateArchitecture(nodes, edges, {
        maxMonthlyCost: 300,
        requiredRegions: ["bom-1", "sin-1"],
        minimumReplicas: 2,
      }),
    [edges, nodes],
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const nextEdges = addEdge(
        {
          ...connection,
          id: `edge-${connection.source}-${connection.target}`,
          type: "smoothstep",
          label: "data",
        },
        edgesRef.current,
      );
      commitGraph(
        `Connected ${connection.source} to ${connection.target}`,
        nodesRef.current,
        nextEdges,
      );
    },
    [commitGraph],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<InfrastructureNode>[]) => {
      onNodesChange(changes);
      nodesRef.current = applyNodeChanges(changes, nodesRef.current);
    },
    [onNodesChange],
  );

  const handleNodeClick: NodeMouseHandler<InfrastructureNode> = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
      setRightPanel("config");
    },
    [],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(
        "application/canvasops-node",
      ) as InfrastructureType;
      if (!flow || !infrastructureTypes.includes(type)) return;
      const position = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addInfrastructureNode({ type, x: position.x, y: position.y });
    },
    [addInfrastructureNode, flow],
  );

  const updateSelectedConfig = useCallback(
    (patch: Partial<InfrastructureConfig>) => {
      if (!selectedNodeId) return;
      const target = nodesRef.current.find((node) => node.id === selectedNodeId);
      if (!target) return;
      const replicas = patch.replicas ?? target.data.config.replicas;
      const nextNodes = nodesRef.current.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                monthlyCost: monthlyCostFor(node.data.type, replicas),
                config: { ...node.data.config, ...patch, replicas },
              },
            }
          : node,
      );
      commitGraph(`Configured ${target.data.label}`, nextNodes, edgesRef.current);
    },
    [commitGraph, selectedNodeId],
  );

  const handlePaymentConfirm = () => {
    paymentResolverRef.current?.(true);
    paymentResolverRef.current = null;
  };
  const handlePaymentCancel = () => {
    paymentResolverRef.current?.(false);
    paymentResolverRef.current = null;
    setPaymentOpen(false);
  };
  const handleProposalApprove = () => {
    proposalResolverRef.current?.(true);
    proposalResolverRef.current = null;
    setProposal(null);
  };
  const handleProposalReject = () => {
    proposalResolverRef.current?.(false);
    proposalResolverRef.current = null;
    setProposal(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <Layers3 className="size-4" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">
            CanvasOps
          </span>
          <span className="hidden rounded-md border border-white/8 bg-white/[.035] px-2 py-1 text-[10px] font-medium text-zinc-500 sm:inline">
            PROTOTYPE
          </span>
        </div>
        <div className="hidden items-center gap-2 text-xs text-zinc-500 md:flex">
          <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_#bef264]" />
          WebMCP connected
          <span className="mx-2 h-4 w-px bg-white/8" />
          <span className="font-mono text-zinc-600">{liveHash}</span>
          <ChevronDown className="size-3" />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => undoLastChange()}
            disabled={history.length === 0}
          >
            <RotateCcw className="size-3.5" />
            Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => redoLastChange()}
            disabled={redoEntries.length === 0}
          >
            <History className="size-3.5" />
            Replay
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => runAutoLayout({ direction: "LR", group_by: "layer" })}
          >
            <LayoutDashboard className="size-3.5" />
            Arrange
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void provisionArchitecture({
                total_cost_usdc: monthlyTotal,
                architecture_hash: liveHash,
              })
            }
          >
            <Zap className="size-3.5 fill-current" />
            Deploy
          </Button>
        </div>
      </header>

      <section className="workspace">
        <aside className="palette-panel">
          <div className="panel-heading">
            <span>Infrastructure</span>
            <Box className="size-3.5 text-zinc-600" />
          </div>
          <div className="palette-list">
            {infrastructureTypes.map((type, index) => {
              const catalog = infrastructureCatalog[type];
              const Icon = paletteIcons[type];
              return (
                <button
                  key={type}
                  className="palette-item"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/canvasops-node", type);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() =>
                    addInfrastructureNode({
                      type,
                      x: 380 + (index % 2) * 320,
                      y: 110 + Math.floor(index / 2) * 160,
                    })
                  }
                >
                  <GripVertical className="size-3 text-zinc-700" />
                  <span className="palette-icon" style={{ color: catalog.accent }}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-xs font-medium text-zinc-300">
                      {catalog.label}
                    </span>
                    <span className="block truncate text-[9px] text-zinc-600">
                      ${catalog.cost}/mo
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="palette-safety">
            <div>
              <ShieldCheck className="size-3.5" />
              Resilience
            </div>
            <strong>{liveValidation.resilienceScore}/100</strong>
            <span data-status={liveValidation.status}>
              {liveValidation.status} · {liveValidation.findings.length} findings
            </span>
          </div>

          <div className="mt-auto border-t border-white/[.06] p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-600">
              <span>Estimated monthly</span>
              <CircleDollarSign className="size-3" />
            </div>
            <div className="text-lg font-semibold tracking-tight text-zinc-200">
              ${monthlyTotal}
              <span className="ml-1 text-[10px] font-normal text-zinc-600">
                USDC
              </span>
            </div>
          </div>
        </aside>

        <div
          className="canvas-wrap"
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
        >
          <div className="canvas-breadcrumb">
            <Cloud className="size-3.5 text-lime-300" />
            Production architecture
            <span className="text-zinc-700">/</span>
            <span className="text-zinc-600">{nodes.length} resources</span>
          </div>

          {activeOutage ? (
            <div className="outage-banner">
              <AlertTriangle className="size-3.5" />
              {activeOutage} outage active
              <button
                onClick={() =>
                  simulateOutage({ region: activeOutage, mode: "recover" })
                }
              >
                Recover region
              </button>
            </div>
          ) : null}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlow}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onNodeDragStart={() => {
              dragStartRef.current = cloneGraph(nodesRef.current, edgesRef.current);
            }}
            onNodeDragStop={(_event, node) => {
              const before = dragStartRef.current;
              if (!before) return;
              const nextNodes = nodesRef.current.map((item) =>
                item.id === node.id ? { ...item, position: { ...node.position } } : item,
              );
              const after = cloneGraph(nextNodes, edgesRef.current);
              pushHistory({
                id: historyIdRef.current++,
                label: `Moved ${node.data.label}`,
                before,
                after,
              });
              applyGraph(after.nodes, after.edges);
              dragStartRef.current = null;
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            fitViewOptions={{ padding: 0.23 }}
            minZoom={0.35}
            maxZoom={1.7}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "#41453d", strokeWidth: 1.5 },
            }}
            connectionLineStyle={{ stroke: "#bef264", strokeWidth: 1.5 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="#31342e"
            />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) =>
                infrastructureCatalog[
                  (node.data as unknown as { type: InfrastructureType }).type
                ]?.accent ?? "#666"
              }
              maskColor="rgba(8,9,8,.78)"
            />
          </ReactFlow>

          <div className="canvas-status">
            <span className="flex items-center gap-1.5">
              {liveValidation.status === "critical" ? (
                <AlertTriangle className="size-3 text-red-400" />
              ) : (
                <CheckCircle2 className="size-3 text-lime-300" />
              )}
              {liveValidation.status === "healthy"
                ? "Graph healthy"
                : `${liveValidation.findings.length} policy findings`}
            </span>
            <span>{edges.length} connections</span>
            <span>Local autosave on</span>
          </div>
        </div>

        <aside className="agent-panel">
          <div className="panel-tabs">
            <button
              className={rightPanel === "agent" ? "active" : ""}
              onClick={() => setRightPanel("agent")}
            >
              <Activity className="size-3.5" />
              WebMCP Activity
            </button>
            <button
              className={rightPanel === "config" ? "active" : ""}
              onClick={() => setRightPanel("config")}
              disabled={!selectedNode}
            >
              <Settings2 className="size-3.5" />
              Configure
            </button>
          </div>

          {rightPanel === "agent" ? (
            <>
              <div className="agent-context">
                <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-zinc-400">
                  <span className="flex items-center gap-2">
                    <Activity className="size-3.5 text-lime-300" />
                    Live graph context
                  </span>
                  <button
                    className="history-chip"
                    onClick={() => undoLastChange()}
                    disabled={history.length === 0}
                  >
                    <History className="size-3" />
                    {history.length}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <div>
                    <span>{nodes.length}</span>
                    <small>nodes</small>
                  </div>
                  <div>
                    <span>{edges.length}</span>
                    <small>edges</small>
                  </div>
                  <div>
                    <span>${monthlyTotal}</span>
                    <small>monthly</small>
                  </div>
                  <div>
                    <span>{liveValidation.resilienceScore}</span>
                    <small>resilience</small>
                  </div>
                </div>
              </div>

              {liveValidation.findings.length > 0 ? (
                <div className="finding-strip">
                  <AlertTriangle className="size-3.5" />
                  <span>{liveValidation.findings[0].title}</span>
                  <small>+{Math.max(0, liveValidation.findings.length - 1)}</small>
                </div>
              ) : null}

              <div className="tool-event-scroll">
                {toolEvents.length === 0 ? (
                  <div className="tool-event-empty">
                    <div>
                      <Braces className="size-5" />
                    </div>
                    <h2>Waiting for a browser agent</h2>
                    <p>
                      Real WebMCP calls, approval decisions, validation results,
                      and reversible mutations appear here.
                    </p>
                  </div>
                ) : (
                  toolEvents.map((event) => (
                    <article className="tool-event" key={event.id}>
                      <div
                        className={`tool-event-status ${event.status}`}
                        aria-label={event.status}
                      >
                        {event.status === "success" ? (
                          <Check className="size-3" />
                        ) : event.status === "cancelled" ? (
                          <X className="size-3" />
                        ) : (
                          <Activity className="size-3" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="tool-event-meta">
                          <code>{event.tool}</code>
                          <time>{event.time}</time>
                        </div>
                        <p>{event.summary}</p>
                        <pre>{event.input}</pre>
                      </div>
                    </article>
                  ))
                )}
              </div>

              <div className="browser-prompt-panel">
                <div className="browser-prompt-heading">
                  <span>
                    <Sparkles className="size-3" />
                    Demo prompts
                  </span>
                  <small>Click to copy</small>
                </div>
                <div className="browser-prompts">
                  {browserPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => void copyPrompt(prompt)}
                      title={prompt}
                    >
                      <span>{prompt}</span>
                      {copiedPrompt === prompt ? (
                        <Check className="size-3.5 text-lime-300" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="tool-registry">
                <div>
                  <span>Registered tools</span>
                  <strong>
                    <span />
                    {registeredToolNames.length} live
                  </strong>
                </div>
                <div className="tool-registry-list">
                  {registeredToolNames.map((tool) => (
                    <code key={tool}>{tool}</code>
                  ))}
                </div>
              </div>
            </>
          ) : selectedNode ? (
            <div className="config-panel">
              <div className="config-title">
                <div
                  className="palette-icon"
                  style={{
                    color: infrastructureCatalog[selectedNode.data.type].accent,
                  }}
                >
                  {(() => {
                    const Icon = paletteIcons[selectedNode.data.type];
                    return <Icon className="size-4" />;
                  })()}
                </div>
                <div>
                  <h2>{selectedNode.data.label}</h2>
                  <code>{selectedNode.id}</code>
                </div>
                <button onClick={() => setRightPanel("agent")}>
                  <X className="size-4" />
                </button>
              </div>

              <label className="config-field">
                <span>Region</span>
                <select
                  value={selectedNode.data.config.region}
                  onChange={(event) =>
                    updateSelectedConfig({ region: event.target.value })
                  }
                >
                  <option value="global">Global</option>
                  <option value="bom-1">Mumbai · bom-1</option>
                  <option value="sin-1">Singapore · sin-1</option>
                  <option value="fra-1">Frankfurt · fra-1</option>
                  <option value="iad-1">Virginia · iad-1</option>
                </select>
              </label>

              <label className="config-field">
                <span>Instance size</span>
                <select
                  value={selectedNode.data.config.size}
                  onChange={(event) =>
                    updateSelectedConfig({ size: event.target.value })
                  }
                >
                  <option value="standard-1">Standard 1 · 1 vCPU</option>
                  <option value="standard-2">Standard 2 · 2 vCPU</option>
                  <option value="db-standard-2">Database · 2 vCPU</option>
                  <option value="performance-4">Performance · 4 vCPU</option>
                </select>
              </label>

              <label className="config-field">
                <span>Replicas</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={selectedNode.data.config.replicas}
                  onChange={(event) =>
                    updateSelectedConfig({
                      replicas: Math.max(1, Number(event.target.value)),
                    })
                  }
                />
              </label>

              <label className="config-field">
                <span>Environment variables</span>
                <textarea
                  rows={6}
                  value={Object.entries(selectedNode.data.config.envVars)
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n")}
                  placeholder={"KEY=value\nANOTHER=value"}
                  onChange={(event) => {
                    const envVars = Object.fromEntries(
                      event.target.value
                        .split("\n")
                        .filter((line) => line.includes("="))
                        .map((line) => {
                          const [key, ...rest] = line.split("=");
                          return [key.trim(), rest.join("=").trim()];
                        })
                        .filter(([key]) => key),
                    );
                    updateSelectedConfig({ envVars });
                  }}
                />
              </label>

              <div className="config-summary">
                <span>Estimated monthly cost</span>
                <strong>${selectedNode.data.monthlyCost} USDC</strong>
              </div>
              <Button
                variant="danger"
                className="mt-auto w-full"
                onClick={() => {
                  removeInfrastructureNode({ node_id: selectedNode.id });
                  setSelectedNodeId(null);
                  setRightPanel("agent");
                }}
              >
                <Trash2 className="size-4" />
                Remove component
              </Button>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center px-8 text-center text-sm text-zinc-600">
              Select a node on the canvas to configure it.
            </div>
          )}
        </aside>
      </section>

      <ProposalDialog
        proposal={proposal}
        onApprove={handleProposalApprove}
        onReject={handleProposalReject}
      />
      <PaymentDialog
        open={paymentOpen}
        total={paymentTotal}
        status={paymentStatus}
        transaction={paymentReceipt?.transaction}
        architectureHash={paymentHash}
        onOpenChange={(open) => {
          if (!open && paymentStatus !== "settled") handlePaymentCancel();
          else setPaymentOpen(open);
        }}
        onConfirm={handlePaymentConfirm}
        onCancel={handlePaymentCancel}
      />
    </main>
  );
}
