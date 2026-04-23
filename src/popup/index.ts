type CaptureMode = "visible" | "selection" | "fullPage";

const statusNode = document.querySelector<HTMLDivElement>("#status");

const setStatus = (message: string) => {
  if (statusNode) {
    statusNode.textContent = message;
  }
};

const startCapture = async (mode: CaptureMode) => {
  setStatus("");

  try {
    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "START_CAPTURE",
      mode
    });

    if (!response?.ok) {
      throw new Error(response?.error ?? "启动截图失败。");
    }

    window.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "启动截图失败。");
  }
};

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as CaptureMode;
    void startCapture(mode);
  });
});
