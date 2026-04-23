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
      throw new Error(response?.error ?? "Capture failed.");
    }

    window.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to start capture.");
  }
};

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as CaptureMode;
    void startCapture(mode);
  });
});
