import {
  AbsoluteFill,
  Composition,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

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
          opacity: interpolate(frame, [0, 20, 60], [0, 0.18, 0.12], {
            easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear],
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
              opacity: interpolate(frame, [0, 17], [0, 1], {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(frame, [0, 20], [0.48, 1], {
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
              width: interpolate(frame, [10, 38], [0, 600], {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              overflow: "hidden",
              whiteSpace: "nowrap",
              opacity: interpolate(frame, [10, 20], [0, 1], {
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
            opacity: interpolate(frame, [28, 49], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [28, 49], ["0px 16px", "0px 0px"], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Agent-native cloud architecture
        </Interactive.Div>

      </div>
    </AbsoluteFill>
  );
};

export const MyComposition = () => (
  <Composition
    id="CanvasOpsOutro"
    component={CanvasOpsOutro}
    durationInFrames={113}
    fps={30}
    width={1920}
    height={1080}
  />
);
