import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ToolContext, ToolDefinition } from "@toonflow/tools-scaffold/runtime";
import type { DreamInputDefinition, DreamMediaType, DreamOperation, DreamParameterDefinition } from "./operations";

type ToolUpdateCallback = Parameters<ToolDefinition["execute"]>[3];
type ToolExecutionContext = Parameters<ToolDefinition["execute"]>[4];

const apiBaseUrl = "https://api.newportai.com";
const pollIntervalMs = 5000;
const maxFileBytes = 100 * 1024 * 1024;

const mimeByExtension: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", bmp: "image/bmp", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  mp4: "video/mp4", avi: "video/x-msvideo", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm",
};
const extensionByMime: Record<string, string> = Object.fromEntries(Object.entries(mimeByExtension).map(([extension, mimeType]) => [mimeType, extension]));

type InputFiles = Record<string, { path: string }[]>;
type InputMap = Map<string, { path: string }[]>;
type OperationParameters = Record<string, string | number | boolean>;

export interface DreamApiMediaRequest {
  operation: DreamOperation;
  taskId?: string;
  prompt?: string;
  inputs?: InputFiles;
  parameters?: OperationParameters;
  apiKey: string;
  timeoutSeconds: number;
  toolCallId: string;
  onUpdate?: ToolUpdateCallback;
  executionContext: ToolExecutionContext;
}

export interface DreamApiSavedMedia {
  path: string;
  assetLibraryPath?: string;
  mediaType: DreamMediaType;
  mimeType: string;
  url: string;
}

export class DreamApiTaskPendingError extends Error {
  constructor(readonly taskId: string, readonly operationId: string, message: string) {
    super(message);
    this.name = "DreamApiTaskPendingError";
  }
}

export class DreamApiOutputTooLargeError extends Error {
  constructor(readonly taskId: string, readonly urls: string[]) {
    super(`DreamAPI task ${taskId} completed, but an output exceeds the 100 MB Toonflow asset limit.`);
    this.name = "DreamApiOutputTooLargeError";
  }
}

class DreamApiHttpError extends Error {
  constructor(readonly status: number) {
    super(`DreamAPI request failed (HTTP ${status}).`);
    this.name = "DreamApiHttpError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function validateHttpsUrl(value: unknown, label: string) {
  if (typeof value !== "string" || value.length > 8192) throw new Error(`${label} is missing or invalid.`);
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`${label} is invalid.`); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
    || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url;
}

function requestUrl(path: string) {
  const url = new URL(path, apiBaseUrl);
  if (url.origin !== apiBaseUrl || !url.pathname.startsWith("/api/")) throw new Error("DreamAPI endpoint is not allowed.");
  return url;
}

async function parseResponse(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new DreamApiHttpError(response.status);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("DreamAPI returned an unexpectedly large JSON response.");
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error("DreamAPI returned invalid JSON."); }
  if (!isRecord(payload) || payload.code !== 0 || !isRecord(payload.data)) {
    const code = isRecord(payload) && (typeof payload.code === "number" || typeof payload.code === "string") ? String(payload.code) : "unknown";
    throw new Error(`DreamAPI request failed (code ${code}).`);
  }
  return payload.data;
}

