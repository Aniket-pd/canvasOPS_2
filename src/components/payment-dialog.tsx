"use client";

import { Check, LoaderCircle, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type PaymentDialogProps = {
  open: boolean;
  total: number;
  status: "review" | "signing" | "settled";
  transaction?: string;
  architectureHash?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function PaymentDialog({
  open,
  total,
  status,
  transaction,
  architectureHash,
  onOpenChange,
  onConfirm,
  onCancel,
}: PaymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {status === "settled" ? (
          <div className="py-3 text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-lime-300 text-zinc-950">
              <Check className="size-6" strokeWidth={3} />
            </div>
            <DialogTitle className="text-xl font-semibold">
              Deployment authorized
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-zinc-400">
              Mock x402 settlement completed on Base Sepolia.
            </DialogDescription>
            <div className="mt-5 rounded-xl border border-white/8 bg-black/20 p-3 font-mono text-[11px] text-zinc-500">
              {transaction}
            </div>
            <Button className="mt-5 w-full" onClick={() => onOpenChange(false)}>
              Return to canvas
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
              <WalletCards className="size-5" />
            </div>
            <DialogTitle className="text-xl font-semibold tracking-tight">
              Confirm deployment
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-zinc-400">
              CanvasOps is requesting permission to provision this architecture.
              No real funds or cloud resources will be used in this demo.
            </DialogDescription>

            <div className="my-5 space-y-3 rounded-xl border border-white/8 bg-black/20 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Protocol</span>
                <span className="font-medium text-zinc-200">x402 v2</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Network</span>
                <span className="font-medium text-zinc-200">Base Sepolia</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/8 pt-3">
                <span className="text-sm text-zinc-400">Total authorization</span>
                <span className="text-xl font-semibold text-white">
                  ${total.toFixed(2)} USDC
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-white/8 pt-3 text-xs">
                <span className="text-zinc-500">Architecture</span>
                <code className="text-zinc-300">{architectureHash}</code>
              </div>
            </div>

            <div className="mb-5 flex gap-2 text-xs leading-5 text-zinc-500">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-300" />
              Human approval is required before the WebMCP tool can continue.
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1"
                variant="secondary"
                onClick={onCancel}
                disabled={status === "signing"}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={onConfirm}
                disabled={status === "signing"}
              >
                {status === "signing" ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Signing…
                  </>
                ) : (
                  "Authorize & deploy"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
