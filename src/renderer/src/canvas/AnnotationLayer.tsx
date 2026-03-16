import React, { useRef, useEffect, useCallback } from "react";
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = Date.now();

    // Remove expired annotations
    annotationsRef.current = annotationsRef.current.filter(
      (a) => !isExpired(a, now)
    );

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each annotation
    for (const annotation of annotationsRef.current) {
      const fadeAlpha = calculateFadeAlpha(annotation, now);
      if (fadeAlpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = fadeAlpha;

      const color = annotation.color || "#ef4444";

      switch (annotation.type) {
        case "circle":
          drawPulsingCircle(
            ctx,
            annotation.x,
            annotation.y,
            color,
            now,
            annotation.pulse !== false
          );
          break;

        case "arrow":
          drawArrow(
            ctx,
            annotation.x,
            annotation.y,
            annotation.x2 ?? annotation.x + 50,
            annotation.y2 ?? annotation.y + 50,
            color
          );
          break;

        case "highlight":
          drawHighlight(
            ctx,
            annotation.x,
            annotation.y,
            (annotation.x2 ?? annotation.x + 100) - annotation.x,
            (annotation.y2 ?? annotation.y + 40) - annotation.y,
            color
          );
          break;

        case "label":
          drawLabel(ctx, annotation.x, annotation.y, annotation.text || "", color);
          break;
      }

      ctx.restore();
    }

    animationFrameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Resize canvas to fill window
    const resize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    };

    resize();
    window.addEventListener("resize", resize);

    // Listen for annotation events from main process
    window.api.onAnnotation((data) => {
      if (data.action === "clear") {
        annotationsRef.current = [];
        return;
      }

      if (data.action === "add") {
        const annotation: Annotation = {
          id: data.id || crypto.randomUUID(),
          type: data.type,
          x: data.x,
          y: data.y,
          x2: data.x2,
          y2: data.y2,
          color: data.color,
          text: data.text,
          pulse: data.pulse,
          fadeMs: data.fadeMs ?? 5000,
          createdAt: Date.now(),
        };
        annotationsRef.current.push(annotation);
      }

      if (data.action === "remove") {
        annotationsRef.current = annotationsRef.current.filter(
          (a) => a.id !== data.id
        );
      }
    });

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9998,
      }}
    />
  );
}
