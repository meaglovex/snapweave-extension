import { drawAnnotation } from "../editor/render";
import type { Annotation, AnnotationKind, Point, Rect, CaptureMode } from "../shared/types";

declare global {
  interface Window {
    __snapWeaveOverlay?: SnapWeaveOverlay;
    __snapWeaveBootstrapped?: boolean;
  }
}

type OverlayStage = "idle" | "selection" | "editor";

type RuntimeMessage =
  | { target: "content"; type: "OPEN_CAPTURE_SESSION"; mode: CaptureMode; imageDataUrl: string }
  | { target: "content"; type: "GET_PAGE_METRICS" }
  | { target: "content"; type: "PREPARE_FULL_PAGE_CAPTURE" }
  | { target: "content"; type: "RESTORE_PAGE_STATE"; x?: number; y?: number }
  | { target: "content"; type: "SCROLL_TO_POSITION"; x: number; y: number };

const TOOL_ORDER: AnnotationKind[] = ["rect", "arrow", "brush", "text", "mosaic"];
const TOOL_LABELS: Record<AnnotationKind, string> = {
  rect: "矩形",
  arrow: "箭头",
  brush: "画笔",
  text: "文字",
  mosaic: "马赛克"
};
const COLORS = ["#ef4444", "#2563eb", "#10b981", "#f59e0b", "#ffffff"];
const LINE_WIDTHS = [10, 20, 30];

const STYLE_TEXT = `
  :host {
    all: initial;
  }

  .sw-shell {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    font-family: "Segoe UI", "PingFang SC", sans-serif;
    color: #e2e8f0;
  }

  .sw-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    background: rgba(2, 6, 23, 0.72);
    backdrop-filter: blur(2px);
  }

  .sw-image-frame {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: block;
    overflow: hidden;
    pointer-events: none;
  }

  .sw-image-frame img,
  .sw-image-frame canvas {
    position: absolute;
    transform-origin: top left;
  }

  .sw-image-frame img {
    pointer-events: none;
  }

  .sw-image-frame canvas {
    pointer-events: auto;
  }

  .sw-selection-box {
    position: absolute;
    border: 2px solid #38bdf8;
    box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.54);
    display: none;
    pointer-events: none;
  }

  .sw-toolbar,
  .sw-actions,
  .sw-banner {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.88);
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
    backdrop-filter: blur(14px);
  }

  .sw-banner {
    z-index: 3;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 13px;
    color: #cbd5e1;
    pointer-events: none;
  }

  .sw-toolbar {
    z-index: 4;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    flex-wrap: wrap;
    max-width: calc(100vw - 32px);
    pointer-events: auto;
  }

  .sw-actions {
    z-index: 4;
    gap: 6px;
    pointer-events: auto;
  }

  .sw-button,
  .sw-tool {
    border: 0;
    border-radius: 12px;
    padding: 8px 12px;
    background: rgba(51, 65, 85, 0.88);
    color: #f8fafc;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.18s ease, transform 0.18s ease;
  }

  .sw-button-primary {
    background: linear-gradient(135deg, #22d3ee 0%, #2563eb 100%);
  }

  .sw-button:hover,
  .sw-tool:hover {
    transform: translateY(-1px);
    background: rgba(71, 85, 105, 0.95);
  }

  .sw-tool[aria-pressed="true"] {
    background: linear-gradient(135deg, #22d3ee 0%, #2563eb 100%);
  }

  .sw-color {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 2px solid transparent;
    cursor: pointer;
  }

  .sw-color[aria-pressed="true"] {
    border-color: #f8fafc;
  }

  .sw-select {
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.4);
    background: rgba(15, 23, 42, 0.88);
    color: #f8fafc;
    padding: 7px 10px;
  }

  .sw-meta {
    font-size: 12px;
    color: #cbd5e1;
    white-space: nowrap;
  }

  .sw-actions .sw-meta {
    margin-right: 4px;
  }

  .sw-toast {
    position: absolute;
    z-index: 5;
    left: 50%;
    top: 84px;
    transform: translateX(-50%);
    padding: 10px 14px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.88);
    color: #f8fafc;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.18s ease;
    pointer-events: none;
  }

  .sw-toast.visible {
    opacity: 1;
  }

  .sw-textarea {
    position: absolute;
    min-width: 180px;
    min-height: 54px;
    resize: both;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.55);
    background: rgba(255, 255, 255, 0.98);
    color: #0f172a;
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
    font: 16px/1.4 "Segoe UI", "PingFang SC", sans-serif;
  }
`;

