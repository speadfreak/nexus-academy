// Learnyx Math Renderer — the shared mathematics + markdown renderer.
//
// ONE pipeline for every surface that shows AI-generated or study text:
// Tutor, Notes, Flashcards, Study Cards, Mock Exam explanations, Mistake
// Lab, textbook companion. Whether a student is learning geometric
// progression in the Tutor or reviewing an exam mistake, every formula is
// typeset by the same KaTeX engine with the same Obsidian Academic Luxury
// styling.
//
// Pipeline:
//   raw AI text
//     → normalizeMathDelimiters ( \( \) \[ \] → $ $$, currency guard, reflow )
//     → balanceTrailingMath     ( truncated/streamed tails degrade gracefully )
//     → react-markdown (remark-gfm tables) + remark-math
//     → rehype-katex (throwOnError:false → red fallback, never a crash)
//     → styled .lyx-md container with copy-LaTeX on display equations
//
// Safety: no rehype-raw — arbitrary HTML in AI output is NEVER rendered.
// KaTeX runs with trust:false so \href/\includegraphics cannot produce
// links or external loads.

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
// KaTeX stylesheet — pure side-effect import (a bound import would be
// tree-shaken away since the binding is unused, silently dropping the
// @font-face rules and core .katex layout styles).
import "katex/dist/katex.min.css";
import { balanceTrailingMath, normalizeMathDelimiters } from "./mathText";

// ---------------------------------------------------------------------------
// Copy-LaTeX enhancement for display equations
// ---------------------------------------------------------------------------

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

/** Find the original TeX source KaTeX embedded in the MathML annotation. */
function latexSourceOf(display: Element): string | null {
  const annotation = display.querySelector(
    '.katex-mathml annotation[encoding="application/x-tex"]',
  );
  return annotation?.textContent?.trim() ?? null;
}

function mountCopyButton(display: HTMLElement, latex: string): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lyx-eq-copy";
  button.setAttribute("aria-label", "Copy equation as LaTeX");
  button.title = "Copy LaTeX";
  button.innerHTML = `${COPY_ICON}<span class="lyx-eq-copy-label">LaTeX</span>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard
      .writeText(latex)
      .then(() => {
        button.classList.add("lyx-eq-copy--done");
        button.setAttribute("aria-label", "Equation copied");
        const label = button.querySelector(".lyx-eq-copy-label");
        if (label) label.textContent = "Copied";
        window.setTimeout(() => {
          button.classList.remove("lyx-eq-copy--done");
          button.setAttribute("aria-label", "Copy equation as LaTeX");
          if (label) label.textContent = "LaTeX";
        }, 1400);
      })
      .catch(() => {});
  });
  display.appendChild(button);
}

/**
 * After render: give every display equation a horizontal-scroll safety and a
 * copy-LaTeX affordance. Idempotent via data flag (re-runs are no-ops), so
 * React re-renders never duplicate buttons. No layout jump: the scroll
 * container is styled in CSS before first paint of each equation.
 */
function useEnhanceDisplayEquations(text: string): RefObject<HTMLElement | null> {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const displays = container.querySelectorAll<HTMLElement>(".katex-display");
    for (const display of displays) {
      if (display.dataset.lyxEnhanced === "1") continue;
      display.dataset.lyxEnhanced = "1";
      const latex = latexSourceOf(display);
      if (latex) mountCopyButton(display, latex);
    }
  }, [text]);

  return containerRef;
}

// ---------------------------------------------------------------------------
// Markdown component overrides
// ---------------------------------------------------------------------------

function CodeBlock({ className, children, ...rest }: ComponentPropsWithoutRef<"code">) {
  const raw = String(children ?? "").replace(/\n$/, "");
  const isBlock = /language-|[\n]/.test(raw) || className?.includes("language-");
  const [copied, setCopied] = useState(false);

  if (!isBlock) {
    return (
      <code className="lyx-inline-code" {...rest}>
        {children}
      </code>
    );
  }

  const language = /language-(\w[\w+-]*)/.exec(className ?? "")?.[1];

  return (
    <span className="lyx-codeblock">
      <span className="lyx-codeblock-bar">
        <span className="lyx-codeblock-lang">{language ?? "code"}</span>
        <button
          type="button"
          className="lyx-codeblock-copy"
          aria-label={copied ? "Code copied" : "Copy code"}
          onClick={() => {
            void navigator.clipboard
              .writeText(raw)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => {});
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
      <code className="lyx-block-code" {...rest}>
        {raw}
      </code>
    </span>
  );
}

function TableWrap({ children, ...rest }: ComponentPropsWithoutRef<"table">) {
  return (
    <span className="lyx-table-scroll">
      <table {...rest}>{children}</table>
    </span>
  );
}

const markdownComponents = {
  code: CodeBlock,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  table: TableWrap,
  a: ({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...rest}>
      {children}
    </a>
  ),
};

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export interface LearnyxMathRendererProps {
  text: string;
  className?: string;
  /**
   * Inline variant: renders a span and collapses block elements — used
   * inside buttons/chips (quiz options) where a div is invalid HTML.
   */
  as?: "div" | "span";
}

const LearnyxMathRenderer = memo(function LearnyxMathRenderer({
  text,
  className,
  as = "div",
}: LearnyxMathRendererProps) {
  const prepared = useMemo(
    () => balanceTrailingMath(normalizeMathDelimiters(text)),
    [text],
  );
  const containerRef = useEnhanceDisplayEquations(prepared);
  const Tag = as === "span" ? "span" : "div";

  return (
    <Tag
      ref={containerRef as RefObject<HTMLDivElement>}
      className={
        as === "span"
          ? `lyx-md lyx-md-inline${className ? ` ${className}` : ""}`
          : className
            ? `lyx-md ${className}`
            : "lyx-md"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: "#ef4444", strict: false, trust: false }]]}
        components={markdownComponents}
      >
        {prepared}
      </ReactMarkdown>
    </Tag>
  );
});

export default LearnyxMathRenderer;
