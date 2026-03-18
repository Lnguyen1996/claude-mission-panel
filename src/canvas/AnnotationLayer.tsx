import { useRef, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Annotation,
  drawPulsingCircle,
  drawArrow,
  drawHighlight,
  drawLabel,
  calculateFadeAlpha,
  isExpired,
} from "./animations";

export function AnnotationLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotationsRef = useRef<Annotation[]>([]);
  const animationFrameRef = useRef<number>(0);
  const gridVisibleRef = useRef<boolean>(false);
  const gridColsRef = useRef<number>(16);
  const gridRowsRef = useRef<number>(9);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const now = Date.now();

    annotationsRef.current = annotationsRef.current.filter((a) => !isExpired(a, now));
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const annotation of annotationsRef.current) {
      const fadeAlpha = calculateFadeAlpha(annotation, now);
      if (fadeAlpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      const color = annotation.color || "#ef4444";

      switch (annotation.type) {
        case "circle":
          drawPulsingCircle(ctx, annotation.x, annotation.y, color, now, annotation.pulse !== false);
          break;
        case "arrow":
          drawArrow(ctx, annotation.x, annotation.y, annotation.x2 ?? annotation.x + 50, annotation.y2 ?? annotation.y + 50, color);
          break;
        case "highlight":
          drawHighlight(ctx, annotation.x, annotation.y, (annotation.x2 ?? annotation.x + 100) - annotation.x, (annotation.y2 ?? annotation.y + 40) - annotation.y, color);
          break;
        case "label":
          drawLabel(ctx, annotation.x, annotation.y, annotation.text || "", color);
          break;
      }
      ctx.restore();
    }
    // Draw grid overlay if visible
    if (gridVisibleRef.current) {
      const cols = gridColsRef.current;
      const rows = gridRowsRef.current;
      const cellW = window.innerWidth / cols;
      const cellH = window.innerHeight / rows;

      // Scale font and label frequency based on density
      let fontSize = 16;
      let labelEvery = 1; // show number on every Nth cell
      if (cols >= 96) { fontSize = 7; labelEvery = 3; }
      else if (cols >= 48) fontSize = 9;
      else if (cols >= 32) fontSize = 11;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * cellW;
          const y = row * cellH;
          const cellNum = row * cols + col;

          // Draw cell border
          ctx.strokeStyle = cols >= 96 ? "rgba(0,255,255,0.15)" : "rgba(0,255,255,0.3)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellW, cellH);

          // Draw cell number (skip some in ultra mode to avoid clutter)
          if (row % labelEvery === 0 && col % labelEvery === 0) {
            ctx.fillStyle = cols >= 96 ? "rgba(0,255,255,0.5)" : "rgba(0,255,255,0.6)";
            ctx.font = `bold ${fontSize}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(cellNum), x + cellW / 2, y + cellH / 2);
          }
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const unlistenGrid = listen<any>("grid", (event) => {
      const data = event.payload;
      if (data.action === "show") {
        gridColsRef.current = data.cols ?? 16;
        gridRowsRef.current = data.rows ?? 9;
        gridVisibleRef.current = true;
      }
      if (data.action === "hide") {
        gridVisibleRef.current = false;
      }
    });

    const unlisten = listen<any>("annotation", (event) => {
      const data = event.payload;
      if (data.action === "clear") {
        annotationsRef.current = [];
        return;
      }
      if (data.action === "add") {
        annotationsRef.current.push({
          id: data.id || crypto.randomUUID(),
          type: data.type,
          x: data.x, y: data.y,
          x2: data.x2, y2: data.y2,
          color: data.color, text: data.text,
          pulse: data.pulse,
          fadeMs: data.fadeMs ?? 5000,
          createdAt: Date.now(),
        });
      }
      if (data.action === "remove") {
        annotationsRef.current = annotationsRef.current.filter((a) => a.id !== data.id);
      }
    });

    animationFrameRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameRef.current);
      unlisten.then((fn) => fn());
      unlistenGrid.then((fn) => fn());
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", top: 0, left: 0,
        width: "100vw", height: "100vh",
        pointerEvents: "none", zIndex: 9998,
      }}
    />
  );
}