async function postJson(path: string, body: Record<string, unknown>, apiKey: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(requestUrl(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
  return parseResponse(response);
}

function relativePath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (!path || path.length > 4096 || /^[\\/]|^[a-z][a-z\d+.-]*:/i.test(path) || /[\u0000-\u001f]/.test(path)
    || normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Input paths must be non-empty workspace-relative paths without . or .. segments.");
  }
  return normalized;
}

function inputExtension(path: string) {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

async function inputMimeType(context: ToolContext, path: string, definition: DreamInputDefinition) {
  let mimeType = mimeByExtension[inputExtension(path)];
  if (definition.mediaType === "image") {
    const detected = await context.files.detectImageMimeType(path);
    if (detected) mimeType = detected.toLowerCase().split(";")[0]!.trim();
  }
  if (!mimeType || !definition.accept.includes(mimeType)) {
    throw new Error(`Input "${definition.label}" does not accept this file format.`);
  }
  return mimeType;
}

async function validateInputs(context: ToolContext, operation: DreamOperation, supplied: InputFiles = {}) {
  const definitions = operation.inputs ?? [];
  for (const id of Object.keys(supplied)) {
    if (!definitions.some(definition => definition.id === id)) throw new Error(`Operation ${operation.id} does not accept input role "${id}".`);
  }
  const result: InputMap = new Map();
  for (const definition of definitions) {
    const values = supplied[definition.id] ?? [];
    const minimum = definition.minItems ?? (definition.required ? 1 : 0);
    const maximum = definition.maxItems ?? (definition.array ? 20 : 1);
    if (values.length < minimum) throw new Error(`Input role "${definition.label}" requires at least ${minimum} file(s).`);
    if (values.length > maximum) throw new Error(`Input role "${definition.label}" accepts at most ${maximum} file(s).`);
    for (const item of values) {
      const path = relativePath(item.path);
      const stats = await context.files.stat(path);
      if (!stats.isFile()) throw new Error(`Input "${definition.label}" must be a regular file.`);
      if (stats.size > maxFileBytes) throw new Error(`Input files cannot exceed 100 MB.`);
      await inputMimeType(context, path, definition);
    }
    result.set(definition.id, values.map(item => ({ path: relativePath(item.path) })));
  }
  return result;
}

function validateParameter(definition: DreamParameterDefinition, value: unknown) {
  if (value === undefined || value === null || value === "") {
    if (definition.required) throw new Error(`Parameter "${definition.label}" is required.`);
    return;
  }
  if (definition.type === "string" && (typeof value !== "string" || value.trim().length > 4096)
    || definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value))
    || definition.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`Parameter "${definition.label}" has an invalid value type.`);
  }
  if (typeof value === "number") {
    const stepOffset = value - (definition.min ?? 0);
    if (definition.min !== undefined && value < definition.min || definition.max !== undefined && value > definition.max
      || definition.step && Math.abs(stepOffset / definition.step - Math.round(stepOffset / definition.step)) > 1e-8) {
      throw new Error(`Parameter "${definition.label}" is outside the allowed range.`);
    }
  }
  if (definition.options?.length && !definition.allowCustom && !definition.options.includes(value as string | number)) {
    throw new Error(`Parameter "${definition.label}" is not an allowed option.`);
  }
}

