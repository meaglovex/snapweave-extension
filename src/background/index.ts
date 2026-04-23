import type { CaptureMode } from "../shared/types";

const MENU_VISIBLE_ID = "snapweave-visible";
const MENU_FULL_PAGE_ID = "snapweave-full-page";

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
let offscreenReadyResolve: (() => void) | null = null;
let offscreenReady: Promise<void> | null = null;

const OFFSCREEN_PATH = "offscreen.html";

const createRequestId = () => `${Date.now()}-${crypto.randomUUID()}`;

const isCaptureableUrl = (url?: string) =>
  Boolean(
    url &&
      !url.startsWith("chrome://") &&
      !url.startsWith("chrome-extension://") &&
      !url.startsWith("devtools://")
  );

const getActiveTab = async () => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const activeTab = tabs.find((tab) => tab.active);

  if (activeTab?.id && typeof activeTab.windowId === "number" && isCaptureableUrl(activeTab.url)) {
    return activeTab as chrome.tabs.Tab & { id: number; windowId: number };
  }

  const fallbackTab = tabs
    .filter((tab) => tab.id && typeof tab.windowId === "number" && isCaptureableUrl(tab.url))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];

  if (!fallbackTab?.id || typeof fallbackTab.windowId !== "number") {
    throw new Error("未找到可截图的网页标签页。");
  }

  return fallbackTab as chrome.tabs.Tab & { id: number; windowId: number };
};

const assertActionTab = (tab?: chrome.tabs.Tab) => {
  if (!tab?.id || typeof tab.windowId !== "number") {
    throw new Error("当前标签页不可用。");
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

const createContextMenus = async () => {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_VISIBLE_ID,
    title: "截取本页",
    contexts: ["action"]
  });

  chrome.contextMenus.create({
    id: MENU_FULL_PAGE_ID,
    title: "截取全页",
    contexts: ["action"]
  });
};

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
    offscreenReady = new Promise<void>((resolve) => {
      offscreenReadyResolve = resolve;
    });
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["BLOBS", "CLIPBOARD"],
      justification: "用于处理截图裁剪、整页拼接和写入剪贴板。"
    }).finally(() => {
      creatingOffscreen = null;
    });
  }

  await creatingOffscreen;

  if (offscreenReady) {
    const ready = offscreenReady;
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("offscreen ready timeout")), 5000)
    );
    await Promise.race([ready, timeout]);
  }
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
    throw new Error(response.error ?? "裁剪截图失败。");
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
    throw new Error(response.error ?? "导出截图失败。");
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
    throw new Error(response.error ?? "整页拼接失败。");
  }

  return response.dataUrl;
};

const buildScrollStops = (metrics: TabPageMetrics) => {
  const stops: Array<{ x: number; y: number }> = [];
  const maxX = Math.max(0, metrics.pageWidth - metrics.viewportWidth);
  const maxY = Math.max(0, metrics.pageHeight - metrics.viewportHeight);

  for (let y = 0; y <= maxY; y += metrics.viewportHeight) {
    for (let x = 0; x <= maxX; x += metrics.viewportWidth) {
      stops.push({
        x: Math.min(x, maxX),
        y: Math.min(y, maxY)
      });
    }
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
    const CAPTURE_INTERVAL_MS = 600;
    let lastCaptureAt = 0;

    for (let index = 0; index < stops.length; index += 1) {
      const stop = stops[index];
      await sendMessageToTab(tab.id, {
        target: "content",
        type: "SCROLL_TO_POSITION",
        x: stop.x,
        y: stop.y
      });

      // chrome.tabs.captureVisibleTab has a ~2/sec quota. Space calls apart
      // so the browser doesn't silently return the previous frame.
      const elapsed = Date.now() - lastCaptureAt;
      if (index > 0 && elapsed < CAPTURE_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_INTERVAL_MS - elapsed));
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      lastCaptureAt = Date.now();
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

const startCaptureForTab = async (
  tab: chrome.tabs.Tab & { id: number; windowId: number },
  mode: CaptureMode
) => {
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

const startCapture = async (mode: CaptureMode) => {
  const tab = await getActiveTab();
  await startCaptureForTab(tab, mode);
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    preferredMode: "selection"
  });
  await createContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void createContextMenus();
});

chrome.action.onClicked.addListener((tab) => {
  void startCaptureForTab(assertActionTab(tab), "selection").catch((error) => {
    console.error(error);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) {
    return;
  }

  const actionTab = assertActionTab(tab);

  if (info.menuItemId === MENU_VISIBLE_ID) {
    void startCaptureForTab(actionTab, "visible").catch((error) => {
      console.error(error);
    });
  }

  if (info.menuItemId === MENU_FULL_PAGE_ID) {
    void startCaptureForTab(actionTab, "fullPage").catch((error) => {
      console.error(error);
    });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-selection-capture") {
    return;
  }

  void startCapture("selection").catch((error) => {
    console.error(error);
  });
});

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_READY") {
    if (offscreenReadyResolve) {
      offscreenReadyResolve();
      offscreenReadyResolve = null;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.target !== "background") {
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
        throw new Error("未知的后台请求。");
    }
  };

  void run()
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      console.error("[SnapWeave bg] responding error", message.type, error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "后台处理失败。"
      });
    });

  return true;
});
