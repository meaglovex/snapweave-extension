import type { Annotation, Rect } from "../shared/types";

type OffscreenRequest =
  | {
      target: "offscreen";
      type: "CROP_IMAGE";
      requestId: string;
      imageDataUrl: string;
      rect: Rect;
    }
  | {
      target: "offscreen";
      type: "STITCH_FRAMES";
      requestId: string;
      frames: Array<{ dataUrl: string; x: number; y: number }>;
      pageWidth: number;
      pageHeight: number;
      devicePixelRatio: number;
    }
  | {
      target: "offscreen";
      type: "EXPORT_IMAGE";
      requestId: string;
      imageDataUrl: string;
      annotations: Annotation[];
      copyToClipboard?: boolean;
    };

const loadImage = async (dataUrl: string) => {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();
  return image;
};

const rectToCanvas = (rect: Rect) => ({
  x: rect.width >= 0 ? rect.x : rect.x + rect.width,
  y: rect.height >= 0 ? rect.y : rect.y + rect.height,
  width: Math.abs(rect.width),
  height: Math.abs(rect.height)
});

const canvasToPng = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");

const drawAnnotation = async (
  ctx: CanvasRenderingContext2D,
  baseImage: CanvasImageSource,
  annotation: Annotation
) => {
  switch (annotation.type) {
    case "rect":
      ctx.save();
      ctx.strokeStyle = annotation.style.color;
      ctx.lineWidth = annotation.style.lineWidth;
      ctx.strokeRect(annotation.rect.x, annotation.rect.y, annotation.rect.width, annotation.rect.height);
      ctx.restore();
      return;
    case "arrow": {
      const angle = Math.atan2(annotation.to.y - annotation.from.y, annotation.to.x - annotation.from.x);
      const headLength = Math.max(10, annotation.style.lineWidth * 3);

      ctx.save();
      ctx.strokeStyle = annotation.style.color;
      ctx.fillStyle = annotation.style.color;
      ctx.lineWidth = annotation.style.lineWidth;
      ctx.beginPath();
      ctx.moveTo(annotation.from.x, annotation.from.y);
      ctx.lineTo(annotation.to.x, annotation.to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(annotation.to.x, annotation.to.y);
      ctx.lineTo(
        annotation.to.x - headLength * Math.cos(angle - Math.PI / 6),
        annotation.to.y - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        annotation.to.x - headLength * Math.cos(angle + Math.PI / 6),
        annotation.to.y - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    case "brush":
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
      return;
    case "text":
      ctx.save();
      ctx.fillStyle = annotation.style.color;
      ctx.font = `${annotation.style.fontSize ?? 22}px "Segoe UI", "PingFang SC", sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(annotation.text, annotation.point.x, annotation.point.y);
      ctx.restore();
      return;
    case "mosaic": {
      const width = Math.abs(annotation.rect.width);
      const height = Math.abs(annotation.rect.height);
      const x = annotation.rect.width >= 0 ? annotation.rect.x : annotation.rect.x + annotation.rect.width;
      const y = annotation.rect.height >= 0 ? annotation.rect.y : annotation.rect.y + annotation.rect.height;
      const tempCanvas = document.createElement("canvas");
      const tempContext = tempCanvas.getContext("2d");
      if (!tempContext || width === 0 || height === 0) {
        return;
      }
      const pixelSize = Math.max(1, Math.round(annotation.pixelSize));
      tempCanvas.width = Math.max(1, Math.floor(width / pixelSize));
      tempCanvas.height = Math.max(1, Math.floor(height / pixelSize));
      tempContext.imageSmoothingEnabled = false;
      tempContext.drawImage(baseImage, x, y, width, height, 0, 0, tempCanvas.width, tempCanvas.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, x, y, width, height);
      ctx.restore();
      return;
    }
    default:
      return;
  }
};

const copyToClipboard = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob
    })
  ]);
};

const cropImage = async (message: Extract<OffscreenRequest, { type: "CROP_IMAGE" }>) => {
  const image = await loadImage(message.imageDataUrl);
  const rect = rectToCanvas(message.rect);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get crop context.");
  }

  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvasToPng(canvas);
};

const stitchFrames = async (message: Extract<OffscreenRequest, { type: "STITCH_FRAMES" }>) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(message.pageWidth * message.devicePixelRatio));
  canvas.height = Math.max(1, Math.round(message.pageHeight * message.devicePixelRatio));
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get stitch context.");
  }

  for (const frame of message.frames) {
    const image = await loadImage(frame.dataUrl);
    ctx.drawImage(
      image,
      Math.round(frame.x * message.devicePixelRatio),
      Math.round(frame.y * message.devicePixelRatio)
    );
  }

  return canvasToPng(canvas);
};

const exportImage = async (message: Extract<OffscreenRequest, { type: "EXPORT_IMAGE" }>) => {
  const image = await loadImage(message.imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get export context.");
  }

  ctx.drawImage(image, 0, 0);

  for (const annotation of message.annotations) {
    await drawAnnotation(ctx, image, annotation);
  }

  const dataUrl = canvasToPng(canvas);

  if (message.copyToClipboard) {
    await copyToClipboard(dataUrl);
  }

  return dataUrl;
};

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message.target !== "offscreen") {
    return;
  }

  const run = async () => {
    switch (message.type) {
      case "CROP_IMAGE":
        return cropImage(message);
      case "STITCH_FRAMES":
        return stitchFrames(message);
      case "EXPORT_IMAGE":
        return exportImage(message);
      default:
        throw new Error("Unknown offscreen request.");
    }
  };

  void run()
    .then((dataUrl) => {
      sendResponse({
        ok: true,
        requestId: message.requestId,
        dataUrl
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : "Offscreen operation failed."
      });
    });

  return true;
});
