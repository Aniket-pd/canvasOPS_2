import type {ReactNode} from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const nodes = [
  {label: "Edge Gateway", meta: "bom-1", x: 294, y: 262, dx: 566, dy: 232, delay: 0},
  {label: "API Service", meta: "sin-1", x: 1356, y: 262, dx: -496, dy: 232, delay: 3},
  {label: "Primary DB", meta: "bom-1", x: 236, y: 726, dx: 624, dy: -282, delay: 6},
  {label: "Failover", meta: "sin-1", x: 1414, y: 726, dx: -554, dy: -282, delay: 9},
] as const;

const edges = [
  "M566 308 C710 308 764 410 915 500",
  "M1356 308 C1210 308 1156 410 1005 500",
  "M508 772 C690 772 776 642 915 580",
  "M1414 772 C1230 772 1144 642 1005 580",
] as const;

const LayerIcon = ({size = 64}: {size?: number}) => (
  <svg
    aria-hidden="true"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m12 2.8 8 4.45-8 4.45-8-4.45 8-4.45Z" />
    <path d="m4 12.1 8 4.45 8-4.45" />
    <path d="m4 16.7 8 4.45 8-4.45" />
  </svg>
);

const MiniNodeIcon = () => (
  <svg
    aria-hidden="true"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M8 9h8M8 12h8M8 15h5" />
  </svg>
);