function validateSeedreamSize(model: string, value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s/g, "");
  const tiers: Record<string, string[]> = {
    "seedream-5.0-pro": ["1K", "1.5K", "2K"], "seedream-5.0-lite": ["2K", "3K", "4K"],
    "seedream-4.5": ["2K", "4K"], "seedream-4.0": ["1K", "2K", "4K"],
  };
  if (tiers[model]?.includes(normalized)) return;
  const match = /^(\d{2,5})[X*×](\d{2,5})$/.exec(normalized);
  if (!match) throw new Error(`Seedream ${model} does not support size ${value}.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  const minimum = model === "seedream-4.5" || model === "seedream-5.0-lite" ? 3686400 : 921600;
  const maximum = model === "seedream-5.0-pro" ? 4624220 : 16777216;
  if (pixels < minimum || pixels > maximum || width > height * 16 || height > width * 16) {
    throw new Error(`Seedream ${model} size is outside its supported pixel or aspect-ratio range.`);
  }
}

function validateOperation(operation: DreamOperation, promptValue: string | undefined, inputs: InputMap, supplied: OperationParameters = {}) {
  const prompt = promptValue?.trim() ?? "";
  if (operation.promptSupported === false && prompt) throw new Error(`Operation ${operation.label} does not accept a prompt.`);
  if (operation.promptRequired !== false && !prompt) throw new Error("A prompt or TTS text is required for this operation.");
  if (prompt.length > (operation.promptMaxLength ?? 10000)) throw new Error(`Prompt must not exceed ${operation.promptMaxLength ?? 10000} characters.`);

  const parameters = operation.parameters ?? [];
  for (const id of Object.keys(supplied)) if (!parameters.some(definition => definition.id === id)) {
    throw new Error(`Operation ${operation.id} does not accept parameter "${id}".`);
  }
  const values = new Map<string, unknown>();
  for (const definition of parameters) {
    const value = Object.hasOwn(supplied, definition.id) ? supplied[definition.id]
      : definition.includeDefault ? definition.defaultValue : undefined;
    validateParameter(definition, value);
    if (value !== undefined && value !== null && value !== "") values.set(definition.id, value);
  }

  if (operation.special === "tryOn") {
    const upper = inputs.get("upperGarment")?.length ?? 0;
    const lower = inputs.get("lowerGarment")?.length ?? 0;
    const onePiece = inputs.get("onePieceGarment")?.length ?? 0;
    if (!upper && !lower && !onePiece) throw new Error("Virtual try-on requires an upper, lower, or one-piece garment image.");
    if (onePiece && (upper || lower) || upper + lower > 2) throw new Error("A one-piece garment cannot be combined with upper or lower garments.");
  }
  if (operation.special === "seedance") {
    if (inputs.get("lastFrame")?.length && !inputs.get("firstFrame")?.length) throw new Error("A last frame requires a first frame.");
    const taskType = values.get("omniReferenceTaskType");
    if ((taskType === "edit" || taskType === "extend") && !inputs.get("videos")?.length) throw new Error("Seedance edit/extend mode requires a reference video.");
    if ((taskType === "edit" || taskType === "extend") && (values.get("ratio") ?? "adaptive") !== "adaptive") {
      throw new Error("Seedance edit/extend mode only supports adaptive aspect ratio.");
    }
  }
  if (operation.special === "videoComposite") {
    const backgroundType = values.get("backgroundType");
    const hasImage = !!inputs.get("backgroundImage")?.length;
    const hasVideo = !!inputs.get("backgroundVideo")?.length;
    if (backgroundType === "color" && (!values.get("backgroundColor") || hasImage || hasVideo)) throw new Error("Color background requires backgroundColor and no background file.");
    if (backgroundType === "image" && (!hasImage || hasVideo)) throw new Error("Image background requires exactly one background image.");
    if (backgroundType === "video" && (!hasVideo || hasImage)) throw new Error("Video background requires exactly one background video.");
  }
  if (operation.id.startsWith("gptImage25")) {
    const width = values.get("width");
    const height = values.get("height");
    if (typeof width === "number" && typeof height === "number") {
      const pixels = width * height;
      if (pixels < 655360 || pixels > 8294400 || Math.max(width / height, height / width) > 3) {
        throw new Error("GPT Image 2.5 dimensions must satisfy its pixel and 3:1 aspect-ratio limits.");
      }
    }
  }
  if (operation.apiModel?.startsWith("seedream-") && typeof values.get("size") === "string") {
    validateSeedreamSize(operation.apiModel, values.get("size") as string);
  }
  return { prompt, values };
}

function setPath(body: Record<string, unknown>, path: string[], value: unknown) {
  let target = body;
  for (const part of path.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
  target[path.at(-1)!] = value;
}

async function uploadInput(context: ToolContext, path: string, mimeType: string, apiKey: string, signal: AbortSignal) {
  const extension = extensionByMime[mimeType];
  if (!extension) throw new Error(`DreamAPI upload does not support ${mimeType}.`);
  const bytes = await context.files.readFile(path);
  if (!bytes.byteLength) throw new Error("Input file is empty.");
  if (bytes.byteLength > maxFileBytes) throw new Error("Input files cannot exceed 100 MB.");

  const fileName = `toonflow-${crypto.randomUUID()}.${extension}`;
  const policy = await postJson("/api/file/v1/get_policy", { scene: "Dream-CN" }, apiKey, signal);
  const hostValue = typeof policy.host === "string" ? policy.host : "";
  const host = validateHttpsUrl(hostValue, "DreamAPI upload host");
  if (!host.hostname.toLowerCase().endsWith(".aliyuncs.com")) throw new Error("DreamAPI upload host is not an approved OSS endpoint.");
  const accessId = typeof policy.accessId === "string" ? policy.accessId : typeof policy.OSSAccessKeyId === "string" ? policy.OSSAccessKeyId : "";
  const key = typeof policy.key === "string" && policy.key ? policy.key
    : typeof policy.dir === "string" && policy.dir ? `${policy.dir}${fileName}` : "";
  const uploadPolicy = typeof policy.policy === "string" ? policy.policy : "";
  const signature = typeof policy.signature === "string" ? policy.signature : "";
  const callback = typeof policy.callback === "string" ? policy.callback : "";
  const policyReqId = typeof policy.reqId === "string" ? policy.reqId : "";
  if (!key || !accessId || !uploadPolicy || !signature) throw new Error("DreamAPI upload policy is incomplete.");

  const form = new FormData();
  form.append("key", key);
  form.append("policy", uploadPolicy);
  form.append("OSSAccessKeyId", accessId);
  form.append("signature", signature);
  form.append("callback", callback);
  form.append("success_action_status", "200");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
  let uploaded: Response;
  try {
    uploaded = await fetch(host, { method: "POST", body: form, redirect: "error", signal });
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
  if (!uploaded.ok) {
    await uploaded.body?.cancel();
    throw new DreamApiHttpError(uploaded.status);
  }
  let uploadPayload: unknown;
  try { uploadPayload = await uploaded.json(); }
  catch { throw new Error("DreamAPI input upload verification returned invalid JSON."); }
  const uploadedData = isRecord(uploadPayload) && isRecord(uploadPayload.data) ? uploadPayload.data : {};
  const requestId = typeof uploadedData.reqId === "string" ? uploadedData.reqId : policyReqId;
  if (!requestId) throw new Error("DreamAPI input upload verification has no request ID.");
  const finished = await postJson("/api/file/v1/policy_upload_finish", { reqId: requestId }, apiKey, signal);
  const url = validateHttpsUrl(finished.url, "DreamAPI uploaded file URL");
  return url.href;
}

async function buildRequestBody(context: ToolContext, operation: DreamOperation, request: DreamApiMediaRequest,
  inputs: InputMap, prompt: string, values: Map<string, unknown>, signal: AbortSignal) {
  const body: Record<string, unknown> = {};
  if (operation.apiModel) body.model = operation.apiModel;
  const promptField = operation.promptField ?? "prompt";
  if (operation.promptSupported !== false && (prompt || operation.promptRequired !== false)) body[promptField] = prompt;
  for (const definition of operation.inputs ?? []) {
    const selected = inputs.get(definition.id) ?? [];
    if (!selected.length) continue;
    const urls: string[] = [];
    for (const item of selected) {
      signal.throwIfAborted();
      const mimeType = await inputMimeType(context, item.path, definition);
      urls.push(await uploadInput(context, item.path, mimeType, request.apiKey, signal));
    }
    body[definition.field] = definition.array ? urls : urls[0];
  }
  for (const definition of operation.parameters ?? []) {
    const value = values.get(definition.id);
    if (value === undefined || value === null || value === "" || definition.omitFalse && value === false) continue;
    setPath(body, definition.path ?? [definition.field ?? definition.id], value);
  }
  if (operation.special === "seedance" && values.has("omniReferenceTaskType")) {
    body.omniReferenceTaskType = values.get("omniReferenceTaskType");
  }
  return body;
}

function wait(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => { finish(); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function isTransient(error: unknown) {
  return error instanceof TypeError || error instanceof DreamApiHttpError
    && (error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);
}

async function pollTask(taskId: string, apiKey: string, signal: AbortSignal, timeoutSeconds: number) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), signal);
    let result: Record<string, unknown>;
    try {
      result = await postJson("/api/getAsyncResult", { taskId }, apiKey, signal);
    } catch (error) {
      if (!isTransient(error)) throw error;
      await wait(Math.min(1000, Math.max(1, deadline - Date.now())), signal);
      try { result = await postJson("/api/getAsyncResult", { taskId }, apiKey, signal); }
      catch (retryError) {
        if (!isTransient(retryError)) throw retryError;
        throw new DreamApiTaskPendingError(taskId, "", "A temporary polling error occurred; resume the same taskId instead of submitting again.");
      }
    }
    const task = isRecord(result.task) ? result.task : {};
    const status = Number(task.status);
    if (status === 3) return result;
    if (status === 4) {
      const code = typeof task.errorCode === "string" || typeof task.errorCode === "number" ? String(task.errorCode) : "unknown";
      throw new Error(`DreamAPI task ${taskId} failed (code ${code}). Do not resubmit without checking with the user.`);
    }
    if (![0, 1, 2].includes(status)) throw new DreamApiTaskPendingError(taskId, "", "DreamAPI returned an unknown task status; resume the same taskId.");
  }
  throw new DreamApiTaskPendingError(taskId, "", "DreamAPI is still processing; resume the same taskId instead of submitting again.");
}

function resultUrls(result: Record<string, unknown>, operation: DreamOperation) {
  const values: { url: string; mediaType: DreamMediaType; suffix?: string }[] = [];
  const add = (value: unknown, mediaType: DreamMediaType, suffix?: string) => {
    if (typeof value === "string" && value) values.push({ url: value, mediaType, suffix });
  };
  const matting = isRecord(result.mattingResult) ? result.mattingResult : {};
  if (operation.id === "videoMatting") {
    add(matting.mattingFileUrl, "video", "matting");
    add(matting.mattingAlphaFileUrl, "video", "alpha");
  } else if (operation.id === "compositeAfterMatting") {
    add(matting.compositeFileUrl, "video", "composite");
  } else {
    const field = operation.type === "image" ? "images" : operation.type === "video" ? "videos" : "audios";
    const urlField = operation.type === "image" ? "imageUrl" : operation.type === "video" ? "videoUrl" : "audioUrl";
    const items = Array.isArray(result[field]) ? result[field] as unknown[] : [];
    for (const item of items) if (isRecord(item)) add(item[urlField], operation.type);
  }
  const seen = new Set<string>();
  return values.filter(item => {
    const url = validateHttpsUrl(item.url, "DreamAPI result URL").href;
    item.url = url;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function mimeFromUrl(url: URL) {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(url.pathname)?.[1]?.toLowerCase() ?? "";
  return mimeByExtension[extension];
}

function normalizeMime(value: string | null, url: URL) {
  const mimeType = value?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mimeType === "image/jpg") return "image/jpeg";
  if (mimeType && mimeType !== "application/octet-stream" && mimeType !== "binary/octet-stream") return mimeType;
  return mimeFromUrl(url) ?? "";
}

async function readBoundedResponse(response: Response, signal: AbortSignal) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxFileBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) throw new Error("DreamAPI returned an empty media response.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxFileBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new Error("DreamAPI returned an empty media file.");
  return Buffer.concat(chunks, total);
}

async function downloadMedia(urlValue: string, expectedType: DreamMediaType, signal: AbortSignal) {
  const url = validateHttpsUrl(urlValue, "DreamAPI result URL");
  let response: Response;
  try { response = await fetch(url, { redirect: "error", signal }); }
  catch (error) { signal.throwIfAborted(); throw new Error("Could not download the DreamAPI result.", { cause: error }); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DreamApiHttpError(response.status);
  }
  const mimeType = normalizeMime(response.headers.get("content-type"), url);
  if (!mimeType.startsWith(`${expectedType}/`) || !extensionByMime[mimeType]) {
    await response.body?.cancel();
    throw new Error("DreamAPI result has an unsupported media type.");
  }
  const bytes = await readBoundedResponse(response, signal);
  if (!bytes) return null;
  return { bytes, mimeType, extension: extensionByMime[mimeType] };
}

async function ensureAssetDirectory(context: ToolContext, toolCallId: string, signal: AbortSignal,
  onUpdate: ToolUpdateCallback, executionContext: ToolExecutionContext) {
  if (!context.assets) throw new Error("The Toonflow global asset library is unavailable; no generation was submitted.");
  try {
    await context.assets.execute(`${toolCallId}-asset-dir`, { action: "mkdir", path: "DreamAPI" }, signal, onUpdate, executionContext);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    // mkdir can report EEXIST for a file as well as an existing directory. Verify
    // the path through the host asset API before submitting a potentially billable task.
    const existing = await context.assets.execute(`${toolCallId}-asset-dir-check`,
      { action: "list", path: "DreamAPI", limit: 1 }, signal, onUpdate, executionContext);
    if (!isRecord(existing.details) || !Array.isArray(existing.details.items)) {
      throw new Error("The existing DreamAPI asset path could not be verified as a directory.");
    }
  }
}

function resultFileName(taskId: string, result: { url: string; suffix?: string }, extension: string) {
  const url = new URL(result.url);
  const digest = createHash("sha256").update(taskId).update("\0").update(url.origin).update(url.pathname).digest("hex").slice(0, 20);
  return `${digest}${result.suffix ? `-${result.suffix}` : ""}.${extension}`;
}

function fileHash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function saveResults(context: ToolContext, request: DreamApiMediaRequest, results: { url: string; mediaType: DreamMediaType; suffix?: string }[], signal: AbortSignal) {
  if (!context.assets) throw new Error("The Toonflow global asset library is unavailable; no generation was submitted.");
  if (!results.length) throw new Error("DreamAPI task completed without returning media files.");
  if (results.length > 20) throw new Error("DreamAPI returned too many output files (maximum 20).");

  await context.files.mkdir("assets/dreamapi", true);
  const saved: DreamApiSavedMedia[] = [];
  let archiveFailed = "";
  let assetDirectoryReady = false;
  try { await ensureAssetDirectory(context, request.toolCallId, signal, request.onUpdate, request.executionContext); assetDirectoryReady = true; }
  catch (error) { archiveFailed = error instanceof Error ? error.message : "Could not create the DreamAPI folder in the global asset library."; }

  for (const [index, result] of results.entries()) {
    signal.throwIfAborted();
    const remote = await downloadMedia(result.url, result.mediaType, signal);
    if (!remote) throw new DreamApiOutputTooLargeError(request.taskId ?? "unknown", results.map(item => item.url));
    const fileName = `${request.operation.id}-${resultFileName(request.taskId ?? "unknown", result, remote.extension)}`;
    const path = `assets/dreamapi/${fileName}`;
    try { await context.files.writeFile(path, remote.bytes, true); }
    catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = await context.files.readFile(path);
      if (fileHash(existing) !== fileHash(remote.bytes)) throw new Error("An existing workspace file conflicts with this DreamAPI task result; it was preserved.");
    }

    let assetLibraryPath: string | undefined;
    if (assetDirectoryReady && context.assets) {
      const target = `DreamAPI/${fileName}`;
      try {
        await context.assets.execute(`${request.toolCallId}-asset-${index}`, { action: "create", path: target, sourcePath: path }, signal,
          request.onUpdate, request.executionContext);
        assetLibraryPath = target;
      } catch (error) {
        if (errorCode(error) === "EEXIST") assetLibraryPath = target;
        else archiveFailed ||= error instanceof Error ? error.message : "Could not archive a result in the global asset library.";
      }
    }
    saved.push({ path, ...(assetLibraryPath ? { assetLibraryPath } : {}), mediaType: result.mediaType, mimeType: remote.mimeType, url: result.url });
  }
  return { saved, archiveFailed };
}

export async function generateDreamApiMedia(context: ToolContext, request: DreamApiMediaRequest, parentSignal?: AbortSignal) {
  if (!context.assets) throw new Error("The Toonflow global asset library is unavailable; no generation was submitted.");
  const operation = request.operation;
  let taskId = request.taskId;
  const timeoutSignal = AbortSignal.timeout(request.timeoutSeconds * 1000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;

  if (!taskId) {
    const inputs = await validateInputs(context, operation, request.inputs);
    const { prompt, values } = validateOperation(operation, request.prompt, inputs, request.parameters);
    await ensureAssetDirectory(context, request.toolCallId, signal, request.onUpdate, request.executionContext);
    const body = await buildRequestBody(context, operation, request, inputs, prompt, values, signal);
    signal.throwIfAborted();
    let submitted: Record<string, unknown>;
    try { submitted = await postJson(operation.endpoint, body, request.apiKey, signal); }
    catch (error) {
      const reason = error instanceof DreamApiHttpError ? `HTTP ${error.status}` : error instanceof Error ? error.message : "unknown error";
      throw new Error(`DreamAPI submission returned no taskId (${reason}). Check task history before retrying; do not blindly submit again.`);
    }
    taskId = typeof submitted.taskId === "string" ? submitted.taskId : "";
    if (!taskId) throw new Error("DreamAPI submission returned no taskId; do not resubmit until the account task history is checked.");
  }

  let completed: Record<string, unknown>;
  try { completed = await pollTask(taskId, request.apiKey, signal, request.timeoutSeconds); }
  catch (error) {
    if (error instanceof DreamApiTaskPendingError) throw new DreamApiTaskPendingError(taskId, operation.id, error.message);
    if (signal.aborted) throw new DreamApiTaskPendingError(taskId, operation.id, "The task may still be running; resume this same taskId, do not submit again.");
    throw error;
  }

  let urls: { url: string; mediaType: DreamMediaType; suffix?: string }[];
  try { urls = resultUrls(completed, operation); }
  catch (error) {
    throw new DreamApiTaskPendingError(taskId, operation.id,
      `The task completed but its media URL could not be validated. Resume with the same taskId; do not submit again. ${error instanceof Error ? error.message : ""}`);
  }
  if (!urls.length) throw new DreamApiTaskPendingError(taskId, operation.id, "The task completed without a recognized media URL; resume this same taskId, do not submit again.");
  try {
    const { saved, archiveFailed } = await saveResults(context, { ...request, taskId }, urls, signal);
    return { taskId, saved, archiveFailed };
  } catch (error) {
    if (error instanceof DreamApiOutputTooLargeError) throw error;
    if (signal.aborted) throw new DreamApiTaskPendingError(taskId, operation.id, "The task completed but saving was interrupted; resume this same taskId, do not submit again.");
    throw new DreamApiTaskPendingError(taskId, operation.id, `The task completed but its result was not fully saved. Resume this same taskId. ${error instanceof Error ? error.message : ""}`);
  }
}
