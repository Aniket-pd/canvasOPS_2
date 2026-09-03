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
  Cog,
  Copy,
  Database,
  GripVertical,
  HardDrive,
  History,
  Layers3,
  Link2,
  LayoutDashboard,
  Monitor,
  MonitorPlay,
  MousePointer2,
  RadioTower,
  RotateCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
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
  isConnectableType,
  migrateInfrastructureNodes,
  monthlyCostFor,
  nodeReference,
  type InfrastructureConfig,
  type InfrastructureNode,
  type InfrastructureType,
} from "@/lib/infrastructure";
import { simulateX402Settlement } from "@/lib/x402-mock";

const nodeTypes = { infrastructure: InfrastructureNodeCard };
const STORAGE_KEY = "canvasops.graph.v2";
const POLICY_STORAGE_KEY = "canvasops.policy.v1";

type EditablePolicy = {
  maxMonthlyCost?: number;
  requiredRegions: string[];
  minimumReplicas: number;
};

const regionOptions = [
  { value: "bom-1", label: "Mumbai" },
  { value: "sin-1", label: "Singapore" },
  { value: "fra-1", label: "Frankfurt" },
  { value: "iad-1", label: "Virginia" },
] as const;

const policyPresets = {
  economical: {
    label: "Economical",
    policy: {
      maxMonthlyCost: 180,
      requiredRegions: ["bom-1"],
      minimumReplicas: 1,
    },
  },
  balanced: {
    label: "Balanced",
    policy: {
      maxMonthlyCost: 300,
      requiredRegions: ["bom-1", "sin-1"],
      minimumReplicas: 2,
    },
  },
  resilient: {
    label: "Resilient",
    policy: {
      maxMonthlyCost: 600,
      requiredRegions: ["bom-1", "sin-1", "fra-1"],
      minimumReplicas: 3,
    },
  },
} satisfies Record<string, { label: string; policy: EditablePolicy }>;

const defaultPolicy: EditablePolicy = policyPresets.balanced.policy;

function samePolicy(left: EditablePolicy, right: EditablePolicy) {
  return (
    left.maxMonthlyCost === right.maxMonthlyCost &&
    left.minimumReplicas === right.minimumReplicas &&
    [...left.requiredRegions].sort().join(",") ===
      [...right.requiredRegions].sort().join(",")
  );
}

function policyPresetName(policy: EditablePolicy) {
  return (
    Object.entries(policyPresets).find(([, preset]) =>
      samePolicy(policy, preset.policy),
    )?.[0] ?? "custom"
  );
}

function appliedPolicyPayload(
  policy: EditablePolicy,
  source: "active_policy" | "active_policy_with_overrides" = "active_policy",
) {
  return {
    source,
    preset: policyPresetName(policy),
    max_monthly_cost_usdc: policy.maxMonthlyCost ?? null,
    required_regions: [...policy.requiredRegions],
    minimum_replicas: policy.minimumReplicas,
  };
}

const configSchema = z
  .object({
    region: z.string().min(2).max(32).optional(),
    size: z.string().min(2).max(40).optional(),
    replicas: z.number().int().min(1).max(12).optional(),
    env_vars: z.record(z.string().min(1).max(64), z.string().max(500)).optional(),
    technology: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    owner: z.string().min(1).max(80).optional(),
    environment: z.string().min(1).max(40).optional(),
    custom_properties: z
      .record(z.string().min(1).max(64), z.string().max(500))
      .optional(),
    input_ports: z.array(z.string().min(1).max(64)).max(16).optional(),
    output_ports: z.array(z.string().min(1).max(64)).max(16).optional(),
    label: z.string().min(1).max(64).optional(),
  })
  .strict();

const analyzeArchitectureSchema = z.object({}).strict();
const getComponentCatalogSchema = z.object({}).strict();
const getSelectionContextSchema = z.object({}).strict();
const getActivePolicySchema = z.object({}).strict();
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
    connection_type: z.enum([
      "data",
      "request",
      "event",
      "replication",
      "dependency",
    ]),
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
    technology: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    owner: z.string().min(1).max(80).optional(),
    environment: z.string().min(1).max(40).optional(),
    custom_properties: z
      .record(z.string().min(1).max(64), z.string().max(500))
      .optional(),
    input_ports: z.array(z.string().min(1).max(64)).max(16).optional(),
    output_ports: z.array(z.string().min(1).max(64)).max(16).optional(),
    label: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (input) => Object.entries(input).some(([key, value]) => key !== "node_id" && value !== undefined),
    { message: "Provide at least one configuration field." },
  );
const groupNodesSchema = z
  .object({
    node_ids: z.array(z.string().min(1).max(128)).min(1).max(24),
    label: z.string().min(1).max(64).default("System Boundary"),
  })
  .strict();
const setGroupMembersSchema = z
  .object({
    group_id: z.string().min(1).max(128),
    node_ids: z.array(z.string().min(1).max(128)).max(24),
  })
  .strict();
const setGroupCollapsedSchema = z
  .object({
    group_id: z.string().min(1).max(128),
    collapsed: z.boolean(),
  })
  .strict();
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
      connection_type: z.enum([
        "data",
        "request",
        "event",
        "replication",
        "dependency",
      ]),
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
  z
    .object({
      action: z.literal("group_nodes"),
      ref: z.string().min(1).max(64),
      label: z.string().min(1).max(64),
      node_refs: z.array(z.string().min(1).max(128)).min(1).max(24),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_group_members"),
      group_ref: z.string().min(1).max(128),
      node_refs: z.array(z.string().min(1).max(128)).max(24),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_group_collapsed"),
      group_ref: z.string().min(1).max(128),
      collapsed: z.boolean(),
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
    case "group_nodes":
      return "group_nodes";
    case "set_group_members":
      return "set_group_members";
    case "set_group_collapsed":
      return "set_group_collapsed";
    default:
      return operation.action;
  }
}