class SnapWeaveOverlay {
  private readonly root: HTMLDivElement;

  private readonly shadow: ShadowRoot;

  private readonly frame: HTMLDivElement;

  private readonly backdrop: HTMLDivElement;

  private readonly image: HTMLImageElement;

  private readonly canvas: HTMLCanvasElement;

  private readonly selectionBox: HTMLDivElement;

  private readonly toolbar: HTMLDivElement;

  private readonly actions: HTMLDivElement;

  private readonly banner: HTMLDivElement;

  private readonly toast: HTMLDivElement;

  private readonly meta: HTMLSpanElement;

  private readonly copyButton: HTMLButtonElement;

  private readonly downloadButton: HTMLButtonElement;

  private readonly undoButton: HTMLButtonElement;

  private readonly redoButton: HTMLButtonElement;

  private readonly editSelectionButton: HTMLButtonElement;

  private stage: OverlayStage = "idle";

  private activeMode: CaptureMode = "selection";

  private imageDataUrl = "";

  private imageNaturalWidth = 0;

  private imageNaturalHeight = 0;

  private displayRect = { left: 0, top: 0, width: 0, height: 0, scale: 1 };

  private selectionRect: Rect | null = null;

  private isPointerDown = false;

  private activePointerId: number | null = null;

  private activeInputSource: "pointer" | "mouse" | null = null;

  private dragStart: Point | null = null;

  private draftAnnotation: Annotation | null = null;

  private annotations: Annotation[] = [];

  private redoStack: Annotation[] = [];

  private activeTool: AnnotationKind = "rect";

  private activeColor = COLORS[0];

  private activeLineWidth = LINE_WIDTHS[1];

  private hiddenElements: HTMLElement[] = [];

  private originalDocumentScrollBehavior: string | null = null;

  private originalBodyScrollBehavior: string | null = null;

  private toastTimer: number | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "snapweave-root";
    this.shadow = this.root.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE_TEXT;

    const shell = document.createElement("div");
    shell.className = "sw-shell";

    this.backdrop = document.createElement("div");
    this.backdrop.className = "sw-backdrop";

    this.banner = document.createElement("div");
    this.banner.className = "sw-banner";
    this.banner.textContent = "拖动鼠标框选截图区域。";

    this.frame = document.createElement("div");
    this.frame.className = "sw-image-frame";

    this.image = document.createElement("img");
    this.canvas = document.createElement("canvas");
    this.selectionBox = document.createElement("div");
    this.selectionBox.className = "sw-selection-box";

    this.frame.append(this.image, this.canvas, this.selectionBox);

    this.toolbar = document.createElement("div");
    this.toolbar.className = "sw-toolbar";

    this.actions = document.createElement("div");
    this.actions.className = "sw-actions";

    this.toast = document.createElement("div");
    this.toast.className = "sw-toast";

    this.meta = document.createElement("span");
    this.meta.className = "sw-meta";

    this.undoButton = this.createButton("撤销", () => this.undo());
    this.redoButton = this.createButton("重做", () => this.redo());
    this.copyButton = this.createButton("保存到粘贴板", () => {
      if (this.stage === "selection") {
        void this.handleSelectionExport(true);
        return;
      }

      void this.handleExport(true);
    });
    this.copyButton.classList.add("sw-button-primary");
    this.downloadButton = this.createButton("下载 PNG", () => {
      if (this.stage === "selection") {
        void this.handleSelectionExport(false);
        return;
      }

      void this.handleExport(false);
    });
    this.editSelectionButton = this.createButton("编辑", () => {
      void this.enterEditorFromSelection();
    });

    const closeButton = this.createButton("取消", () => this.close());
    this.actions.append(this.meta, this.editSelectionButton, this.undoButton, this.redoButton, this.copyButton, this.downloadButton, closeButton);

