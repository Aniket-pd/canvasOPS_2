"use client";

import {
  Cloud,
  Cog,
  Database,
  HardDrive,
  Layers3,
  Monitor,
  RadioTower,
  ServerCog,
  ShieldCheck,
  StickyNote,
  Workflow,
} from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  infrastructureCatalog,
  nodeReference,
  type InfrastructureNode,
} from "@/lib/infrastructure";

const icons = {
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

export function InfrastructureNodeCard({
  id,
  data,
  selected,
}: NodeProps<InfrastructureNode>) {
  const catalog = infrastructureCatalog[data.type];
  const Icon = icons[data.type];

  if (data.type === "group") {
    return (
      <div
        className="system-group-node"
        data-collapsed={data.collapsed ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        style={{ "--node-accent": catalog.accent } as React.CSSProperties}
      >
        <div className="system-group-title">
          <Icon className="size-4" />
          <strong>{data.label}</strong>
          <code>{nodeReference(id)}</code>
          <span>{data.collapsed ? "Collapsed" : "System boundary"}</span>
        </div>
        {!data.collapsed ? (
          <p>{data.config.description || catalog.description}</p>
        ) : null}
      </div>
    );
  }

  if (data.type === "note") {
    return (
      <div
        className="design-note-node"
        data-selected={selected ? "true" : "false"}
        style={{ "--node-accent": catalog.accent } as React.CSSProperties}
      >
        <div>
          <Icon className="size-4" />
          <strong>{data.label}</strong>
          <code>{nodeReference(id)}</code>
        </div>
        <p>{data.config.description || "Add a design decision or requirement."}</p>
      </div>
    );
  }

  return (
    <div
      className="infrastructure-node"
      data-selected={selected ? "true" : "false"}
      data-status={data.status}
      style={{ "--node-accent": catalog.accent } as React.CSSProperties}
    >
      {catalog.connectable ? (
        <Handle type="target" position={Position.Left} />
      ) : null}
      <div className="node-icon">
        <Icon className="size-4" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-[13px] font-semibold text-zinc-100">
            {data.label}
          </div>
          <code className="node-reference">{nodeReference(id)}</code>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="status-dot" />
          {data.config.technology} · {data.config.region}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[11px] font-semibold text-zinc-300">
          ${data.monthlyCost}
        </div>
        <div className="text-[9px] text-zinc-600">/mo</div>
      </div>
      {catalog.connectable ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}
