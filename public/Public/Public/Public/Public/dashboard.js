import {
  API_BASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "/frontend-config.js";

const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const backendUrl = (path) => new URL(path, API_BASE_URL).toString();

const pipelineList = document.querySelector("#pipeline-list");
const pipelineLoading = document.querySelector("#pipeline-loading");
const pipelineEmpty = document.querySelector("#pipeline-empty");
const pipelineCount = document.querySelector("#pipeline-count");
const modal = document.querySelector("#pipeline-modal");
const pipelineForm = document.querySelector("#pipeline-form");
const pipelineName = document.querySelector("#pipeline-name");
const pipelineSubmit = document.querySelector("#pipeline-submit");
const toast = document.querySelector("#toast");
const settingsModal = document.querySelector("#settings-modal");
const settingsForm = document.querySelector("#settings-form");
const settingsSubmit = document.querySelector("#settings-submit");
const providerList = document.querySelector("#provider-list");
const providerStatus = document.querySelector("#provider-status");
const outputModal = document.querySelector("#output-modal");
const outputStepLabel = document.querySelector("#output-step-label");
const outputTitle = document.querySelector("#output-title");
const outputContent = document.querySelector("#output-content");
const retryOutputStep = document.querySelector("#retry-output-step");
const activePolls = new Map();
const pipelineProviderSelections = new Map();
const providerChangeVersions = new Map();
const providerChangesPending = new Set();
const mediaObjectUrls = new Set();
const STUCK_AFTER_MS = 3 * 60 * 1000;
let providerRegistry = [];
let modalRetryContext = null;
const isStuck = (step) =>
  step?.status === "processing" &&
  Number.isFinite(Date.parse(step.updated_at)) &&
  Date.now() - Date.parse(step.updated_at) >=
    (step.step_number === 13 ? 5 * 60 * 1000 : STUCK_AFTER_MS);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(text, isError = false) {
  toast.textContent = text;
  toast.className = `pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl ${
    isError
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-white text-slate-700"
  }`;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

async function apiFetch(path, options = {}) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    window.location.replace("/");
    throw new Error("Your session has expired.");
  }

  const response = await fetch(backendUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "The request could not be completed.");
  }

  return payload;
}

function getDefinition(pipeline) {
  const definition = Array.isArray(pipeline.definition_json)
    ? pipeline.definition_json
    : [];
  return definition.slice(0, 20);
}

function statusLabel(status) {
  return {
    pending: "Ready to run",
    running: "Running",
    retrying: "Retrying",
    paused: "Paused — retry a step",
    completed: "Completed",
    failed: "Failed",
  }[status] || "Ready to run";
}

function statusIcon(status) {
  if (status === "running") return '<span class="spinner spinner-dark"></span>';
  if (status === "completed") return '<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (status === "failed") return '<span class="text-[11px]">!</span>';
  return '<span class="h-1.5 w-1.5 rounded-full bg-current"></span>';
}

function parseOutputData(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function releaseMediaObjectUrls() {
  mediaObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  mediaObjectUrls.clear();
}

async function loadProtectedMedia(
  element,
  url,
  { trackObjectUrl = true, replaceOnError = true } = {}
) {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(backendUrl(url), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Media returned HTTP ${response.status}.`);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (trackObjectUrl) mediaObjectUrls.add(objectUrl);
    element.src = objectUrl;
    element.dataset.mediaReady = "true";
  } catch (error) {
    if (!replaceOnError) {
      element.dataset.mediaError = error.message;
      return;
    }
    const message = document.createElement("p");
    message.className = "mt-3 text-sm text-rose-600";
    message.textContent = error.message;
    element.replaceWith(message);
  }
}

async function downloadProtectedMedia(url, filename) {
  const accessToken = await getAccessToken();
  const response = await fetch(backendUrl(url), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download returned HTTP ${response.status}.`);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function getImageProviders() {
  return providerRegistry.filter((provider) => provider.category === "image");
}

function getAudioProviders() {
  return [
    { id: "edge_tts", name: "Edge TTS", isFree: true },
    { id: "elevenlabs", name: "ElevenLabs", isFree: false },
  ];
}

function getPipelineProviderSelections(pipelineId) {
  if (!pipelineProviderSelections.has(pipelineId)) {
    pipelineProviderSelections.set(
      pipelineId,
      Object.fromEntries([
        [5, "pollinations"],
        [6, "pollinations"],
        [7, "pollinations"],
        [10, "edge_tts"],
      ])
    );
  }
  return pipelineProviderSelections.get(pipelineId);
}

function renderProviderOptions(selectedProvider) {
  return getImageProviders()
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider.id)}" ${
          provider.id === selectedProvider ? "selected" : ""
        }>${escapeHtml(provider.name)} · ${provider.isFree ? "Free" : "Paid"}</option>`
    )
    .join("");
}

function renderAudioProviderOptions(selectedProvider) {
  return getAudioProviders()
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider.id)}" ${
          provider.id === selectedProvider ? "selected" : ""
        }>${escapeHtml(provider.name)} · ${provider.isFree ? "Free" : "Paid"}</option>`
    )
    .join("");
}