const GraphNode = ({
  children,
  meta,
  x,
  y,
  dx,
  dy,
  delay,
}: {
  children: ReactNode;
  meta: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        display: "flex",
        alignItems: "center",
        gap: 16,
        width: 272,
        height: 92,
        padding: "16px 18px",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 16,
        color: "#e4e4e7",
        background: "linear-gradient(120deg, rgba(190,242,100,0.05), transparent 46%), rgba(18,20,17,0.97)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.34)",
        opacity: interpolate(frame, [delay, 18 + delay, 45, 67], [0, 1, 1, 0], {
          easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        scale: interpolate(frame, [delay, 18 + delay, 45, 67], [0.88, 1, 1, 0.18], {
          easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          output: "perceptual-scale",
        }),
        translate: interpolate(frame, [delay, 18 + delay, 45, 67], ["0px 18px", "0px 0px", "0px 0px", `${dx}px ${dy}px`], {
          easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div
        style={{
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
          width: 48,
          height: 48,
          border: "1px solid rgba(190,242,100,0.22)",
          borderRadius: 12,
          color: "#bef264",
          background: "rgba(190,242,100,0.07)",
        }}
      >
        <MiniNodeIcon />
      </div>
      <div style={{minWidth: 0}}>
        <div style={{fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em"}}>{children}</div>
        <div
          style={{
            marginTop: 7,
            color: "#71717a",
            fontFamily: "Geist Mono, monospace",
            fontSize: 13,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {meta} · ready
        </div>
      </div>
    </div>
  );
};

export const CanvasOpsOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        color: "#e4e4e7",
        backgroundColor: "#080908",
        fontFamily: "Geist, Arial, sans-serif",
        opacity: interpolate(frame, [durationInFrames - 15, durationInFrames - 1], [1, 0], {
          easing: Easing.bezier(0.7, 0, 0.84, 0),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Interactive.Div
        name="Canvas dot grid"
        style={{
          position: "absolute",
          inset: 0,
          opacity: interpolate(frame, [0, 18, 48, 78], [0, 0.48, 0.48, 0.18], {
            easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          backgroundImage:
            "radial-gradient(circle at center, rgba(190,242,100,0.07), transparent 36%), radial-gradient(circle, rgba(255,255,255,0.12) 1.1px, transparent 1.1px)",
          backgroundPosition: "center, center",
          backgroundSize: "100% 100%, 32px 32px",
        }}
      />

      <Interactive.Div
        name="Canvas vignette"
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at center, transparent 18%, rgba(8,9,8,0.18) 56%, #080908 91%)",
        }}
      />

      <svg
        aria-hidden="true"
        width="1920"
        height="1080"
        viewBox="0 0 1920 1080"
        style={{position: "absolute", inset: 0}}
      >
        {edges.map((path) => (
          <path
            key={path}
            d={path}
            fill="none"
            stroke="#bef264"
            strokeWidth="2"
            strokeDasharray="8 14"
            strokeDashoffset={interpolate(frame, [0, 67], [56, -28], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
            opacity={interpolate(frame, [7, 22, 43, 65], [0, 0.42, 0.42, 0], {
              easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        ))}
      </svg>

      {nodes.map((node) => (
        <GraphNode key={node.label} {...node}>
          {node.label}
        </GraphNode>
      ))}

      <Interactive.Div
        name="Live connection status"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 13px",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 9,
          color: "#71717a",
          backgroundColor: "rgba(13,15,13,0.92)",
          fontFamily: "Geist Mono, monospace",
          fontSize: 12,
          letterSpacing: "0.08em",
          opacity: interpolate(frame, [10, 24, 43, 59], [0, 1, 1, 0], {
            easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [10, 24, 43, 59], [0.92, 1, 1, 0.82], {
            easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.7, 0, 0.84, 0)],
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
          translate: "-50% -50%",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: "#bef264",
            boxShadow: "0 0 12px rgba(190,242,100,0.72)",
          }}
        />
        GRAPH SYNCED
      </Interactive.Div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 34}}>
          <Interactive.Div
            name="CanvasOps brand mark"
            style={{
              display: "grid",
              placeItems: "center",
              width: 136,
              height: 136,
              borderRadius: 36,
              color: "#10120d",
              backgroundColor: "#bef264",
              boxShadow: "0 0 64px rgba(190,242,100,0.19), 0 24px 80px rgba(0,0,0,0.38)",
              opacity: interpolate(frame, [52, 69], [0, 1], {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(frame, [52, 72], [0.48, 1], {
                easing: Easing.spring({damping: 18, stiffness: 150, mass: 0.75}),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                output: "perceptual-scale",
              }),
            }}
          >
            <LayerIcon size={72} />
          </Interactive.Div>

          <Interactive.Div
            name="CanvasOps wordmark reveal"
            style={{
              width: interpolate(frame, [62, 90], [0, 600], {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              overflow: "hidden",
              whiteSpace: "nowrap",
              opacity: interpolate(frame, [62, 72], [0, 1], {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <div
              style={{
                width: 600,
                color: "#f4f4f5",
                fontSize: 112,
                fontWeight: 670,
                letterSpacing: "-0.055em",
                lineHeight: 1,
              }}
            >
              CanvasOps
            </div>
          </Interactive.Div>
        </div>

        <Interactive.Div
          name="Product descriptor"
          style={{
            marginTop: 38,
            color: "#a1a1aa",
            fontFamily: "Geist Mono, monospace",
            fontSize: 24,
            fontWeight: 500,
            letterSpacing: "0.18em",
            lineHeight: 1,
            textTransform: "uppercase",
            opacity: interpolate(frame, [80, 101], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [80, 101], ["0px 16px", "0px 0px"], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Agent-native cloud architecture
        </Interactive.Div>

        <Interactive.Div
          name="Product capabilities"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            marginTop: 25,
            padding: "10px 15px",
            border: "1px solid rgba(255,255,255,0.065)",
            borderRadius: 9,
            color: "#71717a",
            backgroundColor: "rgba(13,15,13,0.9)",
            fontFamily: "Geist Mono, monospace",
            fontSize: 13,
            fontWeight: 550,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: interpolate(frame, [92, 112], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [92, 112], ["0px 12px", "0px 0px"], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <span style={{color: "#bef264"}}>Design</span>
          <span style={{color: "#3f3f46"}}>·</span>
          Validate
          <span style={{color: "#3f3f46"}}>·</span>
          Provision
        </Interactive.Div>
      </div>
    </AbsoluteFill>
  );
};

export const MyComposition = () => (
  <Composition
    id="CanvasOpsOutro"
    component={CanvasOpsOutro}
    durationInFrames={165}
    fps={30}
    width={1920}
    height={1080}
  />
);