const paletteIcons: Record<
  InfrastructureType,
  React.ComponentType<{ className?: string }>
> = {
  client: Monitor,
  service: ServerCog,
  "api-gateway": RadioTower,
  "load-balancer": Workflow,
  database: Database,
  cache: HardDrive,
  storage: HardDrive,
  queue: Workflow,
  "external-system": Cloud,
  "auth-service": ShieldCheck,
  worker: Cog,
  group: Layers3,
  note: StickyNote,
};

function judgeStepsForPolicy(policy: EditablePolicy): JudgeStep[] {
  const regions = policy.requiredRegions
    .map(
      (region) =>
        regionOptions.find((option) => option.value === region)?.label ?? region,
    )
    .join(" and ");
  const budget = policy.maxMonthlyCost
    ? ` and a $${policy.maxMonthlyCost} monthly budget`
    : "";

  return [
  {
    title: "Inspect the live graph",
    goal: "Prove that the agent can read the same architecture the human sees.",
    prompt: `Validate this architecture${regions ? ` for ${regions}` : ""}, with at least ${policy.minimumReplicas} replica${policy.minimumReplicas === 1 ? "" : "s"}${budget}.`,
    expected:
      "A deterministic resilience score, exact cost, regional coverage, and actionable findings in the activity log.",
  },
  {
    title: "Collaborate on a safe change",
    goal: "Show an agent planning real canvas mutations while the human stays in control.",
    prompt: `Propose a safe plan that satisfies the active policy${policy.maxMonthlyCost ? ` under $${policy.maxMonthlyCost}` : ""}. Ask me to approve before applying it.`,
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
}

const registeredToolNames = [
  "analyze_current_architecture",
  "get_active_policy",
  "get_component_catalog",
  "get_selection_context",
  "validate_architecture",
  "propose_architecture_plan",
  "add_infrastructure_node",
  "move_node",
  "remove_node",
  "connect_nodes",
  "disconnect_nodes",
  "update_node_config",
  "group_nodes",
  "set_group_members",
  "set_group_collapsed",
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

const DEFAULT_NODE_WIDTH = 210;
const DEFAULT_NODE_HEIGHT = 66;
const GROUP_PADDING_X = 54;
const GROUP_PADDING_TOP = 84;
const GROUP_PADDING_BOTTOM = 44;

function absoluteNodePosition(
  node: InfrastructureNode,
  nodes: InfrastructureNode[],
) {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function withoutParent(
  node: InfrastructureNode,
  position: { x: number; y: number },
): InfrastructureNode {
  const detachedNode: InfrastructureNode = {
    ...node,
    position,
    hidden: false,
  };
  delete detachedNode.parentId;
  delete detachedNode.extent;
  delete detachedNode.expandParent;
  return detachedNode;
}

function applyGroupMembership(
  nodes: InfrastructureNode[],
  groupId: string,
  memberIds: string[],
) {
  const group = nodes.find((node) => node.id === groupId);
  if (!group || group.data.type !== "group") {
    throw new Error(`${groupId} is not a system boundary.`);
  }
  const desiredIds = new Set(
    memberIds.filter((id) => {
      const node = nodes.find((candidate) => candidate.id === id);
      return node && node.id !== groupId && node.data.type !== "group";
    }),
  );
  const absolutePositions = new Map(
    nodes.map((node) => [node.id, absoluteNodePosition(node, nodes)]),
  );
  const desiredNodes = nodes.filter((node) => desiredIds.has(node.id));
  const currentGroupPosition = absolutePositions.get(group.id) ?? group.position;
  const minX =
    desiredNodes.length > 0
      ? Math.min(
          ...desiredNodes.map(
            (node) => absolutePositions.get(node.id)?.x ?? node.position.x,
          ),
        )
      : currentGroupPosition.x + GROUP_PADDING_X;
  const minY =
    desiredNodes.length > 0
      ? Math.min(
          ...desiredNodes.map(
            (node) => absolutePositions.get(node.id)?.y ?? node.position.y,
          ),
        )
      : currentGroupPosition.y + GROUP_PADDING_TOP;
  const maxX =
    desiredNodes.length > 0
      ? Math.max(
          ...desiredNodes.map(
            (node) =>
              (absolutePositions.get(node.id)?.x ?? node.position.x) +
              DEFAULT_NODE_WIDTH,
          ),
        )
      : minX + 420;
  const maxY =
    desiredNodes.length > 0
      ? Math.max(
          ...desiredNodes.map(
            (node) =>
              (absolutePositions.get(node.id)?.y ?? node.position.y) +
              DEFAULT_NODE_HEIGHT,
          ),
        )
      : minY + 190;
  const groupPosition = {
    x: minX - GROUP_PADDING_X,
    y: minY - GROUP_PADDING_TOP,
  };
  const groupSize = {
    width: Math.max(420, maxX - minX + GROUP_PADDING_X * 2),
    height: Math.max(
      250,
      maxY - minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
    ),
  };

  return nodes
    .map((node) => {
      if (node.id === groupId) {
        return {
          ...withoutParent(node, groupPosition),
          style: node.data.collapsed
            ? { ...node.style, width: 280, height: 72 }
            : { ...node.style, ...groupSize },
          data: { ...node.data, groupSize },
        } satisfies InfrastructureNode;
      }
      const absolute = absolutePositions.get(node.id) ?? node.position;
      if (desiredIds.has(node.id)) {
        return {
          ...node,
          parentId: groupId,
          extent: "parent" as const,
          expandParent: false,
          position: {
            x: absolute.x - groupPosition.x,
            y: absolute.y - groupPosition.y,
          },
          hidden: Boolean(group.data.collapsed),
          zIndex: 1,
        } satisfies InfrastructureNode;
      }
      if (node.parentId === groupId) return withoutParent(node, absolute);
      return node;
    })
    .sort((a, b) => {
      if (a.data.type === "group" && b.data.type !== "group") return -1;
      if (a.data.type !== "group" && b.data.type === "group") return 1;
      return 0;
    });
}

function setGroupCollapsedState(
  nodes: InfrastructureNode[],
  groupId: string,
  collapsed: boolean,
) {
  const group = nodes.find((node) => node.id === groupId);
  if (!group || group.data.type !== "group") {
    throw new Error(`${groupId} is not a system boundary.`);
  }
  const size = group.data.groupSize ?? { width: 620, height: 360 };
  return nodes.map((node) => {
    if (node.id === groupId) {
      return {
        ...node,
        style: collapsed
          ? { ...node.style, width: 280, height: 72 }
          : { ...node.style, ...size },
        data: { ...node.data, collapsed },
      } satisfies InfrastructureNode;
    }
    if (node.parentId === groupId) return { ...node, hidden: collapsed };
    return node;
  });
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
  const [rightPanel, setRightPanel] = useState<"agent" | "config" | "policy">(
    "agent",
  );
  const [policy, setPolicy] = useState<EditablePolicy>(defaultPolicy);
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
  const policyHydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const suspendAutosaveRef = useRef(false);
  const graphMutationLockedRef = useRef(false);
  const planExecutionControlRef = useRef<PlanExecutionControl | null>(null);
  const dragStartRef = useRef<ReturnType<typeof cloneGraph> | null>(null);
  const visualChangeTimerRef = useRef<number | null>(null);
  const paymentResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const proposalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const replicaMenuRef = useRef<HTMLDetailsElement | null>(null);

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
            JSON.stringify({
              data: previous.data,
              position: previous.position,
              parentId: previous.parentId,
              hidden: previous.hidden,
              style: previous.style,
            }) !==
              JSON.stringify({
                data: node.data,
                position: node.position,
                parentId: node.parentId,
                hidden: node.hidden,
                style: node.style,
              })
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
          const migratedNodes = migrateInfrastructureNodes(parsed.nodes);
          applyGraph(migratedNodes, parsed.edges);
          nextIdRef.current = nextNodeId(migratedNodes);
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      hydratedRef.current = true;
    }
  }, [applyGraph]);

  useEffect(() => {
    let nextPolicy: EditablePolicy | null = null;
    try {
      const saved = window.localStorage.getItem(POLICY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<EditablePolicy>;
        nextPolicy = {
          maxMonthlyCost:
            typeof parsed.maxMonthlyCost === "number" &&
            parsed.maxMonthlyCost > 0
              ? Math.min(parsed.maxMonthlyCost, 100_000)
              : undefined,
          requiredRegions: Array.isArray(parsed.requiredRegions)
            ? parsed.requiredRegions.filter((region): region is string =>
                regionOptions.some((option) => option.value === region),
              )
            : defaultPolicy.requiredRegions,
          minimumReplicas:
            typeof parsed.minimumReplicas === "number"
              ? Math.min(12, Math.max(1, Math.round(parsed.minimumReplicas)))
              : defaultPolicy.minimumReplicas,
        };
      }
    } catch {
      window.localStorage.removeItem(POLICY_STORAGE_KEY);
    }
    const hydratePolicy = window.setTimeout(() => {
      if (nextPolicy) setPolicy(nextPolicy);
      policyHydratedRef.current = true;
    }, 0);
    return () => window.clearTimeout(hydratePolicy);
  }, []);

  useEffect(() => {
    if (!policyHydratedRef.current) return;
    window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policy));
  }, [policy]);

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
            technology: input.config?.technology ?? baseConfig.technology,
            description: input.config?.description ?? baseConfig.description,
            owner: input.config?.owner ?? baseConfig.owner,
            environment: input.config?.environment ?? baseConfig.environment,
            customProperties:
              input.config?.custom_properties ?? baseConfig.customProperties,
            inputPorts: input.config?.input_ports ?? baseConfig.inputPorts,
            outputPorts: input.config?.output_ports ?? baseConfig.outputPorts,
          },
          monthlyCost: monthlyCostFor(input.type, replicas),
          status: "healthy" as const,
          collapsed: false,
          groupSize:
            input.type === "group"
              ? { width: 620, height: 360 }
              : undefined,
        },
        connectable: catalog.connectable,
        style:
          input.type === "group" ? { width: 620, height: 360 } : undefined,
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
      if (sourceId === targetId) throw new Error("A node cannot connect to itself.");
      const sourceNode = nodesRef.current.find((node) => node.id === sourceId);
      const targetNode = nodesRef.current.find((node) => node.id === targetId);
      if (
        !sourceNode ||
        !targetNode ||
        !isConnectableType(sourceNode.data.type) ||
        !isConnectableType(targetNode.data.type)
      ) {
        throw new Error("System boundaries and notes cannot be connection endpoints.");
      }
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
      const absolutePositions = new Map(
        nodesRef.current.map((node) => [
          node.id,
          absoluteNodePosition(node, nodesRef.current),
        ]),
      );
      let nextNodes = nodesRef.current
        .filter((node) => node.id !== nodeId)
        .map((node) =>
          target.data.type === "group" && node.parentId === nodeId
            ? withoutParent(
                node,
                absolutePositions.get(node.id) ?? node.position,
              )
            : node,
        );
      if (target.parentId) {
        const parentStillExists = nextNodes.some(
          (node) => node.id === target.parentId && node.data.type === "group",
        );
        if (parentStillExists) {
          nextNodes = applyGroupMembership(
            nextNodes,
            target.parentId,
            nextNodes
              .filter((node) => node.parentId === target.parentId)
              .map((node) => node.id),
          );
        }
      }
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
              technology: input.technology ?? node.data.config.technology,
              description: input.description ?? node.data.config.description,
              owner: input.owner ?? node.data.config.owner,
              environment:
                input.environment ?? node.data.config.environment,
              customProperties: input.custom_properties
                ? {
                    ...node.data.config.customProperties,
                    ...input.custom_properties,
                  }
                : node.data.config.customProperties,
              inputPorts: input.input_ports ?? node.data.config.inputPorts,
              outputPorts: input.output_ports ?? node.data.config.outputPorts,
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

  const groupInfrastructureNodes = useCallback(
    (input: z.infer<typeof groupNodesSchema>) => {
      const memberIds = Array.from(
        new Set(
          input.node_ids.map((reference) =>
            resolveNodeId(reference, nodesRef.current),
          ),
        ),
      );
      if (
        memberIds.some(
          (id) =>
            nodesRef.current.find((node) => node.id === id)?.data.type ===
            "group",
        )
      ) {
        throw new Error("System boundaries cannot be nested.");
      }
      const group = createNode({
        type: "group",
        x: 0,
        y: 0,
        config: { label: input.label },
      });
      const nextNodes = applyGroupMembership(
        [...nodesRef.current, group],
        group.id,
        memberIds,
      );
      commitGraph(
        `Grouped ${memberIds.length} component${memberIds.length === 1 ? "" : "s"} as ${input.label}`,
        nextNodes,
        edgesRef.current,
      );
      return {
        success: true,
        group_id: group.id,
        group_reference: nodeReference(group.id),
        member_node_ids: memberIds,
      };
    },
    [commitGraph, createNode],
  );

  const setInfrastructureGroupMembers = useCallback(
    (input: z.infer<typeof setGroupMembersSchema>) => {
      const groupId = resolveNodeId(input.group_id, nodesRef.current);
      const memberIds = Array.from(
        new Set(
          input.node_ids.map((reference) =>
            resolveNodeId(reference, nodesRef.current),
          ),
        ),
      );
      const nextNodes = applyGroupMembership(
        nodesRef.current,
        groupId,
        memberIds,
      );
      commitGraph(
        `Updated ${nodeReference(groupId)} membership`,
        nextNodes,
        edgesRef.current,
      );
      return { success: true, group_id: groupId, member_node_ids: memberIds };
    },
    [commitGraph],
  );

  const setInfrastructureGroupCollapsed = useCallback(
    (input: z.infer<typeof setGroupCollapsedSchema>) => {
      const groupId = resolveNodeId(input.group_id, nodesRef.current);
      const nextNodes = setGroupCollapsedState(
        nodesRef.current,
        groupId,
        input.collapsed,
      );
      commitGraph(
        `${input.collapsed ? "Collapsed" : "Expanded"} ${nodeReference(groupId)}`,
        nextNodes,
        edgesRef.current,
      );
      return { success: true, group_id: groupId, collapsed: input.collapsed };
    },
    [commitGraph],
  );

  const analyzeArchitecture = useCallback(() => {
    const validation = validateArchitecture(
      nodesRef.current,
      edgesRef.current,
      policy,
    );
    return {
      node_count: nodesRef.current.length,
      edge_count: edgesRef.current.length,
      estimated_monthly_cost_usdc: validation.estimatedMonthlyCostUsdc,
      architecture_hash: architectureHash(nodesRef.current, edgesRef.current),
      policy_status: validation.status,
      resilience_score: validation.resilienceScore,
      budget_headroom_usdc: validation.budgetHeadroomUsdc,
      disconnected_node_ids: validation.disconnectedNodeIds,
      applied_policy: appliedPolicyPayload(policy),
      policy_findings: validation.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        node_ids: finding.nodeIds,
      })),
      nodes: nodesRef.current.map((node) => ({
        id: node.id,
        reference: nodeReference(node.id),
        type: node.data.type,
        label: node.data.label,
        position: node.position,
        parent_group_id: node.parentId ?? null,
        collapsed: node.data.type === "group" ? Boolean(node.data.collapsed) : undefined,
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
  }, [policy]);

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
        parent_group_id: node.parentId ?? null,
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
    setPolicy({
      ...defaultPolicy,
      requiredRegions: [...defaultPolicy.requiredRegions],
    });
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
            node.data.type === "service" &&
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
          const target = simulatedNodes.find((node) => node.id === nodeId);
          const absolutePositions = new Map(
            simulatedNodes.map((node) => [
              node.id,
              absoluteNodePosition(node, simulatedNodes),
            ]),
          );
          simulatedNodes = simulatedNodes
            .filter((node) => node.id !== nodeId)
            .map((node) =>
              target?.data.type === "group" && node.parentId === nodeId
                ? withoutParent(
                    node,
                    absolutePositions.get(node.id) ?? node.position,
                  )
                : node,
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
          const sourceNode = simulatedNodes.find((node) => node.id === source);
          const targetNode = simulatedNodes.find((node) => node.id === target);
          if (
            !sourceNode ||
            !targetNode ||
            !isConnectableType(sourceNode.data.type) ||
            !isConnectableType(targetNode.data.type)
          ) {
            throw new Error(
              "System boundaries and notes cannot be connection endpoints.",
            );
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
        } else if (operation.action === "group_nodes") {
          if (aliases.has(operation.ref)) {
            throw new Error(`Duplicate plan ref: ${operation.ref}.`);
          }
          const memberIds = operation.node_refs.map(resolveRef);
          const id = `group-${simulatedId++}`;
          aliases.set(operation.ref, id);
          const group = createNode(
            {
              type: "group",
              x: 0,
              y: 0,
              config: { label: operation.label },
            },
            id,
          );
          simulatedNodes = applyGroupMembership(
            [...simulatedNodes, group],
            id,
            memberIds,
          );
          changes.push(
            `Group ${memberIds.map(nodeReference).join(", ")} as ${operation.label}`,
          );
        } else if (operation.action === "set_group_members") {
          const groupId = resolveRef(operation.group_ref);
          const memberIds = operation.node_refs.map(resolveRef);
          simulatedNodes = applyGroupMembership(
            simulatedNodes,
            groupId,
            memberIds,
          );
          changes.push(`Update ${nodeReference(groupId)} membership`);
        } else if (operation.action === "set_group_collapsed") {
          const groupId = resolveRef(operation.group_ref);
          simulatedNodes = setGroupCollapsedState(
            simulatedNodes,
            groupId,
            operation.collapsed,
          );
          changes.push(
            `${operation.collapsed ? "Collapse" : "Expand"} ${nodeReference(groupId)}`,
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
                  technology:
                    operation.config.technology ??
                    node.data.config.technology,
                  description:
                    operation.config.description ??
                    node.data.config.description,
                  owner: operation.config.owner ?? node.data.config.owner,
                  environment:
                    operation.config.environment ??
                    node.data.config.environment,
                  customProperties: operation.config.custom_properties
                    ? {
                        ...node.data.config.customProperties,
                        ...operation.config.custom_properties,
                      }
                    : node.data.config.customProperties,
                  inputPorts:
                    operation.config.input_ports ??
                    node.data.config.inputPorts,
                  outputPorts:
                    operation.config.output_ports ??
                    node.data.config.outputPorts,
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
        "Read the complete live graph, positions, configuration, connections, cost, active-policy findings, resilience score, and architecture fingerprint. Call before modifying an unfamiliar architecture.",
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
      name: "get_active_policy",
      description:
        "Read the exact user-selected architecture policy, including its preset, monthly budget, required regions, minimum replicas, and always-on safety checks. Call before validating or proposing policy-sensitive changes.",
      inputSchema: getActivePolicySchema,
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const parsed = getActivePolicySchema.parse(input);
        const result = {
          ...appliedPolicyPayload(policy),
          always_on_checks: [
            "disconnected_resources",
            "invalid_dependencies",
            "single_points_of_failure",
            "global_entry_point",
          ],
        };
        logToolEvent(
          "get_active_policy",
          `Read ${result.preset} policy: ${result.minimum_replicas} replica minimum${result.max_monthly_cost_usdc === null ? " with no budget limit" : ` under $${result.max_monthly_cost_usdc}/month`}.`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, policy],
  );

  useWebMCP(
    {
      name: "get_component_catalog",
      description:
        "Read the complete supported semantic component vocabulary and defaults. Call before designing or expanding an architecture. Use these types exactly and never invent unsupported component types.",
      inputSchema: getComponentCatalogSchema,
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const parsed = getComponentCatalogSchema.parse(input);
        const components = infrastructureTypes.map((type) => ({
          type,
          ...infrastructureCatalog[type],
        }));
        logToolEvent(
          "get_component_catalog",
          `Read ${components.length} supported semantic component types.`,
          parsed,
        );
        return {
          components,
          instruction:
            "Use existing canvas components before creating new ones. Create only component types listed here; express providers and products through technology and custom properties.",
        };
      },
    },
    [logToolEvent],
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
        const appliedPolicy: EditablePolicy = {
          maxMonthlyCost:
            parsed.max_monthly_cost_usdc ?? policy.maxMonthlyCost,
          requiredRegions: parsed.required_regions ?? policy.requiredRegions,
          minimumReplicas: parsed.minimum_replicas ?? policy.minimumReplicas,
        };
        const hasOverrides = Object.values(parsed).some(
          (value) => value !== undefined,
        );
        const result = validateArchitecture(
          nodesRef.current,
          edgesRef.current,
          appliedPolicy,
        );
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
          applied_policy: appliedPolicyPayload(
            appliedPolicy,
            hasOverrides ? "active_policy_with_overrides" : "active_policy",
          ),
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
    [logToolEvent, policy],
  );

  useWebMCP(
    {
      name: "add_infrastructure_node",
      description:
        "Add exactly one supported semantic component from the shared catalog at deterministic coordinates. Never invent a type outside the schema. Analyze first to avoid overlap; for multi-step changes, prefer propose_architecture_plan.",
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
        "Update a node's common semantic metadata, label, technology, ownership, environment, ports, region, sizing, replicas, custom properties, and/or environment variables. node_id accepts an ID, short reference, or unambiguous label.",
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
      name: "group_nodes",
      description:
        "Create a system boundary around existing nodes. Boundaries cannot be nested. References accept permanent IDs, short references, or unambiguous labels.",
      inputSchema: groupNodesSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = groupNodesSchema.parse(input);
        const result = groupInfrastructureNodes(parsed);
        logToolEvent(
          "group_nodes",
          `Created ${result.group_reference} around ${result.member_node_ids.length} component(s).`,
          parsed,
        );
        return result;
      },
    },
    [groupInfrastructureNodes, logToolEvent],
  );

  useWebMCP(
    {
      name: "set_group_members",
      description:
        "Replace the complete member list of an existing system boundary. Omitted previous members are safely detached, not deleted.",
      inputSchema: setGroupMembersSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = setGroupMembersSchema.parse(input);
        const result = setInfrastructureGroupMembers(parsed);
        logToolEvent(
          "set_group_members",
          `Updated ${nodeReference(result.group_id)} to ${result.member_node_ids.length} member(s).`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, setInfrastructureGroupMembers],
  );

  useWebMCP(
    {
      name: "set_group_collapsed",
      description:
        "Collapse or expand a system boundary without deleting its members or connections.",
      inputSchema: setGroupCollapsedSchema,
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const parsed = setGroupCollapsedSchema.parse(input);
        const result = setInfrastructureGroupCollapsed(parsed);
        logToolEvent(
          "set_group_collapsed",
          `${parsed.collapsed ? "Collapsed" : "Expanded"} ${nodeReference(result.group_id)}.`,
          parsed,
        );
        return result;
      },
    },
    [logToolEvent, setInfrastructureGroupCollapsed],
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
      execute: (input) => {
        const parsed = proposeArchitecturePlanSchema.parse(input);
        return proposeArchitecturePlan({
          ...parsed,
          max_monthly_cost_usdc:
            parsed.max_monthly_cost_usdc ?? policy.maxMonthlyCost,
        });
      },
    },
    [policy.maxMonthlyCost, proposeArchitecturePlan],
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
      validateArchitecture(nodes, edges, policy),
    [edges, nodes, policy],
  );
  const activePolicyPreset = useMemo(
    () => policyPresetName(policy),
    [policy],
  );
  const activeJudgeSteps = useMemo(() => judgeStepsForPolicy(policy), [policy]);
  const browserPrompts = useMemo(
    () => activeJudgeSteps.map((step) => step.prompt),
    [activeJudgeSteps],
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
        node.data.type === "service" &&
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
      if (connection.source === connection.target) return;
      const sourceNode = nodesRef.current.find(
        (node) => node.id === connection.source,
      );
      const targetNode = nodesRef.current.find(
        (node) => node.id === connection.target,
      );
      if (
        !sourceNode ||
        !targetNode ||
        !isConnectableType(sourceNode.data.type) ||
        !isConnectableType(targetNode.data.type)
      ) {
        return;
      }
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
        const removedGroups = new Set(
          nodesRef.current
            .filter(
              (node) =>
                removedIds.has(node.id) && node.data.type === "group",
            )
            .map((node) => node.id),
        );
        const absolutePositions = new Map(
          nodesRef.current.map((node) => [
            node.id,
            absoluteNodePosition(node, nodesRef.current),
          ]),
        );
        let nextNodes = applyNodeChanges(changes, nodesRef.current).map(
          (node) =>
            node.parentId && removedGroups.has(node.parentId)
              ? withoutParent(
                  node,
                  absolutePositions.get(node.id) ?? node.position,
                )
              : node,
        );
        const affectedParentIds = new Set(
          nodesRef.current
            .filter(
              (node) =>
                removedIds.has(node.id) &&
                node.parentId &&
                !removedGroups.has(node.parentId),
            )
            .map((node) => node.parentId as string),
        );
        for (const parentId of affectedParentIds) {
          if (!nextNodes.some((node) => node.id === parentId)) continue;
          nextNodes = applyGroupMembership(
            nextNodes,
            parentId,
            nextNodes
              .filter((node) => node.parentId === parentId)
              .map((node) => node.id),
          );
        }
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

  const handleGroupSelection = useCallback(() => {
    const groupableIds = selectedNodeIdsRef.current.filter(
      (id) =>
        nodesRef.current.find((node) => node.id === id)?.data.type !== "group",
    );
    if (groupableIds.length === 0) return;
    const result = groupInfrastructureNodes({
      node_ids: groupableIds,
      label: "System Boundary",
    });
    setSelectedNodeIds([result.group_id]);
    setSelectedNodeId(result.group_id);
    setSelectedEdgeId(null);
    setRightPanel("config");
  }, [groupInfrastructureNodes]);

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
        <div className="topbar-actions flex items-center gap-2">
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
            <span>Components</span>
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
                      {catalog.category} · {catalog.cost === 0 ? "Free" : `$${catalog.cost}/mo`}
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
            {selectedNodeIds.length > 0 ? (
              <button
                className="group-selection-button"
                onClick={handleGroupSelection}
                disabled={
                  planExecution !== null ||
                  selectedNodeIds.every(
                    (id) =>
                      nodes.find((node) => node.id === id)?.data.type ===
                      "group",
                  )
                }
              >
                <Layers3 className="size-3" />
                Group {selectedNodeIds.length}
              </button>
            ) : null}
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
                {judgeStep + 1}/{activeJudgeSteps.length}
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
              className={rightPanel === "policy" ? "active" : ""}
              onClick={() => setRightPanel("policy")}
            >
              <ShieldCheck className="size-3.5" />
              Policy
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
                  steps={activeJudgeSteps}
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
          ) : rightPanel === "policy" ? (
            <div className="policy-panel">
              <div className="policy-heading">
                <div>
                  <span className="policy-eyebrow">Live guardrails</span>
                  <h2>Architecture policy</h2>
                  <p>Changes apply instantly and are saved on this device.</p>
                </div>
                <span className={`policy-status ${liveValidation.status}`}>
                  {liveValidation.status}
                </span>
              </div>

              <section className="policy-section">
                <div className="policy-section-title">
                  <span>Preset</span>
                  <small>{activePolicyPreset}</small>
                </div>
                <div className="policy-presets">
                  {Object.entries(policyPresets).map(([key, preset]) => (
                    <button
                      key={key}
                      className={activePolicyPreset === key ? "active" : ""}
                      onClick={() =>
                        setPolicy({
                          ...preset.policy,
                          requiredRegions: [...preset.policy.requiredRegions],
                        })
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="policy-section policy-fields">
                <div className="policy-toggle-row">
                  <div>
                    <strong>Monthly budget</strong>
                    <span>Block plans that exceed the limit</span>
                  </div>
                  <label className="policy-switch">
                    <input
                      type="checkbox"
                      checked={policy.maxMonthlyCost !== undefined}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          maxMonthlyCost: event.target.checked
                            ? current.maxMonthlyCost ?? 300
                            : undefined,
                        }))
                      }
                    />
                    <span />
                  </label>
                </div>

                {policy.maxMonthlyCost !== undefined ? (
                  <label className="config-field">
                    <span>Maximum monthly cost (USDC)</span>
                    <div className="policy-money-input">
                      <span>$</span>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        value={policy.maxMonthlyCost}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          if (!Number.isFinite(nextValue)) return;
                          setPolicy((current) => ({
                            ...current,
                            maxMonthlyCost: Math.min(
                              100_000,
                              Math.max(1, nextValue),
                            ),
                          }));
                        }}
                      />
                    </div>
                    <small className="policy-field-note">
                      {liveValidation.budgetHeadroomUsdc !== null &&
                      liveValidation.budgetHeadroomUsdc >= 0
                        ? `$${liveValidation.budgetHeadroomUsdc} headroom remaining`
                        : `$${Math.abs(liveValidation.budgetHeadroomUsdc ?? 0)} over budget`}
                    </small>
                  </label>
                ) : null}

                <div className="config-field">
                  <span>Minimum replicas</span>
                  <details
                    className="policy-select"
                    ref={replicaMenuRef}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        event.currentTarget.removeAttribute("open");
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        replicaMenuRef.current?.removeAttribute("open");
                        replicaMenuRef.current
                          ?.querySelector("summary")
                          ?.focus();
                      }
                    }}
                  >
                    <summary>
                      <span>
                        {policy.minimumReplicas} replica
                        {policy.minimumReplicas === 1 ? "" : "s"}
                      </span>
                      <ChevronDown className="size-4" />
                    </summary>
                    <div
                      className="policy-select-menu"
                      role="listbox"
                      aria-label="Minimum replicas"
                    >
                      {Array.from({ length: 12 }, (_, index) => index + 1).map(
                        (replicas) => (
                          <button
                            key={replicas}
                            type="button"
                            role="option"
                            aria-selected={policy.minimumReplicas === replicas}
                            onClick={() => {
                              setPolicy((current) => ({
                                ...current,
                                minimumReplicas: replicas,
                              }));
                              replicaMenuRef.current?.removeAttribute("open");
                            }}
                          >
                            <span>
                              {replicas} replica{replicas === 1 ? "" : "s"}
                            </span>
                            {policy.minimumReplicas === replicas ? (
                              <Check className="size-3.5" />
                            ) : null}
                          </button>
                        ),
                      )}
                    </div>
                  </details>
                </div>

                <fieldset className="policy-regions">
                  <legend>Required regions</legend>
                  <div>
                    {regionOptions.map((region) => (
                      <label key={region.value}>
                        <input
                          type="checkbox"
                          checked={policy.requiredRegions.includes(region.value)}
                          onChange={(event) =>
                            setPolicy((current) => ({
                              ...current,
                              requiredRegions: event.target.checked
                                ? [...current.requiredRegions, region.value]
                                : current.requiredRegions.filter(
                                    (value) => value !== region.value,
                                  ),
                            }))
                          }
                        />
                        <span>
                          <strong>{region.label}</strong>
                          <small>{region.value}</small>
                        </span>
                        <Check className="size-3.5" />
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>

              <section className="policy-result">
                <div>
                  <span>
                    <ShieldCheck className="size-3.5" />
                    Live result
                  </span>
                  <strong>{liveValidation.resilienceScore}/100</strong>
                </div>
                <p>
                  {liveValidation.findings.length === 0
                    ? "This architecture satisfies the active policy."
                    : `${liveValidation.findings.length} finding${liveValidation.findings.length === 1 ? "" : "s"} need attention.`}
                </p>
                {liveValidation.findings.slice(0, 4).map((finding) => (
                  <div className="policy-finding" key={finding.id}>
                    <span data-severity={finding.severity} />
                    <div>
                      <strong>{finding.title}</strong>
                      <small>{finding.detail}</small>
                    </div>
                  </div>
                ))}
              </section>

              <section className="policy-fixed-rules">
                <strong>Always-on safety checks</strong>
                <p>
                  Invalid connections, disconnected resources, global routing,
                  and single points of failure remain enforced.
                </p>
              </section>

              <Button
                variant="secondary"
                className="w-full"
                onClick={() =>
                  setPolicy({
                    ...defaultPolicy,
                    requiredRegions: [...defaultPolicy.requiredRegions],
                  })
                }
              >
                <RotateCcw className="size-3.5" />
                Restore balanced defaults
              </Button>
            </div>
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
                <span>Technology</span>
                <input
                  key={`${selectedNode.id}:${selectedNode.data.config.technology}`}
                  defaultValue={selectedNode.data.config.technology}
                  maxLength={80}
                  onBlur={(event) =>
                    updateSelectedConfig({ technology: event.target.value })
                  }
                />
              </label>

              <label className="config-field">
                <span>Description</span>
                <textarea
                  key={`${selectedNode.id}:${selectedNode.data.config.description}`}
                  rows={3}
                  defaultValue={selectedNode.data.config.description}
                  maxLength={500}
                  onBlur={(event) =>
                    updateSelectedConfig({ description: event.target.value })
                  }
                />
              </label>

              <label className="config-field">
                <span>Owner / team</span>
                <input
                  key={`${selectedNode.id}:${selectedNode.data.config.owner}`}
                  defaultValue={selectedNode.data.config.owner}
                  maxLength={80}
                  onBlur={(event) =>
                    updateSelectedConfig({ owner: event.target.value })
                  }
                />
              </label>

              <label className="config-field">
                <span>Environment</span>
                <select
                  value={selectedNode.data.config.environment}
                  onChange={(event) =>
                    updateSelectedConfig({ environment: event.target.value })
                  }
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                  <option value="shared">Shared</option>
                </select>
              </label>

              {selectedNode.data.type === "group" ? (
                <div className="group-config-section">
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() =>
                      setInfrastructureGroupCollapsed({
                        group_id: selectedNode.id,
                        collapsed: !selectedNode.data.collapsed,
                      })
                    }
                  >
                    <Layers3 className="size-4" />
                    {selectedNode.data.collapsed ? "Expand group" : "Collapse group"}
                  </Button>
                  <div className="group-members-title">
                    Members
                    <span>
                      {nodes.filter((node) => node.parentId === selectedNode.id).length}
                    </span>
                  </div>
                  <div className="group-member-list">
                    {nodes
                      .filter(
                        (node) =>
                          node.id !== selectedNode.id &&
                          node.data.type !== "group",
                      )
                      .map((node) => {
                        const checked = node.parentId === selectedNode.id;
                        return (
                          <label className="group-member-option" key={node.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const members = new Set(
                                  nodes
                                    .filter(
                                      (candidate) =>
                                        candidate.parentId === selectedNode.id,
                                    )
                                    .map((candidate) => candidate.id),
                                );
                                if (event.target.checked) members.add(node.id);
                                else members.delete(node.id);
                                setInfrastructureGroupMembers({
                                  group_id: selectedNode.id,
                                  node_ids: [...members],
                                });
                              }}
                            />
                            <code>{nodeReference(node.id)}</code>
                            <span>{node.data.label}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              ) : null}

              {selectedNode.data.type !== "group" &&
              selectedNode.data.type !== "note" ? (
                <>

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

              <label className="config-field">
                <span>Input ports</span>
                <input
                  key={`${selectedNode.id}:${selectedNode.data.config.inputPorts.join(",")}`}
                  defaultValue={selectedNode.data.config.inputPorts.join(", ")}
                  placeholder="request, event"
                  onBlur={(event) =>
                    updateSelectedConfig({
                      inputPorts: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>

              <label className="config-field">
                <span>Output ports</span>
                <input
                  key={`${selectedNode.id}:${selectedNode.data.config.outputPorts.join(",")}`}
                  defaultValue={selectedNode.data.config.outputPorts.join(", ")}
                  placeholder="response, event"
                  onBlur={(event) =>
                    updateSelectedConfig({
                      outputPorts: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>

              <label className="config-field">
                <span>Custom properties</span>
                <textarea
                  key={`${selectedNode.id}:${JSON.stringify(selectedNode.data.config.customProperties)}`}
                  rows={4}
                  defaultValue={Object.entries(
                    selectedNode.data.config.customProperties,
                  )
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n")}
                  placeholder={"KEY=value\nANOTHER=value"}
                  onBlur={(event) =>
                    updateSelectedConfig({
                      customProperties: Object.fromEntries(
                        event.target.value
                          .split("\n")
                          .filter((line) => line.includes("="))
                          .map((line) => {
                            const [key, ...rest] = line.split("=");
                            return [key.trim(), rest.join("=").trim()];
                          })
                          .filter(([key]) => key),
                      ),
                    })
                  }
                />
              </label>
                </>
              ) : null}

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
                {selectedNode.data.type === "group"
                  ? "Remove group, keep members"
                  : "Remove component"}
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
                  {nodes.filter((node) => isConnectableType(node.data.type)).map((node) => (
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
                    {nodes.filter((node) => isConnectableType(node.data.type)).map((node) => (
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
