"use client";

import "@mcp-b/global";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeMouseHandler,
  type NodeChange,
  type NodeMouseHandler,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useWebMCP } from "@mcp-b/react-webmcp";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
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
  Link2,
  LayoutDashboard,
  MonitorPlay,
  MousePointer2,
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
import {
  JudgeModePanel,
  type JudgeStep,
} from "@/components/judge-mode-panel";
import { PaymentDialog } from "@/components/payment-dialog";
import {
  PlanExecutionPanel,
  type PlanExecutionView,
} from "@/components/plan-execution-panel";
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
  nodeReference,
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
const getSelectionContextSchema = z.object({}).strict();
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

type VisualChange = {
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodes: InfrastructureNode[];
  addedEdgeIds: string[];
  removedEdges: Edge[];
};

type PlanStage = {
  graph: ReturnType<typeof cloneGraph>;
  label: string;
};

type PlanExecutionControl = {
  paused: boolean;
  cancelled: boolean;
  wake: (() => void) | null;
};

type RoutableEdge = Edge & {
  pathOptions?: {
    borderRadius?: number;
    offset?: number;
    stepPosition?: number;
  };
};

function planOperationToolName(operation: PlanInput["operations"][number]) {
  switch (operation.action) {
    case "add_node":
      return "add_infrastructure_node";
    case "update_node":
      return "update_node_config";
    default:
      return operation.action;
  }
}

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

const judgeSteps: JudgeStep[] = [
  {
    title: "Inspect the live graph",
    goal: "Prove that the agent can read the same architecture the human sees.",
    prompt:
      "Validate this architecture for Mumbai and Singapore, with at least 2 replicas and a $300 monthly budget.",
    expected:
      "A deterministic resilience score, exact cost, regional coverage, and actionable findings in the activity log.",
  },
  {
    title: "Collaborate on a safe change",
    goal: "Show an agent planning real canvas mutations while the human stays in control.",
    prompt:
      "Propose a safe plan to make this architecture highly available under $300. Ask me to approve before applying it.",
    expected:
      "A costed before/after proposal, explicit approval, animated graph changes, and one-step undo.",
  },
  {
    title: "Demonstrate failover",
    goal: "Make resilience tangible by failing Mumbai and watching traffic survive in Singapore.",
    prompt:
      "Simulate a Mumbai outage, explain the affected paths, then recover the region. Do not deploy.",
    expected:
      "Failed resources turn red, unavailable paths stop, surviving routes pulse, and recovery restores the graph.",
  },
];

const browserPrompts = judgeSteps.map((step) => step.prompt);

