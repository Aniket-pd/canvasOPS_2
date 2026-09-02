"use client";

import { Check, ClipboardList, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  architectureProfiles,
  type ArchitectureBrief,
} from "@/lib/architecture-brief";

type ArchitectureBriefDialogProps = {
  brief: ArchitectureBrief;
  fingerprint: string;
  open: boolean;
  onClose: () => void;
  onSave: (brief: ArchitectureBrief) => void;
};

function listValue(values: string[]) {
  return values.join(", ");
}

function parseList(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ArchitectureBriefDialog({
  brief,
  fingerprint,
  open,
  onClose,
  onSave,
}: ArchitectureBriefDialogProps) {
  const [draft, setDraft] = useState(brief);

  const profile = architectureProfiles[draft.profile];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="brief-dialog">
        <div className="brief-dialog-heading">
          <div className="brief-dialog-icon">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <DialogTitle>Architecture brief</DialogTitle>
            <DialogDescription>
              This context is shared with every architecture agent and enforced
              when a plan is proposed.
            </DialogDescription>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft);
          }}
        >
          <div className="brief-form-scroll">
            <div className="brief-form-grid">
            <label className="config-field brief-span-2">
              <span>System name</span>
              <input
                value={draft.systemName}
                maxLength={80}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    systemName: event.target.value,
                  }))
                }
              />
            </label>

            <label className="config-field brief-span-2">
              <span>Architecture expert</span>
              <select
                value={draft.profile}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    profile: event.target.value as ArchitectureBrief["profile"],
                  }))
                }
              >
                {Object.values(architectureProfiles).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <small>{profile.description}</small>
            </label>

            <label className="config-field brief-span-2">
              <span>Objective</span>
              <textarea
                value={draft.objective}
                maxLength={500}
                rows={3}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    objective: event.target.value,
                  }))
                }
              />
            </label>

            <label className="config-field brief-span-2">
              <span>Expected traffic / scale</span>
              <input
                value={draft.expectedTraffic}
                maxLength={120}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    expectedTraffic: event.target.value,
                  }))
                }
              />
            </label>

            <label className="config-field">
              <span>Monthly budget (USDC)</span>
              <input
                type="number"
                min={1}
                max={100000}
                value={draft.maxMonthlyCost}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxMonthlyCost: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label className="config-field">
              <span>Minimum replicas</span>
              <input
                type="number"
                min={1}
                max={12}
                value={draft.minimumReplicas}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    minimumReplicas: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label className="config-field">
              <span>Availability target</span>
              <select
                value={draft.availabilityTarget}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    availabilityTarget:
                      event.target.value as ArchitectureBrief["availabilityTarget"],
                  }))
                }
              >
                <option value="best-effort">Best effort</option>
                <option value="99.9">99.9%</option>
                <option value="99.95">99.95%</option>
                <option value="99.99">99.99%</option>
              </select>
            </label>

            <label className="config-field">
              <span>Data sensitivity</span>
              <select
                value={draft.dataSensitivity}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dataSensitivity:
                      event.target.value as ArchitectureBrief["dataSensitivity"],
                  }))
                }
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>

            <label className="config-field brief-span-2">
              <span>Required regions</span>
              <input
                value={listValue(draft.requiredRegions)}
                placeholder="bom-1, sin-1"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    requiredRegions: parseList(event.target.value),
                  }))
                }
              />
            </label>

            <label className="config-field brief-span-2">
              <span>Preferred technologies</span>
              <input
                value={listValue(draft.preferredTechnologies)}
                placeholder="PostgreSQL, Containers"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    preferredTechnologies: parseList(event.target.value),
                  }))
                }
              />
            </label>

            <label className="config-field brief-span-2">
              <span>Constraints</span>
              <textarea
                value={draft.constraints.join("\n")}
                placeholder="One constraint per line"
                rows={3}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    constraints: parseList(event.target.value),
                  }))
                }
              />
            </label>
            </div>

            <section className="expert-policy-card">
              <div>
                <strong>{profile.label}</strong>
                <code>{fingerprint}</code>
              </div>
              <p>{profile.role}</p>
              <ul>
                {profile.requiredChecks.map((check) => (
                  <li key={check}>
                    <Check className="size-3" />
                    {check}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="brief-dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              <X className="size-4" />
              Cancel
            </Button>
            <Button type="submit">
              <Check className="size-4" />
              Save brief
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
