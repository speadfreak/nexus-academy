// Learnyx Math Renderer — public entry point.
//
// Surfaces import { AiText } and pass any AI/study string; the heavy
// KaTeX + markdown chunk loads once (shared lazy chunk) and a readable
// plain-text fallback shows until then, so no surface ever flashes empty.

import { lazy, Suspense } from "react";

export {
  balanceTrailingMath,
  endsInsideMath,
  mathToPlainText,
  mathToSpeech,
  normalizeMathDelimiters,
} from "./mathText";

const LearnyxMathRenderer = lazy(() => import("./LearnyxMathRenderer"));

/** Lightweight fallback: instantly readable, zero layout dependency. */
function PlainTextFallback({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className}
      style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}
    >
      {text}
    </div>
  );
}

export interface AiTextProps {
  /** AI-generated or study text (markdown + $/$$/\(...\)/\[…\] math). */
  text: string;
  className?: string;
  /**
   * Inline variant: renders a span, collapses blocks — for use inside
   * buttons/chips (quiz options) where a div would be invalid HTML.
   */
  as?: "div" | "span";
}

/**
 * Render AI/study text with professional mathematical typesetting.
 * The shared renderer chunk (KaTeX, react-markdown, remark-*) is fetched
 * once per session and reused by every surface.
 */
export function AiText({ text, className, as = "div" }: AiTextProps) {
  return (
    <Suspense
      fallback={
        as === "span" ? (
          <span className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>
            {text}
          </span>
        ) : (
          <PlainTextFallback text={text} className={className} />
        )
      }
    >
      <LearnyxMathRenderer text={text} className={className} as={as} />
    </Suspense>
  );
}

/** Warm up the renderer chunk (call on idle — e.g. when a study page mounts). */
export function preloadMathRenderer(): void {
  void import("./LearnyxMathRenderer");
}
