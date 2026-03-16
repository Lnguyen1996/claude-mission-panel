export interface Annotation {
  id: string;
  type: "circle" | "arrow" | "highlight" | "label";
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color?: string;
  text?: string;
  pulse?: boolean;
  fadeMs?: number;
  createdAt: number;
}

const DEFAULT_COLOR = "#ef4444";

export function drawPulsingCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string = DEFAULT_COLOR,
  time: number,
  pulse: boolean = true
) {
  const radius = 24;
  const pulseScale = pulse ? 1 + 0.15 * Math.sin(time * 0.004) : 1;
  const pulseAlpha = pulse ? 0.7 + 0.3 * Math.sin(time * 0.004) : 1;

  ctx.save();

  // Outer glow
  ctx.beginPath();
  ctx.arc(x, y, radius * pulseScale * 1.6, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulseAlpha * 0.2;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Main circle
  ctx.beginPath();
  ctx.arc(x, y, radius * pulseScale, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulseAlpha * 0.8;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = pulseAlpha;
  ctx.fill();

  ctx.restore();
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string = DEFAULT_COLOR
) {
  const headLen = 14;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;

  // Line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export function drawHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string = "#facc15"
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.2;
  ctx.fillRect(x, y, width, height);

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string = DEFAULT_COLOR
) {
  ctx.save();

  ctx.font = "14px -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
  const metrics = ctx.measureText(text);
  const padding = 8;
  const bgWidth = metrics.width + padding * 2;
  const bgHeight = 28;

  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.globalAlpha = 0.9;
  const cornerRadius = 6;
  ctx.beginPath();
  ctx.roundRect(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight, cornerRadius);
  ctx.fill();

  // Border
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight, cornerRadius);
  ctx.stroke();

  // Text
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);

  ctx.restore();
}

export function calculateFadeAlpha(annotation: Annotation, now: number): number {
  if (!annotation.fadeMs) return 1;
  const elapsed = now - annotation.createdAt;
  if (elapsed < annotation.fadeMs * 0.7) return 1;
  const fadeProgress = (elapsed - annotation.fadeMs * 0.7) / (annotation.fadeMs * 0.3);
  return Math.max(0, 1 - fadeProgress);
}

export function isExpired(annotation: Annotation, now: number): boolean {
  if (!annotation.fadeMs) return false;
  return now - annotation.createdAt > annotation.fadeMs;
}