function getStepDisplayName(stepNumber, fallbackName) {
  if (stepNumber === 4) return "Script Writing";
  if (stepNumber === 8) return "Image-to-Video";
  if (stepNumber === 10) return "Voiceover";
  return fallbackName || `Pipeline step ${stepNumber}`;
}

function renderSteps(container, definition, steps = [], handlers = {}) {
  const stepByNumber = new Map(steps.map((step) => [step.step_number, step]));
  container.innerHTML = definition
    .map((definitionStep, index) => {
      const number = index + 1;
      const step = stepByNumber.get(number);
      const status = step?.status || "pending";
      const warning = status === "completed_with_warning";
      const completed = status === "completed" || warning;
      const processing = status === "processing";
      const clickable = Boolean(step && (completed || status === "failed" || isStuck(step)));
      const supportsImageProvider = [5, 6, 7].includes(number);
      const supportsAudioProvider = number === 10;
      const nextRunSelection = supportsAudioProvider && handlers.isNextRunSelection?.();
      const providerPending = handlers.providerChangePending?.(number);
      const selectedProvider =
        (nextRunSelection ? handlers.getProvider?.(number) : step?.provider_used) ||
        handlers.getProvider?.(number) ||
        (supportsAudioProvider ? "edge_tts" : "pollinations");
      const providerControl = supportsImageProvider
        ? `<select class="step-provider ml-auto min-w-0 max-w-[132px] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-600" data-step-provider="${number}" ${
            (step && status !== "failed") || providerPending ? "disabled" : ""
          } aria-label="Provider for step ${number}">
            ${renderProviderOptions(selectedProvider)}
          </select>`
        : supportsAudioProvider
          ? `<select class="step-provider ml-auto min-w-0 max-w-[150px] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-600" data-step-provider="${number}" ${
              (step && status !== "failed" && !nextRunSelection) || providerPending ? "disabled" : ""
            } aria-label="Voiceover provider">
              ${renderAudioProviderOptions(selectedProvider)}
            </select>`
        : "";
      const retryControl =
        handlers.canRetry?.() !== false && (status === "failed" || isStuck(step))
          ? `<button type="button" class="retry-step rounded-md bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-100" ${providerPending ? "disabled" : ""}>Retry</button>`
          : "";
      return `
        <div class="step-row ${clickable ? "step-clickable" : ""} ${number === 7 ? "flex-wrap" : ""}" data-step-number="${number}">
          <span class="step-number ${completed ? "complete" : ""} ${warning ? "!bg-amber-50 !text-amber-600" : ""}">${String(number).padStart(2, "0")}</span>
           <span class="step-name ${completed ? "complete" : ""} ${warning ? "!text-amber-700 !no-underline" : ""}">${escapeHtml(getStepDisplayName(number, definitionStep.step_name))}</span>
           ${number === 7 ? '<span class="order-last basis-full pl-8 text-[10px] leading-4 text-slate-400">For higher quality, add a Fal.ai or Replicate API key in Settings.</span>' : ""}
          ${providerControl}
          ${retryControl}
          ${
            processing
              ? '<span class="spinner spinner-dark shrink-0"></span>'
              : warning
                ? '<span class="text-[11px] font-bold text-amber-500" title="Completed with warning">!</span>'
                : completed
                ? '<svg class="h-3.5 w-3.5 shrink-0 text-emerald-500" viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                : status === "failed"
                  ? '<span class="text-[11px] font-bold text-rose-500">!</span>'
                : ""
          }
        </div>
      `;
    })
    .join("");

  if (handlers.onStepClick) {
    container.querySelectorAll(".step-clickable").forEach((row) => {
      row.addEventListener("click", () => {
        const number = Number(row.dataset.stepNumber);
        handlers.onStepClick(stepByNumber.get(number), definition[number - 1]);
      });
    });
  }

  container.querySelectorAll(".step-provider").forEach((select) => {
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", async (event) => {
      event.stopPropagation();
      const number = Number(select.dataset.stepProvider);
      await handlers.onProviderChange?.(
        number,
        select.value,
        stepByNumber.get(number),
        select
      );
    });
  });

  container.querySelectorAll(".retry-step").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const row = button.closest("[data-step-number]");
      const number = Number(row.dataset.stepNumber);
      const provider = row.querySelector(".step-provider")?.value;
      button.disabled = true;
      button.textContent = "Retrying…";
      const started = await handlers.onRetry?.(
        stepByNumber.get(number),
        provider
      );
      if (!started) {
        button.disabled = false;
        button.textContent = "Retry";
      }
    });
  });
}

