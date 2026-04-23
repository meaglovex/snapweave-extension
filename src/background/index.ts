import type { CaptureMode } from "../shared/types";

type BackgroundRequest =
  | {
      target: "background";
      type: "START_CAPTURE";
      mode: CaptureMode;
    }
  | {
      target: "background";
      type: "CROP_IMAGE";
      imageDataUrl: string;
      rect: { x: number; y: number; width: number; height: number };
    }
  | {
      target: "background";
      type: "EXPORT_IMAGE";
      imageDataUrl: string;
      annotations: unknown[];
      copyToClipboard?: boolean;
    };

type TabPageMetrics = {
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
};

let creatingOffscreen: Promise<void> | null = null;

const OFFSCREEN_PATH = "offscreen.html";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createRequestId = () => `${Date.now()}-${crypto.randomUUID()}`;

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || typeof tab.windowId !== "number") {
    throw new Error("No active tab found.");
  }
  return tab as chrome.tabs.Tab & { id: number; windowId: number };
};

const ensureContentScript = async (tabId: number) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
};

const sendMessageToTab = async <T>(tabId: number, message: unknown): Promise<T> =>
  chrome.tabs.sendMessage(tabId, message) as Promise<T>;

const ensureOffscreenDocument = async () => {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });

  if (contexts.length > 0) {
    return;
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["BLOBS", "CLIPBOARD"],
      justification: "Compose screenshots, crop captures, and write image data to the clipboard."
    }).finally(() => {
      creatingOffscreen = null;
    });
  }

  await creatingOffscreen;
};

const sendOffscreenMessage = async <T>(message: Record<string, unknown>) => {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({
    ...message,
    target: "offscreen"
  }) as Promise<T>;
};

const cropImage = async (imageDataUrl: string, rect: { x: number; y: number; width: number; height: number }) => {
  const requestId = createRequestId();
  const response = await sendOffscreenMessage<{ ok: boolean; dataUrl?: string; error?: string }>({
    type: "CROP_IMAGE",
    requestId,
    imageDataUrl,
    rect
  });

  if (!response.ok || !response.dataUrl) {
    throw new Error(response.error ?? "Crop failed.");
  }

  return response.dataUrl;
};

const exportImage = async (
  imageDataUrl: string,
  annotations: unknown[],
  copyToClipboard = false
) => {
  const requestId = createRequestId();
  const response = await sendOffscreenMessage<{ ok: boolean; dataUrl?: string; error?: string }>({
    type: "EXPORT_IMAGE",
    requestId,
    imageDataUrl,
    annotations,
    copyToClipboard
  });

  if (!response.ok || !response.dataUrl) {
    throw new Error(response.error ?? "Export failed.");
  }

  return response.dataUrl;
};

const stitchFrames = async (
  frames: Array<{ dataUrl: string; x: number; y: number }>,
  metrics: Pick<TabPageMetrics, "pageWidth" | "pageHeight" | "devicePixelRatio">
) => {
  const requestId = createRequestId();
  const response = await sendOffscreenMessage<{ ok: boolean; dataUrl?: string; error?: string }>({
    type: "STITCH_FRAMES",
    requestId,
    frames,
    pageWidth: metrics.pageWidth,
    pageHeight: metrics.pageHeight,
    devicePixelRatio: metrics.devicePixelRatio
  });

  if (!response.ok || !response.dataUrl) {
    throw new Error(response.error ?? "Stitching failed.");
  }

  return response.dataUrl;
};

const buildScrollStops = (metrics: TabPageMetrics) => {
  const stops: Array<{ x: number; y: number }> = [];
  const maxY = Math.max(0, metrics.pageHeight - metrics.viewportHeight);

  for (let y = 0; y <= maxY; y += metrics.viewportHeight) {
    stops.push({ x: 0, y: Math.min(y, maxY) });
  }

  if (stops.length === 0) {
    stops.push({ x: 0, y: 0 });
  }

  return stops;
};

const startFullPageCapture = async (tab: chrome.tabs.Tab & { id: number; windowId: number }) => {
  await ensureContentScript(tab.id);
  const metrics = await sendMessageToTab<TabPageMetrics>(tab.id, {
    target: "content",
    type: "GET_PAGE_METRICS"
  });

  await sendMessageToTab(tab.id, {
    target: "content",
    type: "PREPARE_FULL_PAGE_CAPTURE"
  });

  try {
    const frames: Array<{ dataUrl: string; x: number; y: number }> = [];
    const stops = buildScrollStops(metrics);

    for (const stop of stops) {
      await sendMessageToTab(tab.id, {
        target: "content",
        type: "SCROLL_TO_POSITION",
        x: stop.x,
        y: stop.y
      });
      await delay(160);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      frames.push({
        dataUrl,
        x: stop.x,
        y: stop.y
      });
    }

    const stitched = await stitchFrames(frames, metrics);
    await sendMessageToTab(tab.id, {
      target: "content",
      type: "OPEN_CAPTURE_SESSION",
      mode: "fullPage",
      imageDataUrl: stitched
    });
  } finally {
    await sendMessageToTab(tab.id, {
      target: "content",
      type: "RESTORE_PAGE_STATE",
      x: metrics.scrollX,
      y: metrics.scrollY
    });
  }
};

const startCapture = async (mode: CaptureMode) => {
  const tab = await getActiveTab();

  if (mode === "fullPage") {
    await startFullPageCapture(tab);
    return;
  }

  await ensureContentScript(tab.id);
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  await sendMessageToTab(tab.id, {
    target: "content",
    type: "OPEN_CAPTURE_SESSION",
    mode,
    imageDataUrl
  });
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    preferredMode: "selection"
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-selection-capture") {
    return;
  }

  void startCapture("selection").catch((error) => {
    console.error(error);
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message.target !== "background") {
    return;
  }

  const run = async () => {
    switch (message.type) {
      case "START_CAPTURE":
        await startCapture(message.mode);
        return { ok: true };
      case "CROP_IMAGE":
        return {
          ok: true,
          dataUrl: await cropImage(message.imageDataUrl, message.rect)
        };
      case "EXPORT_IMAGE":
        return {
          ok: true,
          dataUrl: await exportImage(message.imageDataUrl, message.annotations, message.copyToClipboard)
        };
      default:
        throw new Error("Unknown background request.");
    }
  };

  void run()
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected background error."
      });
    });

  return true;
});