    shell.append(this.backdrop, this.frame, this.banner, this.toolbar, this.actions, this.toast);
    this.shadow.append(style, shell);
    document.documentElement.append(this.root);
    this.bindEvents();
    this.renderToolbar();
    this.hide();
  }

  openSession(mode: CaptureMode, imageDataUrl: string) {
    this.activeMode = mode;
    this.imageDataUrl = imageDataUrl;
    this.selectionRect = null;
    this.annotations = [];
    this.redoStack = [];
    this.draftAnnotation = null;
    this.hideTextEditor();

    const nextImage = new Image();
    nextImage.decoding = "async";
    nextImage.src = imageDataUrl;

    void nextImage.decode().then(() => {
      this.imageNaturalWidth = nextImage.naturalWidth;
      this.imageNaturalHeight = nextImage.naturalHeight;
      this.image.src = imageDataUrl;
      this.show();

      if (mode === "selection") {
        this.stage = "selection";
        this.banner.textContent = "拖动鼠标框选，松手后可编辑、复制或下载。按 Esc 取消。";
      } else {
        this.stage = "editor";
        this.banner.textContent = "标注完成后可保存到粘贴板或下载。";
      }

      this.updateLayout();
      this.updateButtons();
      void this.renderEditorCanvas();
    }).catch(() => {
      this.showToast("截图加载失败。");
      this.close();
    });
  }

  getPageMetrics() {
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth),
      pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio
    };
  }

  prepareFullPageCapture() {
    this.hiddenElements = [];
    this.originalDocumentScrollBehavior = document.documentElement.style.scrollBehavior;
    this.originalBodyScrollBehavior = document.body.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    document.querySelectorAll<HTMLElement>("body *").forEach((element) => {
      const position = getComputedStyle(element).position;
      if (position === "fixed" || position === "sticky") {
        this.hiddenElements.push(element);
        element.dataset.snapweaveVisibility = element.style.visibility;
        element.style.visibility = "hidden";
      }
    });
  }

  restorePageState(x = window.scrollX, y = window.scrollY) {
    this.hiddenElements.forEach((element) => {
      element.style.visibility = element.dataset.snapweaveVisibility ?? "";
      delete element.dataset.snapweaveVisibility;
    });
    this.hiddenElements = [];
    document.documentElement.style.scrollBehavior = this.originalDocumentScrollBehavior ?? "";
    document.body.style.scrollBehavior = this.originalBodyScrollBehavior ?? "";
    this.originalDocumentScrollBehavior = null;
    this.originalBodyScrollBehavior = null;
    window.scrollTo(x, y);
  }

  async scrollToPosition(x: number, y: number) {
    window.scrollTo(x, y);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  async cropSelection() {
    if (!this.selectionRect) {
      throw new Error("还没有可用的选区。");
    }

    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "CROP_IMAGE",
      imageDataUrl: this.imageDataUrl,
      rect: this.selectionRect
    });

    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error ?? "裁剪截图失败。");
    }

    return response.dataUrl as string;
  }

  private enterEditorFromSelection = async () => {
    if (!this.selectionRect) {
      this.showToast("请先框选截图区域。");
      return;
    }

    try {
      const cropped = await this.cropSelection();
      this.stage = "editor";
      this.selectionRect = null;
      this.annotations = [];
      this.redoStack = [];
      this.openSession("visible", cropped);
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : "裁剪截图失败。");
    }
  };

  private async handleSelectionExport(copyToClipboard: boolean) {
    if (!this.hasMeaningfulSelection()) {
      this.showToast("请先框选截图区域。");
      return;
    }

    try {
      const cropped = await this.cropSelection();
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "EXPORT_IMAGE",
        imageDataUrl: cropped,
        annotations: [],
        copyToClipboard
      });

      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error ?? "导出截图失败。");
      }

      if (copyToClipboard) {
        await this.writeImageToClipboard(response.dataUrl as string);
        this.showToast("已保存到粘贴板。");
        window.setTimeout(() => this.close(), 320);
        return;
      }

      const link = document.createElement("a");
      link.href = response.dataUrl as string;
      link.download = this.buildFileName();
      link.click();
      this.showToast("截图已下载。");
      window.setTimeout(() => this.close(), 320);
    } catch (error) {
      console.error("[SnapWeave] handleSelectionExport error", error);
      this.showToast(error instanceof Error ? error.message : "导出截图失败。");
    }
  }

  private async writeImageToClipboard(dataUrl: string) {
    const blob = await (await fetch(dataUrl)).blob();
    try {
      window.focus();
    } catch {
      // focus may fail in some contexts; ClipboardItem write will surface the real error
    }
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
  }

  private bindEvents() {
    window.addEventListener("resize", () => {
      if (this.stage === "idle") {
        return;
      }
      this.updateLayout();
      void this.renderEditorCanvas();
    });

    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
    this.canvas.addEventListener("mousemove", (event) => this.onMouseMove(event));
    window.addEventListener("pointerup", (event) => this.onPointerUp(event), true);
    window.addEventListener("pointercancel", () => this.finishPointerGesture(), true);
    window.addEventListener("mouseup", () => this.finishPointerGesture(), true);
    window.addEventListener("blur", () => this.finishPointerGesture(), true);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        this.finishPointerGesture();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (this.stage === "idle") {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key === "Enter" && this.stage === "selection") {
        event.preventDefault();
        void this.enterEditorFromSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }
    });
  }

  private onPointerDown(event: PointerEvent) {
    if (this.stage === "idle") {
      return;
    }

    event.preventDefault();

    const point = this.clientToImage(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    this.hideTextEditor();
    this.isPointerDown = true;
    this.activePointerId = event.pointerId;
    this.activeInputSource = "pointer";
    this.dragStart = point;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures from synthetic or unsupported pointer sources.
    }

    if (this.stage === "selection") {
      this.selectionRect = { x: point.x, y: point.y, width: 0, height: 0 };
      this.updateSelectionBox();
      return;
    }

    switch (this.activeTool) {
      case "rect":
        this.draftAnnotation = this.makeRectAnnotation(point, point);
        break;
      case "arrow":
        this.draftAnnotation = this.makeArrowAnnotation(point, point);
        break;
      case "brush":
        this.draftAnnotation = this.makeBrushAnnotation([point]);
        break;
      case "mosaic":
        this.draftAnnotation = this.makeMosaicAnnotation(point, point);
        break;
      case "text":
        this.openTextEditor(point, event.clientX, event.clientY);
        this.finishPointerGesture();
        return;
      default:
        return;
    }

    void this.renderEditorCanvas();
  }

  private onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || this.stage === "idle" || this.activeInputSource === "pointer") {
      return;
    }

    event.preventDefault();

    const point = this.clientToImage(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    this.hideTextEditor();
    this.isPointerDown = true;
    this.activePointerId = null;
    this.activeInputSource = "mouse";
    this.dragStart = point;

    if (this.stage === "selection") {
      this.selectionRect = { x: point.x, y: point.y, width: 0, height: 0 };
      this.updateSelectionBox();
      return;
    }

    switch (this.activeTool) {
      case "rect":
        this.draftAnnotation = this.makeRectAnnotation(point, point);
        break;
      case "arrow":
        this.draftAnnotation = this.makeArrowAnnotation(point, point);
        break;
      case "brush":
        this.draftAnnotation = this.makeBrushAnnotation([point]);
        break;
      case "mosaic":
        this.draftAnnotation = this.makeMosaicAnnotation(point, point);
        break;
      case "text":
        this.openTextEditor(point, event.clientX, event.clientY);
        this.finishPointerGesture();
        return;
      default:
        return;
    }

    void this.renderEditorCanvas();
  }

  private onPointerMove(event: PointerEvent) {
    if (this.activeInputSource !== "pointer" || !this.isPointerDown || !this.dragStart) {
      return;
    }

    if (event.buttons === 0) {
      this.finishPointerGesture();
      return;
    }

    const point = this.clientToImage(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (this.stage === "selection" && this.selectionRect) {
      this.selectionRect = {
        x: this.dragStart.x,
        y: this.dragStart.y,
        width: point.x - this.dragStart.x,
        height: point.y - this.dragStart.y
      };
      this.updateSelectionBox();
      return;
    }

    if (!this.draftAnnotation) {
      return;
    }

    switch (this.draftAnnotation.type) {
      case "rect":
        this.draftAnnotation.rect.width = point.x - this.dragStart.x;
        this.draftAnnotation.rect.height = point.y - this.dragStart.y;
        break;
      case "arrow":
        this.draftAnnotation.to = point;
        break;
      case "brush":
        this.draftAnnotation.points.push(point);
        break;
      case "mosaic":
        this.draftAnnotation.rect.width = point.x - this.dragStart.x;
        this.draftAnnotation.rect.height = point.y - this.dragStart.y;
        break;
      default:
        break;
    }

    void this.renderEditorCanvas();
  }

  private onMouseMove(event: MouseEvent) {
    if (this.activeInputSource !== "mouse" || !this.isPointerDown || !this.dragStart) {
      return;
    }

    if (event.buttons === 0) {
      this.finishPointerGesture();
      return;
    }

    const point = this.clientToImage(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (this.stage === "selection" && this.selectionRect) {
      this.selectionRect = {
        x: this.dragStart.x,
        y: this.dragStart.y,
        width: point.x - this.dragStart.x,
        height: point.y - this.dragStart.y
      };
      this.updateSelectionBox();
      return;
    }

    if (!this.draftAnnotation) {
      return;
    }

    switch (this.draftAnnotation.type) {
      case "rect":
        this.draftAnnotation.rect.width = point.x - this.dragStart.x;
        this.draftAnnotation.rect.height = point.y - this.dragStart.y;
        break;
      case "arrow":
        this.draftAnnotation.to = point;
        break;
      case "brush":
        this.draftAnnotation.points.push(point);
        break;
      case "mosaic":
        this.draftAnnotation.rect.width = point.x - this.dragStart.x;
        this.draftAnnotation.rect.height = point.y - this.dragStart.y;
        break;
      default:
        break;
    }

    void this.renderEditorCanvas();
  }

  private onPointerUp(_event: PointerEvent) {
    if (this.activeInputSource !== "pointer") {
      return;
    }

    this.finishPointerGesture();
  }

  private finishPointerGesture() {
    if (!this.isPointerDown) {
      return;
    }

    if (this.activePointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.activePointerId);
      } catch {
        // Ignore capture release failures when the pointer was not captured.
      }
    }

    this.isPointerDown = false;
    this.activePointerId = null;
    this.activeInputSource = null;
    this.dragStart = null;

    if (this.stage === "selection") {
      this.updateButtons();
      return;
    }

    if (this.draftAnnotation) {
      if (this.isAnnotationMeaningful(this.draftAnnotation)) {
        this.annotations.push(this.draftAnnotation);
        this.redoStack = [];
      }
      this.draftAnnotation = null;
      this.updateButtons();
      void this.renderEditorCanvas();
    }
  }

  private isAnnotationMeaningful(annotation: Annotation) {
    switch (annotation.type) {
      case "brush":
        return annotation.points.length > 1;
      case "text":
        return annotation.text.trim().length > 0;
      case "arrow":
        return Math.hypot(annotation.to.x - annotation.from.x, annotation.to.y - annotation.from.y) > 3;
      case "rect":
      case "mosaic":
        return Math.abs(annotation.rect.width) > 3 && Math.abs(annotation.rect.height) > 3;
      default:
        return true;
    }
  }

  private renderToolbar() {
    this.toolbar.innerHTML = "";

    TOOL_ORDER.forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sw-tool";
      button.textContent = TOOL_LABELS[tool];
      button.setAttribute("aria-pressed", String(this.activeTool === tool));
      this.bindPress(button, () => {
        this.activeTool = tool;
        this.renderToolbar();
      });
      this.toolbar.append(button);
    });

    COLORS.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sw-color";
      button.style.background = color;
      button.setAttribute("aria-pressed", String(this.activeColor === color));
      this.bindPress(button, () => {
        this.activeColor = color;
        this.renderToolbar();
      });
      this.toolbar.append(button);
    });

    const select = document.createElement("select");
    select.className = "sw-select";
    LINE_WIDTHS.forEach((lineWidth) => {
      const option = document.createElement("option");
      option.value = String(lineWidth);
      option.textContent = `${lineWidth} 像素`;
      option.selected = this.activeLineWidth === lineWidth;
      select.append(option);
    });
    select.addEventListener("change", () => {
      this.activeLineWidth = Number(select.value);
    });
    this.toolbar.append(select);
  }

  private updateLayout() {
    if (this.stage === "selection") {
      this.displayRect = {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        scale: window.innerWidth / this.imageNaturalWidth
      };
    } else {
      const maxWidth = Math.max(320, Math.round(window.innerWidth * 0.86));
      const maxHeight = Math.max(240, Math.round(window.innerHeight * 0.76));
      const imageRatio = this.imageNaturalWidth / this.imageNaturalHeight;
      let width = maxWidth;
      let height = width / imageRatio;

      if (height > maxHeight) {
        height = maxHeight;
        width = height * imageRatio;
      }

      const left = Math.round((window.innerWidth - width) / 2);
      const top = Math.round((window.innerHeight - height) / 2);
      this.displayRect = {
        left,
        top,
        width,
        height,
        scale: width / this.imageNaturalWidth
      };
    }

    this.image.style.left = `${this.displayRect.left}px`;
    this.image.style.top = `${this.displayRect.top}px`;
    this.image.style.width = `${this.displayRect.width}px`;
    this.image.style.height = `${this.displayRect.height}px`;
    this.canvas.style.left = `${this.displayRect.left}px`;
    this.canvas.style.top = `${this.displayRect.top}px`;
    this.canvas.style.width = `${this.displayRect.width}px`;
    this.canvas.style.height = `${this.displayRect.height}px`;

    const canvasScale = window.devicePixelRatio;
    this.canvas.width = Math.round(this.displayRect.width * canvasScale);
    this.canvas.height = Math.round(this.displayRect.height * canvasScale);

    this.updateSelectionBox();
  }

  private async renderEditorCanvas() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const canvasScale = window.devicePixelRatio;
    ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.image, 0, 0, this.imageNaturalWidth, this.imageNaturalHeight, 0, 0, this.displayRect.width, this.displayRect.height);

    const previewBase = this.image;
    ctx.scale(this.displayRect.scale, this.displayRect.scale);

    for (const annotation of this.annotations) {
      await drawAnnotation(ctx, previewBase, annotation);
    }

    if (this.draftAnnotation) {
      await drawAnnotation(ctx, previewBase, this.draftAnnotation);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private updateSelectionBox() {
    if (this.stage !== "selection" || !this.selectionRect) {
      this.selectionBox.style.display = "none";
      this.meta.textContent = "";
      this.positionActions();
      return;
    }

    const rect = this.normalizeRect(this.selectionRect);
    const left = this.displayRect.left + rect.x * this.displayRect.scale;
    const top = this.displayRect.top + rect.y * this.displayRect.scale;
    const width = rect.width * this.displayRect.scale;
    const height = rect.height * this.displayRect.scale;

    this.selectionBox.style.display = "block";
    this.selectionBox.style.left = `${left}px`;
    this.selectionBox.style.top = `${top}px`;
    this.selectionBox.style.width = `${width}px`;
    this.selectionBox.style.height = `${height}px`;
    this.meta.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    this.positionActions();
  }

  private updateButtons() {
    const inSelection = this.stage === "selection";
    const hasSelection = this.hasMeaningfulSelection();
    this.editSelectionButton.style.display = inSelection && hasSelection ? "inline-flex" : "none";
    this.undoButton.style.display = inSelection ? "none" : "inline-flex";
    this.redoButton.style.display = inSelection ? "none" : "inline-flex";
    this.copyButton.style.display = inSelection && !hasSelection ? "none" : "inline-flex";
    this.downloadButton.style.display = inSelection && !hasSelection ? "none" : "inline-flex";
    this.toolbar.style.display = this.stage === "editor" ? "flex" : "none";
    this.actions.style.display = inSelection ? (hasSelection ? "flex" : "none") : "flex";

    if (!inSelection) {
      this.meta.textContent = `${Math.round(this.imageNaturalWidth)} × ${Math.round(this.imageNaturalHeight)}`;
    }

    this.positionActions();
  }

  private async handleExport(copyToClipboard: boolean) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "EXPORT_IMAGE",
        imageDataUrl: this.imageDataUrl,
        annotations: this.annotations,
        copyToClipboard
      });

      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error ?? "导出截图失败。");
      }

      if (copyToClipboard) {
        await this.writeImageToClipboard(response.dataUrl as string);
        this.showToast("已保存到粘贴板。");
        window.setTimeout(() => this.close(), 320);
        return;
      }

      const link = document.createElement("a");
      link.href = response.dataUrl as string;
      link.download = this.buildFileName();
      link.click();
      this.showToast("截图已下载。");
      window.setTimeout(() => this.close(), 320);
    } catch (error) {
      console.error("[SnapWeave] handleExport error", error);
      this.showToast(error instanceof Error ? error.message : "导出截图失败。");
    }
  }

  private buildFileName() {
    const title = document.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "截图";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${title}-${timestamp}.png`;
  }

  private hasMeaningfulSelection() {
    if (!this.selectionRect) {
      return false;
    }

    const rect = this.normalizeRect(this.selectionRect);
    return rect.width > 3 && rect.height > 3;
  }

  private positionActions() {
    if (this.actions.style.display === "none") {
      return;
    }

    const menuWidth = this.actions.offsetWidth || 360;
    const menuHeight = this.actions.offsetHeight || 46;
    let left = 16;
    let top = 16;

    if (this.stage === "selection" && this.hasMeaningfulSelection() && this.selectionRect) {
      const rect = this.normalizeRect(this.selectionRect);
      const selectionLeft = this.displayRect.left + rect.x * this.displayRect.scale;
      const selectionTop = this.displayRect.top + rect.y * this.displayRect.scale;
      const selectionBottom = selectionTop + rect.height * this.displayRect.scale;

      left = selectionLeft;
      top = selectionBottom + 12;

      if (top + menuHeight > window.innerHeight - 16) {
        top = selectionTop - menuHeight - 12;
      }
    } else {
      left = this.displayRect.left + this.displayRect.width - menuWidth;
      top = this.displayRect.top + 12;
    }

    left = Math.max(16, Math.min(left, window.innerWidth - menuWidth - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - menuHeight - 16));

    this.actions.style.left = `${left}px`;
    this.actions.style.top = `${top}px`;
    this.actions.style.right = "auto";
    this.actions.style.bottom = "auto";
    this.actions.style.transform = "none";
  }

  private clientToImage(clientX: number, clientY: number) {
    if (
      clientX < this.displayRect.left ||
      clientY < this.displayRect.top ||
      clientX > this.displayRect.left + this.displayRect.width ||
      clientY > this.displayRect.top + this.displayRect.height
    ) {
      return null;
    }

    return {
      x: (clientX - this.displayRect.left) / this.displayRect.scale,
      y: (clientY - this.displayRect.top) / this.displayRect.scale
    };
  }

  private normalizeRect(rect: Rect) {
    return {
      x: rect.width >= 0 ? rect.x : rect.x + rect.width,
      y: rect.height >= 0 ? rect.y : rect.y + rect.height,
      width: Math.abs(rect.width),
      height: Math.abs(rect.height)
    };
  }

  private makeRectAnnotation(start: Point, end: Point): Annotation {
    return {
      id: crypto.randomUUID(),
      type: "rect",
      style: { color: this.activeColor, lineWidth: this.activeLineWidth },
      rect: {
        x: start.x,
        y: start.y,
        width: end.x - start.x,
        height: end.y - start.y
      }
    };
  }

  private makeArrowAnnotation(start: Point, end: Point): Annotation {
    return {
      id: crypto.randomUUID(),
      type: "arrow",
      style: { color: this.activeColor, lineWidth: this.activeLineWidth },
      from: start,
      to: end
    };
  }

  private makeBrushAnnotation(points: Point[]): Annotation {
    return {
      id: crypto.randomUUID(),
      type: "brush",
      style: { color: this.activeColor, lineWidth: this.activeLineWidth },
      points
    };
  }

  private makeMosaicAnnotation(start: Point, end: Point): Annotation {
    return {
      id: crypto.randomUUID(),
      type: "mosaic",
      style: { color: this.activeColor, lineWidth: this.activeLineWidth },
      rect: {
        x: start.x,
        y: start.y,
        width: end.x - start.x,
        height: end.y - start.y
      },
      pixelSize: 12
    };
  }

  private openTextEditor(point: Point, clientX: number, clientY: number) {
    const textarea = document.createElement("textarea");
    textarea.className = "sw-textarea";
    textarea.style.left = `${clientX}px`;
    textarea.style.top = `${clientY}px`;
    textarea.style.color = this.activeColor;
    textarea.style.fontSize = `${Math.max(14, this.activeLineWidth * 6)}px`;
    textarea.placeholder = "输入文字后按回车";

    const commit = () => {
      const text = textarea.value.trim();
      textarea.remove();
      if (!text) {
        return;
      }

      this.annotations.push({
        id: crypto.randomUUID(),
        type: "text",
        style: {
          color: this.activeColor,
          lineWidth: this.activeLineWidth,
          fontSize: Math.max(18, this.activeLineWidth * 6)
        },
        point,
        text
      });
      this.redoStack = [];
      this.updateButtons();
      void this.renderEditorCanvas();
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit();
      }
    });

    textarea.addEventListener("blur", commit);
    this.shadow.append(textarea);
    textarea.focus();
  }

  private hideTextEditor() {
    this.shadow.querySelectorAll(".sw-textarea").forEach((node) => node.remove());
  }

  private undo() {
    if (this.annotations.length === 0) {
      return;
    }

    const annotation = this.annotations.pop();
    if (annotation) {
      this.redoStack.push(annotation);
    }
    this.updateButtons();
    void this.renderEditorCanvas();
  }

  private redo() {
    const annotation = this.redoStack.pop();
    if (!annotation) {
      return;
    }

    this.annotations.push(annotation);
    this.updateButtons();
    void this.renderEditorCanvas();
  }

  private bindPress(element: HTMLElement, handler: () => void) {
    let handled = false;

    const runHandler = (source: string) => {
      if (handled) {
        return;
      }
      handled = true;
      try {
        handler();
      } catch (error) {
        console.error("[SnapWeave] button handler error", source, error);
      }
      window.setTimeout(() => {
        handled = false;
      }, 0);
    };

    element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    element.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    element.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runHandler("pointerup");
    });

    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runHandler("click");
    });
  }

  private createButton(label: string, handler: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sw-button";
    button.textContent = label;
    this.bindPress(button, handler);
    return button;
  }

  private show() {
    this.root.style.display = "block";
    document.documentElement.style.overflow = "hidden";
  }

  private hide() {
    this.root.style.display = "none";
    document.documentElement.style.overflow = "";
  }

  close() {
    this.stage = "idle";
    this.selectionRect = null;
    this.annotations = [];
    this.redoStack = [];
    this.draftAnnotation = null;
    this.hideTextEditor();
    this.actions.style.display = "none";
    this.toolbar.style.display = "none";
    this.banner.style.display = "none";
    this.selectionBox.style.display = "none";
    this.hide();
  }

  private showToast(message: string) {
    this.toast.textContent = message;
    this.toast.classList.add("visible");
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove("visible");
    }, 1800);
  }
}

if (!window.__snapWeaveBootstrapped) {
  const overlay = window.__snapWeaveOverlay ?? new SnapWeaveOverlay();
  window.__snapWeaveOverlay = overlay;
  window.__snapWeaveBootstrapped = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.target !== "content") {
      return;
    }

    const run = async () => {
      switch (message.type) {
        case "OPEN_CAPTURE_SESSION":
          overlay.openSession(message.mode, message.imageDataUrl);
          return { ok: true };
        case "GET_PAGE_METRICS":
          return overlay.getPageMetrics();
        case "PREPARE_FULL_PAGE_CAPTURE":
          overlay.prepareFullPageCapture();
          return { ok: true };
        case "RESTORE_PAGE_STATE":
          overlay.restorePageState(message.x, message.y);
          return { ok: true };
        case "SCROLL_TO_POSITION":
          await overlay.scrollToPosition(message.x, message.y);
          return { ok: true };
        default:
          throw new Error("未知的页面请求。");
      }
    };

    void run()
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "页面脚本处理失败。"
        });
      });

    return true;
  });
}