function getStepHandlers(pipeline, card) {
  const selections = getPipelineProviderSelections(pipeline.id);
  return {
    canRetry() {
      return card.dataset.executionStatus !== "failed";
    },
    isNextRunSelection() {
      return ["completed", "failed"].includes(card.dataset.executionStatus);
    },
    providerChangePending(number) {
      return providerChangesPending.has(`${pipeline.id}:${number}`);
    },
    getProvider(number) {
      return selections[number] || (number === 10 ? "edge_tts" : "pollinations");
    },
    onStepClick(step) {
      openStepOutput(pipeline, step);
    },
    async onProviderChange(number, providerId, step, select) {
      const changeKey = `${pipeline.id}:${number}`;
      if (providerChangesPending.has(changeKey)) {
        if (select?.isConnected) select.value = selections[number];
        return;
      }
      const previous =
        selections[number] || (number === 10 ? "edge_tts" : "pollinations");
      const version = (providerChangeVersions.get(changeKey) || 0) + 1;
      providerChangeVersions.set(changeKey, version);
      selections[number] = providerId;
      if (select) select.disabled = true;
      if (!step?.execution_id || (number === 10 && ["completed", "failed"].includes(card.dataset.executionStatus))) {
        if (select?.isConnected) select.disabled = false;
        if (number === 10) showToast(`Next run will use ${getAudioProviders().find((item) => item.id === providerId)?.name || providerId}.`);
        return;
      }

      providerChangesPending.add(changeKey);
      try {
        const result = await apiFetch(
          `/api/executions/${step.execution_id}/steps/${number}/provider`,
          {
            method: "PATCH",
            body: JSON.stringify({ provider: providerId }),
          }
        );
        if (providerChangeVersions.get(changeKey) !== version) return;
        const savedProvider = result.step?.provider_used || providerId;
        selections[number] = savedProvider;
        const visibleSelect = card.querySelector(`[data-step-provider="${number}"]`);
        if (visibleSelect) visibleSelect.value = savedProvider;
        showToast(`Step ${number} will use ${
          providerRegistry.find((item) => item.id === savedProvider)?.name ||
          getAudioProviders().find((item) => item.id === savedProvider)?.name ||
          savedProvider
        }.`);
      } catch (error) {
        if (providerChangeVersions.get(changeKey) === version) {
          selections[number] = previous;
          const visibleSelect = card.querySelector(`[data-step-provider="${number}"]`);
          if (visibleSelect) visibleSelect.value = previous;
          showToast(error.message, true);
        }
      } finally {
        providerChangesPending.delete(changeKey);
        if (providerChangeVersions.get(changeKey) === version) {
          const visibleSelect = card.querySelector(`[data-step-provider="${number}"]`);
          if (visibleSelect) visibleSelect.disabled = false;
        }
      }
    },
    async onRetry(step, providerId) {
      if (!step?.execution_id) return;
      if (providerChangesPending.has(`${pipeline.id}:${step.step_number}`)) {
        showToast("Wait for the provider change to save before retrying.", true);
        return false;
      }
      try {
        closeOutputModal();
        await apiFetch(
          `/api/executions/${step.execution_id}/steps/${step.step_number}/retry`,
          {
            method: "POST",
            body: JSON.stringify(
              [5, 6, 7, 10].includes(step.step_number) && providerId
                ? { provider: providerId }
                : {}
            ),
          }
        );
        showToast(`Retrying Step ${step.step_number}.`);
        await pollExecution(step.execution_id, pipeline, card);
        return true;
      } catch (error) {
        showToast(error.message, true);
        return false;
      }
    },
  };
}

function renderPipelineCard(pipeline) {
  const definition = getDefinition(pipeline);
  const card = document.createElement("article");
  card.className = "overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card";
  card.dataset.pipelineId = pipeline.id;
  card.innerHTML = `
    <div class="flex flex-col gap-5 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div class="flex items-center gap-4">
        <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white shadow-lg shadow-slate-200">
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="none"><path d="M5 4.5h10v11H5v-11ZM8 2.8h4M8 8h4M8 11h4M8 14h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="min-w-0">
          <h4 class="truncate font-semibold text-slate-900">${escapeHtml(pipeline.name)}</h4>
          <p class="mt-1 text-xs text-slate-500">20-step workflow · created ${new Date(pipeline.created_at).toLocaleDateString()}</p>
        </div>
      </div>
      <div class="flex items-center gap-3 sm:gap-5">
        <div class="min-w-[120px] flex-1 sm:flex-none">
          <div class="mb-2 flex justify-between text-[11px]"><span class="progress-label font-medium text-slate-500">0 of 20 steps</span><span class="progress-percent font-semibold text-violet-600">0%</span></div>
          <div class="h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="progress-bar h-full w-0 rounded-full bg-violet-500 transition-all duration-500"></div></div>
        </div>
        <button class="run-button run-pipeline" type="button">
          <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none"><path d="m5.5 3.5 6 4.5-6 4.5v-9Z" fill="currentColor"/></svg>
          Run
        </button>
        <button class="stop-pipeline hidden rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50" type="button">Stop Pipeline</button>
      </div>
    </div>
    <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3 sm:px-6">
      <span class="execution-badge pending execution-status">${statusIcon("pending")}${statusLabel("pending")}</span>
      <span class="font-mono text-[10px] text-slate-400">20 STEPS</span>
    </div>
    <div class="grid gap-x-8 gap-y-2 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3 pipeline-steps"></div>
    <section class="final-result hidden border-t border-slate-100 bg-slate-50/60 p-5 sm:p-6">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-500">Final Result</p>
          <h5 class="mt-1 text-base font-semibold text-slate-900">Generated media</h5>
          <p class=
