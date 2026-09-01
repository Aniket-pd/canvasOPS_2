"use client";

import {
  Database,
  HardDrive,
  RadioTower,
  ServerCog,
  Workflow,
} from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  infrastructureCatalog,
  type InfrastructureNode,
} from "@/lib/infrastructure";

const icons = {
  "edge-worker": RadioTower,
  "api-service": ServerCog,
  database: Database,
  storage: HardDrive,
  queue: Workflow,
};

export function InfrastructureNodeCard({
  data,
  selected,
}: NodeProps<InfrastructureNode>) {
  const catalog = infrastructureCatalog[data.type];
  const Icon = icons[data.type];

  return (
    <div
      className="infrastructure-node"
      data-selected={selected ? "true" : "false"}
      data-status={data.status}
      style={{ "--node-accent": catalog.accent } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-icon">
        <Icon className="size-4" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-zinc-100">
          {data.label}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="status-dot" />
          {data.config.region} · {data.config.replicas} replica
          {data.config.replicas === 1 ? "" : "s"}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[11px] font-semibold text-zinc-300">
          ${data.monthlyCost}
        </div>
        <div className="text-[9px] text-zinc-600">/mo</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
