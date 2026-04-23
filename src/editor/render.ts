import type { Annotation, ArrowAnnotation, BrushAnnotation, MosaicAnnotation, Rect, RectAnnotation, TextAnnotation } from "../shared/types";

const normalizeRect = (rect: Rect): Rect => {
  const x = rect.width >= 0 ? rect.x : rect.x + rect.width;
  const y = rect.height >= 0 ? rect.y : rect.y + rect.height;
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height)
  };
};

const renderRect = (ctx: CanvasRenderingContext2D, annotation: RectAnnotation) => {
  const rect = normalizeRect(annotation.rect);
  ctx.save();
  ctx.strokeStyle = annotation.style.color;
  ctx.lineWidth = annotation.style.lineWidth;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
};

const renderArrow = (ctx: CanvasRenderingContext2D, annotation: ArrowAnnotation) => {
  const { from, to, style } = annotation;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = Math.max(10, style.lineWidth * 3);

  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLength * Math.cos(angle - Math.PI / 6),
    to.y - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    to.x - headLength * Math.cos(angle + Math.PI / 6),
    to.y - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const renderBrush = (ctx: CanvasRenderingContext2D, annotation: BrushAnnotation) => {
  if (annotation.points.length < 2) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = annotation.style.color;
  ctx.lineWidth = annotation.style.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(annotation.points[0].x, annotation.points[0].y);

  for (let index = 1; index < annotation.points.length; index += 1) {
    const point = annotation.points[index];
    ctx.lineTo(point.x, point.y);
  }

  ctx.stroke();
  ctx.restore();
};

const renderText = (ctx: CanvasRenderingContext2D, annotation: TextAnnotation) => {
  ctx.save();
  ctx.fillStyle = annotation.style.color;
  ctx.font = `${annotation.style.fontSize ?? 22}px "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(annotation.text, annotation.point.x, annotation.point.y);
  ctx.restore();
};

const renderMosaic = async (
  ctx: CanvasRenderingContext2D,
  baseImage: CanvasImageSource,
  annotation: MosaicAnnotation
) => {
  const rect = normalizeRect(annotation.rect);
  const tempCanvas = document.createElement("canvas");
  const tempContext = tempCanvas.getContext("2d");

  if (!tempContext || rect.width === 0 || rect.height === 0) {
    return;
  }

  const downsample = Math.max(1, Math.round(annotation.pixelSize));
  tempCanvas.width = Math.max(1, Math.floor(rect.width / downsample));
  tempCanvas.height = Math.max(1, Math.floor(rect.height / downsample));
  tempContext.imageSmoothingEnabled = false;
  tempContext.drawImage(
    baseImage,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    tempCanvas.width,
    tempCanvas.height
  );

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
};

export const drawAnnotation = async (
  ctx: CanvasRenderingContext2D,
  baseImage: CanvasImageSource,
  annotation: Annotation
) => {
  switch (annotation.type) {
    case "rect":
      renderRect(ctx, annotation);
      return;
    case "arrow":
      renderArrow(ctx, annotation);
      return;
    case "brush":
      renderBrush(ctx, annotation);
      return;
    case "text":
      renderText(ctx, annotation);
      return;
    case "mosaic":
      await renderMosaic(ctx, baseImage, annotation);
      return;
    default:
      return;
  }
};

export const normalizeAnnotationRect = normalizeRect;
