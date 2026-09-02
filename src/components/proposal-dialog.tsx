"use client";

import { ArrowRight, CheckCircle2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export type ArchitectureProposal = {
  summary: string;
  changes: string[];
  beforeCost: number;
  afterCost: number;
  maxMonthlyCost?: number;
  architectureHash: string;
};

type ProposalDialogProps = {
  proposal: ArchitectureProposal | null;
  onApprove: () => void;
  onReject: () => void;
};

export function ProposalDialog({
  proposal,
  onApprove,
  onReject,
}: ProposalDialogProps) {
  const budgetOkay =
    proposal?.maxMonthlyCost === undefined ||
    proposal.afterCost <= proposal.maxMonthlyCost;

  return (
    <Dialog open={proposal !== null} onOpenChange={(open) => !open && onReject()}>
      <DialogContent>
        <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
          <ShieldCheck className="size-5" />
        </div>
        <DialogTitle className="text-xl font-semibold tracking-tight">
          Review agent plan
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-zinc-400">
          {proposal?.summary}
        </DialogDescription>

        <div className="my-5 flex items-center justify-between rounded-xl border border-white/8 bg-black/20 p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-600">
              Current
            </div>
            <div className="mt-1 text-xl font-semibold text-zinc-200">
              ${proposal?.beforeCost}
            </div>
          </div>
          <ArrowRight className="size-4 text-zinc-600" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600">
              Proposed
            </div>
            <div className="mt-1 text-xl font-semibold text-white">
              ${proposal?.afterCost}
            </div>
          </div>
        </div>

        <div className="max-h-44 space-y-2 overflow-auto">
          {proposal?.changes.map((change) => (
            <div
              className="flex gap-2 rounded-lg border border-white/6 bg-white/[.02] px-3 py-2 text-xs text-zinc-400"
              key={change}
            >
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-lime-300" />
              {change}
            </div>
          ))}
        </div>

        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            budgetOkay
              ? "border-lime-300/15 bg-lime-300/5 text-lime-200"
              : "border-red-400/20 bg-red-400/5 text-red-300"
          }`}
        >
          {proposal?.maxMonthlyCost === undefined
            ? "No budget constraint supplied."
            : budgetOkay
              ? `$${(proposal.maxMonthlyCost - proposal.afterCost).toFixed(0)} monthly headroom remains.`
              : `Plan exceeds the monthly limit by $${(proposal.afterCost - proposal.maxMonthlyCost).toFixed(0)}.`}
        </div>

        <div className="mt-3 rounded-lg border border-cyan-300/10 bg-cyan-300/[.035] px-3 py-2 text-[11px] leading-5 text-cyan-100/70">
          After approval, CanvasOps applies each operation visibly. You can pause,
          resume, or cancel and roll back; the completed plan stays one Undo action.
        </div>

        <div className="mt-3 font-mono text-[9px] text-zinc-600">
          Preview {proposal?.architectureHash}
        </div>

        <div className="mt-5 flex gap-3">
          <Button className="flex-1" variant="secondary" onClick={onReject}>
            <X className="size-4" />
            Reject
          </Button>
          <Button className="flex-1" onClick={onApprove} disabled={!budgetOkay}>
            Approve & watch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
