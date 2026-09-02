"use client";

import {
  CheckCircle2,
  CircleStop,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

export type PlanExecutionView = {
  summary: string;
  steps: string[];
  currentStep: number;
  currentLabel: string;
  status: "running" | "paused" | "rolling-back" | "completed";
  beforeCost: number;
  targetCost: number;
};

type PlanExecutionPanelProps = {
  execution: PlanExecutionView;
  liveCost: number;
  liveResilience: number;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
};

export function PlanExecutionPanel({
  execution,
  liveCost,
  liveResilience,
  onPause,
  onResume,
  onCancel,
}: PlanExecutionPanelProps) {
  const total = execution.steps.length;
  const progress = total === 0 ? 0 : (execution.currentStep / total) * 100;
  const isRunning = execution.status === "running";
  const isPaused = execution.status === "paused";
  const isRollingBack = execution.status === "rolling-back";
  const isCompleted = execution.status === "completed";

  return (
    <section
      className="plan-execution-panel"
      aria-label="Agent plan execution progress"
      aria-live="polite"
    >
      <div className="plan-execution-heading">
        <span>
          {isCompleted ? (
            <CheckCircle2 className="size-4" />
          ) : isRollingBack ? (
            <RotateCcw className="size-4" />
          ) : (
            <LoaderCircle className="size-4 animate-spin" />
          )}
          {isCompleted
            ? "Plan complete"
            : isRollingBack
              ? "Rolling back"
              : isPaused
                ? "Execution paused"
                : "Agent applying plan"}
        </span>
        <strong>
          {execution.currentStep}/{total}
        </strong>
      </div>

      <div className="plan-progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="plan-current-step">
        <small>Current operation</small>
        <p>{execution.currentLabel}</p>
        <span>{execution.summary}</span>
      </div>

      <div className="plan-live-metrics">
        <span>
          <small>Started</small>
          <strong>${execution.beforeCost}</strong>
        </span>
        <span>
          <small>Live cost</small>
          <strong>${liveCost}</strong>
        </span>
        <span>
          <small>Resilience</small>
          <strong>{liveResilience}</strong>
        </span>
        <span>
          <small>Target</small>
          <strong>${execution.targetCost}</strong>
        </span>
      </div>

      {isRunning || isPaused ? (
        <div className="plan-execution-actions">
          <button onClick={isPaused ? onResume : onPause}>
            {isPaused ? (
              <Play className="size-3.5" />
            ) : (
              <Pause className="size-3.5" />
            )}
            {isPaused ? "Resume" : "Pause"}
          </button>
          <button className="cancel" onClick={onCancel}>
            <CircleStop className="size-3.5" />
            Cancel & rollback
          </button>
        </div>
      ) : null}
    </section>
  );
}
