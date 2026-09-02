"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Presentation,
  X,
} from "lucide-react";

export type JudgeStep = {
  title: string;
  goal: string;
  prompt: string;
  expected: string;
};

type JudgeModePanelProps = {
  steps: JudgeStep[];
  activeStep: number;
  copiedPrompt: string | null;
  onChangeStep: (step: number) => void;
  onCopyPrompt: (prompt: string) => void;
  onClose: () => void;
};

export function JudgeModePanel({
  steps,
  activeStep,
  copiedPrompt,
  onChangeStep,
  onCopyPrompt,
  onClose,
}: JudgeModePanelProps) {
  const step = steps[activeStep];

  return (
    <section className="judge-panel" aria-label="Judge mode walkthrough">
      <div className="judge-panel-header">
        <span>
          <Presentation className="size-3.5" />
          Judge Mode
        </span>
        <button onClick={onClose} aria-label="Close Judge Mode">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="judge-progress" aria-label={`Step ${activeStep + 1} of ${steps.length}`}>
        {steps.map((item, index) => (
          <button
            key={item.title}
            className={index === activeStep ? "active" : ""}
            onClick={() => onChangeStep(index)}
            aria-label={`Open step ${index + 1}: ${item.title}`}
          />
        ))}
      </div>

      <div className="judge-step-copy">
        <small>
          Step {activeStep + 1} of {steps.length}
        </small>
        <h2>{step.title}</h2>
        <p>{step.goal}</p>
      </div>

      <button
        className="judge-prompt"
        onClick={() => onCopyPrompt(step.prompt)}
        title="Copy this prompt"
      >
        <span>{step.prompt}</span>
        {copiedPrompt === step.prompt ? (
          <Check className="size-4 text-lime-300" />
        ) : (
          <Copy className="size-4" />
        )}
      </button>

      <div className="judge-expected">
        <span>Watch for</span>
        <p>{step.expected}</p>
      </div>

      <div className="judge-actions">
        <button
          onClick={() => onChangeStep(Math.max(0, activeStep - 1))}
          disabled={activeStep === 0}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <button
          className="primary"
          onClick={() =>
            onChangeStep(Math.min(steps.length - 1, activeStep + 1))
          }
          disabled={activeStep === steps.length - 1}
        >
          Next
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </section>
  );
}