const registeredToolNames = [
  "analyze_current_architecture",
  "get_selection_context",
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

function resolveNodeId(reference: string, nodes: InfrastructureNode[]) {
  const normalized = reference.trim().replace(/^@/, "").toLocaleLowerCase();
  const exactMatches = nodes.filter(
    (node) =>
      node.id.toLocaleLowerCase() === normalized ||
      nodeReference(node.id).toLocaleLowerCase() === normalized,
  );
  if (exactMatches.length === 1) return exactMatches[0].id;

  const labelMatches = nodes.filter(
    (node) => node.data.label.toLocaleLowerCase() === normalized,
  );
  if (labelMatches.length === 1) return labelMatches[0].id;
  if (labelMatches.length > 1) {
    throw new Error(
      `“${reference}” is ambiguous. Use ${labelMatches
        .map((node) => nodeReference(node.id))
        .join(" or ")}.`,
    );
  }
  throw new Error(`Node reference “${reference}” does not exist.`);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function CanvasOpsApp() {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<InfrastructureNode>(initialNodes);
  const [edges, setEdges] = useEdgesState<Edge>(initialEdges);
  const [flow, setFlow] =
    useState<ReactFlowInstance<InfrastructureNode, Edge> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<"agent" | "config">("agent");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [history, setHistory] = useState<GraphHistoryEntry[]>([]);
  const [redoEntries, setRedoEntries] = useState<GraphHistoryEntry[]>([]);
  const [activeOutage, setActiveOutage] = useState<string | null>(null);
  const [visualChange, setVisualChange] = useState<VisualChange | null>(null);
  const [judgeMode, setJudgeMode] = useState(false);
  const [judgeStep, setJudgeStep] = useState(0);
  const [proposal, setProposal] = useState<ArchitectureProposal | null>(null);
  const [planExecution, setPlanExecution] =
    useState<PlanExecutionView | null>(null);
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
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const selectedEdgeIdRef = useRef(selectedEdgeId);
  const nextIdRef = useRef(nextNodeId(initialNodes));
  const historyIdRef = useRef(1);
  const toolEventIdRef = useRef(1);
  const hydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const suspendAutosaveRef = useRef(false);
  const graphMutationLockedRef = useRef(false);
  const planExecutionControlRef = useRef<PlanExecutionControl | null>(null);
  const dragStartRef = useRef<ReturnType<typeof cloneGraph> | null>(null);
  const visualChangeTimerRef = useRef<number | null>(null);
  const paymentResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const proposalResolverRef = useRef<((approved: boolean) => void) | null>(null);

  const applyGraph = useCallback(
    (nextNodes: InfrastructureNode[], nextEdges: Edge[]) => {
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      const validNodeIds = new Set(nextNodes.map((node) => node.id));
      const retainedSelection = selectedNodeIdsRef.current.filter((id) =>
        validNodeIds.has(id),
      );
      if (retainedSelection.length !== selectedNodeIdsRef.current.length) {
        selectedNodeIdsRef.current = retainedSelection;
        setSelectedNodeIds(retainedSelection);
        setSelectedNodeId(
          retainedSelection.length === 1 ? retainedSelection[0] : null,
        );
      }
      if (
        selectedEdgeIdRef.current !== null &&
        !nextEdges.some((edge) => edge.id === selectedEdgeIdRef.current)
      ) {
        selectedEdgeIdRef.current = null;
        setSelectedEdgeId(null);
      }
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

  const showGraphChanges = useCallback(
    (
      before: ReturnType<typeof cloneGraph>,
      after: ReturnType<typeof cloneGraph>,
    ) => {
      const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
      const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
      const beforeEdgeIds = new Set(before.edges.map((edge) => edge.id));
      const afterEdgeIds = new Set(after.edges.map((edge) => edge.id));

      const addedNodeIds = after.nodes
        .filter((node) => !beforeNodes.has(node.id))
        .map((node) => node.id);
      const removedNodes = before.nodes.filter((node) => !afterNodes.has(node.id));
      const updatedNodeIds = after.nodes
        .filter((node) => {
          const previous = beforeNodes.get(node.id);
          return (
            previous !== undefined &&
            JSON.stringify({ data: previous.data, position: previous.position }) !==
              JSON.stringify({ data: node.data, position: node.position })
          );
        })
        .map((node) => node.id);
      const addedEdgeIds = after.edges
        .filter((edge) => !beforeEdgeIds.has(edge.id))
        .map((edge) => edge.id);
      const removedEdges = before.edges.filter(
        (edge) => !afterEdgeIds.has(edge.id),
      );

      if (
        addedNodeIds.length === 0 &&
        removedNodes.length === 0 &&
        updatedNodeIds.length === 0 &&
        addedEdgeIds.length === 0 &&
        removedEdges.length === 0
      ) {
        return;
      }

      setVisualChange({
        addedNodeIds,
        updatedNodeIds,
        removedNodes,
        addedEdgeIds,
        removedEdges,
      });
      if (visualChangeTimerRef.current !== null) {
        window.clearTimeout(visualChangeTimerRef.current);
      }
      visualChangeTimerRef.current = window.setTimeout(() => {
        setVisualChange(null);
        visualChangeTimerRef.current = null;
      }, 2200);
    },
    [],
  );

  const commitGraph = useCallback(
    (label: string, nextNodes: InfrastructureNode[], nextEdges: Edge[]) => {
      if (graphMutationLockedRef.current) {
        throw new Error(
          "An approved architecture plan is currently executing. Pause or cancel it before making another change.",
        );
      }
      const before = cloneGraph(nodesRef.current, edgesRef.current);
      const after = cloneGraph(nextNodes, nextEdges);
      pushHistory({ id: historyIdRef.current++, label, before, after });
      showGraphChanges(before, after);
      applyGraph(after.nodes, after.edges);
    },
    [applyGraph, pushHistory, showGraphChanges],
  );

  useEffect(
    () => () => {
      if (visualChangeTimerRef.current !== null) {
        window.clearTimeout(visualChangeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [edges, nodes]);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
    selectedEdgeIdRef.current = selectedEdgeId;
  }, [selectedEdgeId, selectedNodeIds]);

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
    if (suspendAutosaveRef.current) return;
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
      const sourceId = resolveNodeId(input.source_id, nodesRef.current);
      const targetId = resolveNodeId(input.target_id, nodesRef.current);
      const duplicate = edgesRef.current.some(
        (edge) => edge.source === sourceId && edge.target === targetId,
      );
      if (duplicate) return { success: true, already_connected: true };

      const edge: Edge = {
        id: `edge-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "smoothstep",
        animated:
          input.connection_type === "event" ||
          input.connection_type === "request",
        label: input.connection_type,
      };
      commitGraph(
        `Connected ${nodeReference(sourceId)} to ${nodeReference(targetId)}`,
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
      const sourceId = resolveNodeId(input.source_id, nodesRef.current);
      const targetId = resolveNodeId(input.target_id, nodesRef.current);
      const nextEdges = edgesRef.current.filter(
        (edge) =>
          !(edge.source === sourceId && edge.target === targetId),
      );
      if (nextEdges.length === edgesRef.current.length) {
        throw new Error("The requested connection does not exist.");
      }
      commitGraph(
        `Disconnected ${nodeReference(sourceId)} from ${nodeReference(targetId)}`,
        nodesRef.current,
        nextEdges,
      );
      return { success: true, removed_edges: 1 };
    },
    [commitGraph],
  );

  const moveInfrastructureNode = useCallback(
    (input: z.infer<typeof moveNodeSchema>) => {
      const nodeId = resolveNodeId(input.node_id, nodesRef.current);
      const nextNodes = nodesRef.current.map((node) =>
        node.id === nodeId
          ? { ...node, position: { x: input.x, y: input.y } }
          : node,
      );
      commitGraph(`Moved ${nodeReference(nodeId)}`, nextNodes, edgesRef.current);
      return {
        success: true,
        node_id: nodeId,
        position: { x: input.x, y: input.y },
      };
    },
    [commitGraph],
  );

  const removeInfrastructureNode = useCallback(
    (input: z.infer<typeof removeNodeSchema>) => {
      const nodeId = resolveNodeId(input.node_id, nodesRef.current);
      const target = nodesRef.current.find((node) => node.id === nodeId);
      if (!target) throw new Error(`Node ${nodeId} does not exist.`);
      const nextNodes = nodesRef.current.filter(
        (node) => node.id !== nodeId,
      );
      const nextEdges = edgesRef.current.filter(
        (edge) =>
          edge.source !== nodeId && edge.target !== nodeId,
      );
      const removedEdges = edgesRef.current.length - nextEdges.length;
      commitGraph(`Removed ${target.data.label}`, nextNodes, nextEdges);
      return {
        success: true,
        removed_node_id: nodeId,
        removed_edges: removedEdges,
        monthly_savings_usdc: target.data.monthlyCost,
      };
    },
    [commitGraph],
  );

  const updateInfrastructureNode = useCallback(
    (input: z.infer<typeof updateNodeConfigSchema>) => {
      const nodeId = resolveNodeId(input.node_id, nodesRef.current);
      const target = nodesRef.current.find((node) => node.id === nodeId);
      if (!target) throw new Error(`Node ${nodeId} does not exist.`);
      const nextNodes = nodesRef.current.map((node) => {
        if (node.id !== nodeId) return node;
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
        node_id: nodeId,
        updated_fields: Object.keys(input).filter((key) => key !== "node_id"),
        monthly_cost_usdc:
          nextNodes.find((node) => node.id === nodeId)?.data.monthlyCost ??
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
        reference: nodeReference(node.id),
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
      selection: {
        node_ids: selectedNodeIdsRef.current,
        node_references: selectedNodeIdsRef.current.map(nodeReference),
        edge_id: selectedEdgeIdRef.current,
      },
    };
  }, []);

  const getSelectionContext = useCallback(() => {
    const selectedIds = new Set(selectedNodeIdsRef.current);
    const selectedNodes = nodesRef.current.filter((node) =>
      selectedIds.has(node.id),
    );
    const selectedEdges = edgesRef.current.filter(
      (edge) =>
        edge.id === selectedEdgeIdRef.current ||
        selectedIds.has(edge.source) ||
        selectedIds.has(edge.target),
    );
    return {
      selected_node_count: selectedNodes.length,
      selected_edge_id: selectedEdgeIdRef.current,
      nodes: selectedNodes.map((node) => ({
        id: node.id,
        reference: nodeReference(node.id),
        label: node.data.label,
        type: node.data.type,
        position: node.position,
        config: node.data.config,
      })),
      related_connections: selectedEdges.map((edge) => ({
        id: edge.id,
        source_id: edge.source,
        source_reference: nodeReference(edge.source),
        target_id: edge.target,
        target_reference: nodeReference(edge.target),
        connection_type: edge.label ?? "data",
      })),
      instruction:
        selectedNodes.length === 0 && selectedEdgeIdRef.current === null
          ? "Nothing is selected. Ask the user to select an element or use an exact node reference."
          : "Treat selected elements as the explicit scope. Preserve all unselected elements unless the user clearly requests otherwise.",
    };
  }, []);

  const undoLastChange = useCallback(() => {
    if (graphMutationLockedRef.current) {
      return { success: false, status: "plan_execution_in_progress" };
    }
    const latest = historyRef.current.at(-1);
    if (!latest) return { success: false, status: "nothing_to_undo" };
    const nextHistory = historyRef.current.slice(0, -1);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    const nextRedo = [...redoRef.current, latest].slice(-30);
    redoRef.current = nextRedo;
    setRedoEntries(nextRedo);
    showGraphChanges(latest.after, latest.before);
    applyGraph(latest.before.nodes, latest.before.edges);
    return { success: true, reverted: latest.label };
  }, [applyGraph, showGraphChanges]);

  const redoLastChange = useCallback(() => {
    if (graphMutationLockedRef.current) {
      return { success: false, status: "plan_execution_in_progress" };
    }
    const latest = redoRef.current.at(-1);
    if (!latest) return { success: false, status: "nothing_to_redo" };
    const nextRedo = redoRef.current.slice(0, -1);
    redoRef.current = nextRedo;
    setRedoEntries(nextRedo);
    const nextHistory = [...historyRef.current, latest].slice(-30);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    showGraphChanges(latest.before, latest.after);
    applyGraph(latest.after.nodes, latest.after.edges);
    return { success: true, replayed: latest.label };
  }, [applyGraph, showGraphChanges]);

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

  const resetDemo = useCallback(() => {
    const resetGraph = cloneGraph(initialNodes, initialEdges);
    commitGraph("Reset to the judge demo architecture", resetGraph.nodes, resetGraph.edges);
    nextIdRef.current = nextNodeId(resetGraph.nodes);
    setActiveOutage(null);
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setRightPanel("agent");
    setJudgeMode(true);
    setJudgeStep(0);
    setToolEvents([]);
    logToolEvent(
      "demo_reset",
      "Restored the deterministic judge demo. The previous graph remains available through Undo.",
      {},
    );
    window.setTimeout(
      () => void flow?.fitView({ padding: 0.23, duration: 650 }),
      60,
    );
  }, [commitGraph, flow, logToolEvent]);

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
      const failoverNodeIds = nodesRef.current
        .filter(
          (node) =>
            node.data.type === "api-service" &&
            node.data.config.region !== input.region &&
            node.data.status !== "warning",
        )
        .map((node) => node.id);
      const failoverSet = new Set(failoverNodeIds);
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
        const carriesFailoverTraffic =
          failoverSet.has(edge.source) || failoverSet.has(edge.target);
        return {
          ...edge,
          animated: recovering
            ? edge.label === "request" || edge.label === "event"
            : affected
              ? false
              : carriesFailoverTraffic || edge.animated,
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
        failover_node_ids: recovering ? [] : failoverNodeIds,
        traffic_rerouted: !recovering && failoverNodeIds.length > 0,
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
      const stages: PlanStage[] = [];
      const resolveRef = (reference: string) =>
        aliases.get(reference) ?? resolveNodeId(reference, simulatedNodes);

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
          const nodeId = resolveRef(operation.node_id);
          simulatedNodes = simulatedNodes.map((node) =>
            node.id === nodeId
              ? { ...node, position: { x: operation.x, y: operation.y } }
              : node,
          );
          changes.push(`Move ${nodeReference(nodeId)} to a clear position`);
        } else if (operation.action === "remove_node") {
          const nodeId = resolveRef(operation.node_id);
          simulatedNodes = simulatedNodes.filter(
            (node) => node.id !== nodeId,
          );
          simulatedEdges = simulatedEdges.filter(
            (edge) =>
              edge.source !== nodeId && edge.target !== nodeId,
          );
          changes.push(`Remove ${nodeReference(nodeId)} and its dependencies`);
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
          const sourceId = resolveRef(operation.source_id);
          const targetId = resolveRef(operation.target_id);
          simulatedEdges = simulatedEdges.filter(
            (edge) =>
              !(
                edge.source === sourceId && edge.target === targetId
              ),
          );
          changes.push(
            `Disconnect ${nodeReference(sourceId)} → ${nodeReference(targetId)}`,
          );
        } else {
          const nodeId = resolveRef(operation.node_id);
          const target = simulatedNodes.find(
            (node) => node.id === nodeId,
          );
          if (!target) throw new Error(`Node ${nodeId} does not exist.`);
          simulatedNodes = simulatedNodes.map((node) => {
            if (node.id !== nodeId) return node;
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
          changes.push(`Update ${nodeReference(nodeId)} configuration`);
        }
        stages.push({
          graph: cloneGraph(simulatedNodes, simulatedEdges),
          label: changes.at(-1) ?? "Apply architecture change",
        });
      }
      return {
        nextNodes: simulatedNodes,
        nextEdges: simulatedEdges,
        nextId: simulatedId,
        changes,
        stages,
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

  const executePlanStages = useCallback(
    async (
      parsed: PlanInput,
      preview: ReturnType<typeof previewPlan>,
      beforeCost: number,
      afterCost: number,
      finalHash: string,
    ) => {
      const before = cloneGraph(nodesRef.current, edgesRef.current);
      let appliedSteps = 0;
      const control: PlanExecutionControl = {
        paused: false,
        cancelled: false,
        wake: null,
      };
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const stepDelay = reducedMotion ? 120 : 1100;
      const persist = (graph: ReturnType<typeof cloneGraph>) => {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ nodes: graph.nodes, edges: graph.edges }),
        );
      };
      const waitWhilePaused = async () => {
        while (control.paused && !control.cancelled) {
          await new Promise<void>((resolve) => {
            control.wake = resolve;
          });
        }
        control.wake = null;
      };
      const rollback = async (label: string) => {
        setPlanExecution((current) =>
          current
            ? {
                ...current,
                status: "rolling-back",
                currentLabel: label,
              }
            : current,
        );
        const current = cloneGraph(nodesRef.current, edgesRef.current);
        showGraphChanges(current, before);
        applyGraph(before.nodes, before.edges);
        persist(before);
        logToolEvent(
          "plan_rollback",
          `Restored the original graph after ${appliedSteps} completed step(s).`,
          {
            plan: parsed.summary,
            completed_steps: appliedSteps,
            restored_architecture_hash: architectureHash(
              before.nodes,
              before.edges,
            ),
          },
          "cancelled",
        );
        await wait(reducedMotion ? 100 : 700);
      };

      graphMutationLockedRef.current = true;
      suspendAutosaveRef.current = true;
      planExecutionControlRef.current = control;
      setPlanExecution({
        summary: parsed.summary,
        steps: preview.changes,
        currentStep: 0,
        currentLabel: "Preparing the approved transaction",
        status: "running",
        beforeCost,
        targetCost: afterCost,
      });

      try {
        for (let index = 0; index < preview.stages.length; index += 1) {
          await waitWhilePaused();
          if (control.cancelled) {
            await rollback("Restoring the architecture from before this plan");
            return {
              success: false as const,
              status: "cancelled_and_rolled_back" as const,
              changes_applied: index,
            };
          }

          const stage = preview.stages[index];
          const operation = parsed.operations[index];
          const previous = cloneGraph(nodesRef.current, edgesRef.current);
          showGraphChanges(previous, stage.graph);
          applyGraph(stage.graph.nodes, stage.graph.edges);
          appliedSteps = index + 1;
          logToolEvent(
            planOperationToolName(operation),
            `Plan step ${index + 1}/${preview.stages.length}: ${stage.label}.`,
            operation,
          );
          setPlanExecution((current) =>
            current
              ? {
                  ...current,
                  currentStep: index + 1,
                  currentLabel: stage.label,
                }
              : current,
          );
          await wait(stepDelay);
        }

        await waitWhilePaused();
        if (control.cancelled) {
          await rollback("Restoring the architecture from before this plan");
          return {
            success: false as const,
            status: "cancelled_and_rolled_back" as const,
            changes_applied: preview.stages.length,
          };
        }

        const after = cloneGraph(preview.nextNodes, preview.nextEdges);
        pushHistory({
          id: historyIdRef.current++,
          label: parsed.summary,
          before,
          after,
        });
        nextIdRef.current = preview.nextId;
        persist(after);
        setPlanExecution((current) =>
          current
            ? {
                ...current,
                currentStep: preview.stages.length,
                currentLabel: "All changes applied as one undoable transaction",
                status: "completed",
              }
            : current,
        );
        await wait(reducedMotion ? 120 : 900);
        return {
          success: true as const,
          status: "applied" as const,
          changes_applied: preview.changes.length,
          estimated_monthly_cost_usdc: afterCost,
          architecture_hash: finalHash,
        };
      } catch (error) {
        await rollback("An operation failed; restoring the original graph");
        return {
          success: false as const,
          status: "failed_and_rolled_back" as const,
          error: error instanceof Error ? error.message : "Unknown execution error",
        };
      } finally {
        graphMutationLockedRef.current = false;
        suspendAutosaveRef.current = false;
        planExecutionControlRef.current = null;
        setPlanExecution(null);
      }
    },
    [applyGraph, logToolEvent, pushHistory, showGraphChanges],
  );

  const proposeArchitecturePlan = useCallback(
    async (parsed: PlanInput) => {
      const preview = previewPlan(parsed);
      const beforeCost = calculateMonthlyTotal(nodesRef.current);
      const afterCost = calculateMonthlyTotal(preview.nextNodes);
      const beforeHash = architectureHash(nodesRef.current, edgesRef.current);
      const finalHash = architectureHash(preview.nextNodes, preview.nextEdges);
      const nextProposal: ArchitectureProposal = {
        summary: parsed.summary,
        changes: preview.changes,
        beforeCost,
        afterCost,
        maxMonthlyCost: parsed.max_monthly_cost_usdc,
        architectureHash: finalHash,
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
      if (architectureHash(nodesRef.current, edgesRef.current) !== beforeHash) {
        logToolEvent(
          "propose_architecture_plan",
          "The graph changed during review, so the stale plan was not applied.",
          parsed,
          "cancelled",
        );
        return { success: false, status: "stale_plan" };
      }

      const result = await executePlanStages(
        parsed,
        preview,
        beforeCost,
        afterCost,
        finalHash,
      );
      logToolEvent(
        "propose_architecture_plan",
        result.success
          ? `Human approved and watched ${preview.changes.length} changes apply as one undoable transaction.`
          : result.status === "cancelled_and_rolled_back"
            ? `Human cancelled after ${result.changes_applied} step(s); the original graph was restored.`
            : "Plan execution failed; the original graph was restored.",
        parsed,
        result.success ? "success" : "cancelled",
      );
      return result;
    },
    [
      executePlanStages,
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
      name: "get_selection_context",
      description:
        "Read the user's current node and connection selection. Call when the user says this, selected, these nodes, or refers to the current focus.",
      inputSchema: getSelectionContextSchema,
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const parsed = getSelectionContextSchema.parse(input);
        const result = getSelectionContext();
        logToolEvent(
          "get_selection_context",
          `Read ${result.selected_node_count} selected node(s)${result.selected_edge_id ? " and one selected connection" : ""}.`,
          parsed,
        );
        return result;
      },
    },
    [getSelectionContext, logToolEvent],
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
      description:
        "Move one existing node to exact canvas coordinates. node_id accepts a permanent ID, short reference such as N4, or an unambiguous label.",
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
        "Remove one existing node and all attached edges. node_id accepts an ID, short reference, or unambiguous label. This mutation is undoable.",
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
        "Create a validated directional connection. Each endpoint accepts a permanent ID, short reference such as N4, or an unambiguous label.",
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
      description:
        "Remove one directional connection. Each endpoint accepts a permanent ID, short reference, or unambiguous label.",
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
        "Update a node label, region, instance size, replicas, and/or environment variables. node_id accepts an ID, short reference, or unambiguous label. Cost is recalculated from replicas.",
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
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("Failed to register provision_and_pay", error);
      }
    });

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
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );
  const outageImpact = useMemo(() => {
    if (!activeOutage) return null;
    const affectedNodeIds = new Set(
      nodes
        .filter((node) => node.data.config.region === activeOutage)
        .map((node) => node.id),
    );
    const failedEdgeIds = new Set(
      edges
        .filter(
          (edge) =>
            affectedNodeIds.has(edge.source) || affectedNodeIds.has(edge.target),
        )
        .map((edge) => edge.id),
    );
    const failoverNodes = nodes.filter(
      (node) =>
        node.data.type === "api-service" &&
        node.data.config.region !== activeOutage &&
        !affectedNodeIds.has(node.id),
    );
    const failoverNodeIds = new Set(failoverNodes.map((node) => node.id));
    const reroutedEdgeIds = new Set(
      edges
        .filter(
          (edge) =>
            !failedEdgeIds.has(edge.id) &&
            (failoverNodeIds.has(edge.source) || failoverNodeIds.has(edge.target)),
        )
        .map((edge) => edge.id),
    );
    const regions = [...new Set(failoverNodes.map((node) => node.data.config.region))];
    return {
      affectedNodeIds,
      failedEdgeIds,
      reroutedEdgeIds,
      affectedCount: affectedNodeIds.size,
      failedPathCount: failedEdgeIds.size,
      failoverRegions: regions,
      failoverCount: failoverNodes.length,
    };
  }, [activeOutage, edges, nodes]);
  const displayNodes = useMemo(() => {
    const added = new Set(visualChange?.addedNodeIds ?? []);
    const updated = new Set(visualChange?.updatedNodeIds ?? []);
    const current = nodes.map((node) => ({
      ...node,
      className: [
        node.className,
        added.has(node.id) ? "node-change-added" : "",
        updated.has(node.id) ? "node-change-updated" : "",
        outageImpact?.affectedNodeIds.has(node.id) ? "node-outage-failed" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }));
    const removed = (visualChange?.removedNodes ?? []).map((node) => ({
      ...node,
      draggable: false,
      selectable: false,
      className: [node.className, "node-change-removed"].filter(Boolean).join(" "),
    }));
    return [...current, ...removed];
  }, [nodes, outageImpact, visualChange]);
  const displayEdges = useMemo(() => {
    const added = new Set(visualChange?.addedEdgeIds ?? []);
    const current = edges.map((edge) => ({
      ...edge,
      className: [
        edge.className,
        added.has(edge.id) ? "edge-change-added" : "",
        outageImpact?.failedEdgeIds.has(edge.id) ? "edge-outage-failed" : "",
        outageImpact?.reroutedEdgeIds.has(edge.id) ? "edge-outage-rerouted" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }));
    const displayNodeIds = new Set(displayNodes.map((node) => node.id));
    const removed = (visualChange?.removedEdges ?? [])
      .filter(
        (edge) =>
          displayNodeIds.has(edge.source) && displayNodeIds.has(edge.target),
      )
      .map((edge) => ({
        ...edge,
        animated: false,
        className: [edge.className, "edge-change-removed"]
          .filter(Boolean)
          .join(" "),
      }));
    return [...current, ...removed];
  }, [displayNodes, edges, outageImpact, visualChange]);

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

  const handleReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const duplicate = edgesRef.current.some(
        (edge) =>
          edge.id !== oldEdge.id &&
          edge.source === connection.source &&
          edge.target === connection.target,
      );
      if (duplicate) return;
      const nextEdges = reconnectEdge(oldEdge, connection, edgesRef.current, {
        shouldReplaceId: false,
      });
      commitGraph(
        `Rerouted ${nodeReference(connection.source)} → ${nodeReference(connection.target)}`,
        nodesRef.current,
        nextEdges,
      );
    },
    [commitGraph],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<InfrastructureNode>[]) => {
      const removedIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .filter((change) =>
            nodesRef.current.some((node) => node.id === change.id),
          )
          .map((change) => change.id),
      );
      if (removedIds.size > 0) {
        const nextNodes = applyNodeChanges(changes, nodesRef.current);
        const nextEdges = edgesRef.current.filter(
          (edge) =>
            !removedIds.has(edge.source) && !removedIds.has(edge.target),
        );
        commitGraph(
          `Removed ${removedIds.size} selected component${removedIds.size === 1 ? "" : "s"}`,
          nextNodes,
          nextEdges,
        );
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        return;
      }
      onNodesChange(changes);
      nodesRef.current = applyNodeChanges(changes, nodesRef.current);
    },
    [commitGraph, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const removed = changes
        .filter((change) => change.type === "remove")
        .filter((change) =>
          edgesRef.current.some((edge) => edge.id === change.id),
        );
      if (removed.length > 0) {
        const nextEdges = applyEdgeChanges(changes, edgesRef.current);
        commitGraph(
          `Removed ${removed.length} selected connection${removed.length === 1 ? "" : "s"}`,
          nodesRef.current,
          nextEdges,
        );
        setSelectedEdgeId(null);
        return;
      }
      const nextEdges = applyEdgeChanges(changes, edgesRef.current);
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    },
    [commitGraph, setEdges],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<
      InfrastructureNode,
      Edge
    >) => {
      const nodeIds = selectedNodes.map((node) => node.id);
      const edgeId = selectedEdges.length === 1 ? selectedEdges[0].id : null;
      setSelectedNodeIds(nodeIds);
      setSelectedNodeId(nodeIds.length === 1 ? nodeIds[0] : null);
      setSelectedEdgeId(edgeId);
      if (nodeIds.length === 1 || edgeId !== null) setRightPanel("config");
    },
    [],
  );

  const handleNodeClick: NodeMouseHandler<InfrastructureNode> = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setRightPanel("config");
    },
    [],
  );

  const handleEdgeClick: EdgeMouseHandler<Edge> = useCallback((_event, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setRightPanel("config");
  }, []);

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
      if (graphMutationLockedRef.current) return;
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

  const renameSelectedNode = useCallback(
    (label: string) => {
      if (!selectedNode || label.trim() === selectedNode.data.label) return;
      updateInfrastructureNode({
        node_id: selectedNode.id,
        label: label.trim(),
      });
    },
    [selectedNode, updateInfrastructureNode],
  );

  const updateSelectedEdge = useCallback(
    (
      patch: Partial<
        Pick<
          RoutableEdge,
          "source" | "target" | "label" | "animated" | "type" | "pathOptions"
        >
      >,
    ) => {
      if (!selectedEdge) return;
      const source = patch.source ?? selectedEdge.source;
      const target = patch.target ?? selectedEdge.target;
      if (source === target) return;
      const duplicatesAnotherEdge = edgesRef.current.some(
        (edge) =>
          edge.id !== selectedEdge.id &&
          edge.source === source &&
          edge.target === target,
      );
      if (duplicatesAnotherEdge) return;
      const nextEdges = edgesRef.current.map((edge) =>
        edge.id === selectedEdge.id ? { ...edge, ...patch } : edge,
      );
      commitGraph("Updated connection", nodesRef.current, nextEdges);
    },
    [commitGraph, selectedEdge],
  );

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdge) return;
    commitGraph(
      `Removed ${nodeReference(selectedEdge.source)} → ${nodeReference(selectedEdge.target)}`,
      nodesRef.current,
      edgesRef.current.filter((edge) => edge.id !== selectedEdge.id),
    );
    setSelectedEdgeId(null);
    setRightPanel("agent");
  }, [commitGraph, selectedEdge]);

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
  const handlePlanPause = () => {
    const control = planExecutionControlRef.current;
    if (!control || control.cancelled) return;
    control.paused = true;
    setPlanExecution((current) =>
      current ? { ...current, status: "paused" } : current,
    );
  };
  const handlePlanResume = () => {
    const control = planExecutionControlRef.current;
    if (!control || control.cancelled) return;
    control.paused = false;
    setPlanExecution((current) =>
      current ? { ...current, status: "running" } : current,
    );
    control.wake?.();
    control.wake = null;
  };
  const handlePlanCancel = () => {
    const control = planExecutionControlRef.current;
    if (!control) return;
    control.cancelled = true;
    control.paused = false;
    control.wake?.();
    control.wake = null;
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
            disabled={history.length === 0 || planExecution !== null}
          >
            <RotateCcw className="size-3.5" />
            Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => redoLastChange()}
            disabled={redoEntries.length === 0 || planExecution !== null}
          >
            <History className="size-3.5" />
            Replay
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => runAutoLayout({ direction: "LR", group_by: "layer" })}
            disabled={planExecution !== null}
          >
            <LayoutDashboard className="size-3.5" />
            Arrange
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={resetDemo}
            disabled={planExecution !== null}
          >
            <RotateCcw className="size-3.5" />
            Demo Reset
          </Button>
          <Button
            variant={judgeMode ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              setJudgeMode((active) => !active);
              setRightPanel("agent");
            }}
            disabled={planExecution !== null}
          >
            <MonitorPlay className="size-3.5" />
            Judge Mode
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void provisionArchitecture({
                total_cost_usdc: monthlyTotal,
                architecture_hash: liveHash,
              })
            }
            disabled={planExecution !== null}
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
                  disabled={planExecution !== null}
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
              <div className="outage-banner-title">
                <span>
                  <AlertTriangle className="size-3.5" />
                  {activeOutage.toUpperCase()} regional outage
                </span>
                <strong>FAILOVER ACTIVE</strong>
              </div>
              <div className="outage-metrics">
                <span>
                  <strong>{outageImpact?.affectedCount ?? 0}</strong>
                  resources offline
                </span>
                <span>
                  <strong>{outageImpact?.failedPathCount ?? 0}</strong>
                  paths interrupted
                </span>
                <span className="surviving">
                  <strong>{outageImpact?.failoverCount ?? 0}</strong>
                  APIs serving from {outageImpact?.failoverRegions.join(", ") || "backup"}
                </span>
              </div>
              <div className="outage-routing">
                <span className="route-pulse" />
                Traffic is automatically rerouting across surviving paths
                <button
                  onClick={() =>
                    simulateOutage({ region: activeOutage, mode: "recover" })
                  }
                >
                  Recover region
                </button>
              </div>
            </div>
          ) : null}

          {judgeMode ? (
            <div className="judge-canvas-badge">
              <MonitorPlay className="size-3.5" />
              Judge Mode
              <span>
                {judgeStep + 1}/{judgeSteps.length}
              </span>
            </div>
          ) : null}

          {planExecution ? (
            <PlanExecutionPanel
              execution={planExecution}
              liveCost={monthlyTotal}
              liveResilience={liveValidation.resilienceScore}
              onPause={handlePlanPause}
              onResume={handlePlanResume}
              onCancel={handlePlanCancel}
            />
          ) : null}

          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onInit={setFlow}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onReconnect={handleReconnect}
            onSelectionChange={handleSelectionChange}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onNodeDragStart={() => {
              dragStartRef.current = cloneGraph(nodesRef.current, edgesRef.current);
            }}
            onNodeDragStop={(_event, node) => {
              const before = dragStartRef.current;
              if (!before) return;
              const after = cloneGraph(nodesRef.current, edgesRef.current);
              if (
                JSON.stringify(before.nodes.map((item) => item.position)) ===
                JSON.stringify(after.nodes.map((item) => item.position))
              ) {
                dragStartRef.current = null;
                return;
              }
              pushHistory({
                id: historyIdRef.current++,
                label: `Moved ${node.data.label}`,
                before,
                after,
              });
              applyGraph(after.nodes, after.edges);
              dragStartRef.current = null;
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedNodeIds([]);
              setSelectedEdgeId(null);
            }}
            nodesDraggable={planExecution === null}
            nodesConnectable={planExecution === null}
            edgesReconnectable={planExecution === null}
            elementsSelectable={planExecution === null}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
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
              disabled={!selectedNode && !selectedEdge}
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
                <div className="mt-2 flex min-h-7 items-center gap-2 rounded-md border border-white/[.05] bg-black/15 px-2 text-[9px] text-zinc-500">
                  <MousePointer2 className="size-3 shrink-0 text-zinc-600" />
                  {selectedNodeIds.length > 0 ? (
                    <>
                      <span>Agent scope:</span>
                      <code className="text-lime-300/80">
                        {selectedNodeIds.map(nodeReference).join(", ")}
                      </code>
                    </>
                  ) : selectedEdge ? (
                    <>
                      <span>Selected route:</span>
                      <code className="text-cyan-300/80">
                        {nodeReference(selectedEdge.source)} →{" "}
                        {nodeReference(selectedEdge.target)}
                      </code>
                    </>
                  ) : (
                    <span>Select nodes to give the agent an exact scope.</span>
                  )}
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

              {judgeMode ? (
                <JudgeModePanel
                  steps={judgeSteps}
                  activeStep={judgeStep}
                  copiedPrompt={copiedPrompt}
                  onChangeStep={setJudgeStep}
                  onCopyPrompt={(prompt) => void copyPrompt(prompt)}
                  onClose={() => setJudgeMode(false)}
                />
              ) : (
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
              )}

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
                  <code title={selectedNode.id}>
                    {nodeReference(selectedNode.id)} · {selectedNode.id}
                  </code>
                </div>
                <button onClick={() => setRightPanel("agent")}>
                  <X className="size-4" />
                </button>
              </div>

              <label className="config-field">
                <span>Name</span>
                <input
                  key={`${selectedNode.id}:${selectedNode.data.label}`}
                  defaultValue={selectedNode.data.label}
                  maxLength={64}
                  onBlur={(event) => renameSelectedNode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>

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
          ) : selectedEdge ? (
            <div className="config-panel">
              <div className="config-title">
                <div className="palette-icon text-cyan-300">
                  <Link2 className="size-4" />
                </div>
                <div>
                  <h2>Connection</h2>
                  <code>{selectedEdge.id}</code>
                </div>
                <button onClick={() => setRightPanel("agent")}>
                  <X className="size-4" />
                </button>
              </div>

              <label className="config-field">
                <span>Source</span>
                <select
                  value={selectedEdge.source}
                  onChange={(event) =>
                    updateSelectedEdge({ source: event.target.value })
                  }
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {nodeReference(node.id)} · {node.data.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end gap-2">
                <label className="config-field min-w-0 flex-1">
                  <span>Target</span>
                  <select
                    value={selectedEdge.target}
                    onChange={(event) =>
                      updateSelectedEdge({ target: event.target.value })
                    }
                  >
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {nodeReference(node.id)} · {node.data.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  title="Reverse direction"
                  onClick={() =>
                    updateSelectedEdge({
                      source: selectedEdge.target,
                      target: selectedEdge.source,
                    })
                  }
                >
                  <ArrowLeftRight className="size-3.5" />
                </Button>
              </div>

              <label className="config-field">
                <span>Meaning</span>
                <select
                  value={String(selectedEdge.label ?? "data")}
                  onChange={(event) =>
                    updateSelectedEdge({
                      label: event.target.value,
                      animated:
                        event.target.value === "request" ||
                        event.target.value === "event",
                    })
                  }
                >
                  <option value="data">Data flow</option>
                  <option value="request">Request</option>
                  <option value="event">Event</option>
                  <option value="replication">Replication</option>
                  <option value="dependency">Dependency</option>
                </select>
              </label>

              <label className="config-field">
                <span>Route style</span>
                <select
                  value={selectedEdge.type ?? "smoothstep"}
                  onChange={(event) =>
                    updateSelectedEdge({ type: event.target.value })
                  }
                >
                  <option value="smoothstep">Rounded orthogonal</option>
                  <option value="step">Orthogonal</option>
                  <option value="default">Curved</option>
                  <option value="straight">Straight</option>
                </select>
              </label>

              {selectedEdge.type === "smoothstep" ||
              selectedEdge.type === "step" ? (
                <label className="config-field">
                  <span className="flex items-center justify-between">
                    Bend position
                    <code>
                      {Math.round(
                        ((selectedEdge as RoutableEdge).pathOptions
                          ?.stepPosition ?? 0.5) * 100,
                      )}
                      %
                    </code>
                  </span>
                  <input
                    type="range"
                    min={10}
                    max={90}
                    step={5}
                    value={
                      ((selectedEdge as RoutableEdge).pathOptions
                        ?.stepPosition ?? 0.5) * 100
                    }
                    onChange={(event) =>
                      updateSelectedEdge({
                        pathOptions: {
                          ...(selectedEdge as RoutableEdge).pathOptions,
                          stepPosition: Number(event.target.value) / 100,
                        },
                      })
                    }
                  />
                </label>
              ) : null}

              <div className="config-summary">
                <span>Route</span>
                <strong>
                  {nodeReference(selectedEdge.source)} →{" "}
                  {nodeReference(selectedEdge.target)}
                </strong>
              </div>

              <Button
                variant="danger"
                className="mt-auto w-full"
                onClick={removeSelectedEdge}
              >
                <Trash2 className="size-4" />
                Remove connection
              </Button>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center px-8 text-center text-sm text-zinc-600">
              Select a node or connection on the canvas to configure it.
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
