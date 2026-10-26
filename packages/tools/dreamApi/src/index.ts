import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { DreamApiOutputTooLargeError, DreamApiTaskPendingError, generateDreamApiMedia, type DreamApiSavedMedia } from "./dreamApi";
import { dreamApiOperationIds, findDreamApiOperation, listDreamApiOperations } from "./operations";

type DreamApiToolDetails = {
  status: "completed" | "pending" | "completed_not_archived";
  taskId: string;
  operationId?: string;
  media?: DreamApiSavedMedia[];
  archiveFailed?: string;
  urls?: string[];
};

function toolResult(text: string, details: DreamApiToolDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

const configSchema = z.strictObject({
  apiKey: z.string().trim().max(4096).default(""),
  timeoutSeconds: z.number().int().min(60).max(1800).default(600),
});
const operationIdSchema = z.enum(dreamApiOperationIds);
const listOperationsSchema = z.strictObject({ mediaType: z.enum(["image", "video", "audio"]).optional() });
const workspacePathSchema = z.string().trim().min(1).max(4096).refine(path => {
  const normalized = path.replaceAll("\\", "/");
  return !/^[\\/]|^[a-z][a-z\d+.-]*:/i.test(path) && !/[\u0000-\u001f]/.test(path)
    && !normalized.split("/").some(part => !part || part === "." || part === "..");
}, "Use a workspace-relative path without . or .. segments.");
const inputFilesSchema = z.record(z.string().trim().min(1).max(64), z.array(z.strictObject({ path: workspacePathSchema })).min(1).max(20))
  .superRefine((inputs, issue) => {
    if (Object.keys(inputs).length > 16) issue.addIssue({ code: "custom", message: "At most 16 input roles may be provided." });
  });
const parametersSchema = z.record(z.string().trim().min(1).max(64), z.union([
  z.string().max(4096), z.number().finite(), z.boolean(),
])).superRefine((parameters, issue) => {
  if (Object.keys(parameters).length > 64) issue.addIssue({ code: "custom", message: "At most 64 operation parameters may be provided." });
});
const generateSchema = z.strictObject({
  operationId: operationIdSchema,
  taskId: z.string().trim().min(1).max(256).optional().describe("Resume an existing DreamAPI task; do not resubmit it."),
  prompt: z.string().max(10000).optional().describe("Prompt or TTS text. Follow the selected operation's requirements."),
  inputs: inputFilesSchema.optional().describe("Map each input role from listDreamApiOperations to one or more existing workspace-relative file paths."),
  parameters: parametersSchema.optional().describe("Only parameters listed for the selected operation."),
}).superRefine((request, issue) => {
  if (request.taskId && (request.prompt !== undefined || request.inputs !== undefined || request.parameters !== undefined)) {
    issue.addIssue({ code: "custom", path: ["taskId"], message: "When resuming a task, provide only operationId and taskId." });
  }
});

function apiKeyFromConfig(config: Record<string, unknown>) {
  const raw = configSchema.parse(config).apiKey;
  const apiKey = raw.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) throw new Error("Configure your own DreamAPI API Key in the DreamAPI tool settings first.");
  return apiKey;
}

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    const config = configSchema.parse(context.config);
    const tools: ToolDefinition[] = [
      context.sdk.defineTool({
        name: "listDreamApiOperations",
        label: "List DreamAPI Operations",
        description: "List supported DreamAPI image, video, and audio operations, their required input roles, prompt behavior, and operation-specific parameters. Use this before generating media.",
        promptSnippet: "List DreamAPI's supported operations and exact input roles and parameters.",
        parameters: z.toJSONSchema(listOperationsSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params) {
          const { mediaType } = listOperationsSchema.parse(params);
          const operations = listDreamApiOperations(mediaType);
          return { content: [{ type: "text", text: JSON.stringify({ operations }) }], details: { operations } };
        },
      }),
      context.sdk.defineTool({
        name: "generateDreamApiMedia",
        label: "Generate DreamAPI Media",
        description: "Generate or process image, video, or audio media with the selected DreamAPI operation. Inputs must be existing workspace-relative file paths. Results are saved to the workspace and Toonflow global asset library. A normal call submits one potentially billable task; resume with the returned taskId after any timeout.",
        promptSnippet: "Generate DreamAPI media and save the finished file into the workspace and global asset library.",
        promptGuidelines: [
          "Before a new generation, call listDreamApiOperations and follow that operation's required input roles and parameters exactly.",
          "Only submit one new DreamAPI task per user request. If any call returns a taskId without a saved result, call generateDreamApiMedia with only the same operationId and taskId; never submit another task to recover a timeout.",
          "Never put the DreamAPI API Key in tool arguments, prompts, filenames, output paths, or user-visible results. Use only workspace-relative paths for input files.",
        ],
        parameters: z.toJSONSchema(generateSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(toolCallId, params, signal, onUpdate, executionContext) {
          const request = generateSchema.parse(params);
          const operation = findDreamApiOperation(request.operationId);
          const apiKey = apiKeyFromConfig(context.config);
          if (!context.assets) throw new Error("The Toonflow global asset library is unavailable; no generation was submitted.");
          try {
            const result = await generateDreamApiMedia(context, {
              operation,
              ...(request.taskId ? { taskId: request.taskId } : {}),
              ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
              ...(request.inputs ? { inputs: request.inputs } : {}),
              ...(request.parameters ? { parameters: request.parameters } : {}),
              apiKey,
              timeoutSeconds: config.timeoutSeconds,
              toolCallId,
              onUpdate,
              executionContext,
            }, signal);
            const lines = result.saved.map(asset => [
              `${asset.mediaType}: ${asset.path}`,
              asset.assetLibraryPath ? `Global asset library: ${asset.assetLibraryPath}` : "Global asset library archive failed; workspace file was preserved.",
              asset.mediaType === "image" ? `![DreamAPI result](<${asset.path}>)` : "",
            ].filter(Boolean).join("\n"));
            const archiveNotice = result.archiveFailed ? `\n\nGlobal asset library archive issue: ${result.archiveFailed}` : "";
            const text = `DreamAPI task ${result.taskId} completed.\n${lines.join("\n\n")}${archiveNotice}`;
            return toolResult(text, { status: "completed", taskId: result.taskId, media: result.saved,
              ...(result.archiveFailed ? { archiveFailed: result.archiveFailed } : {}) });
          } catch (error) {
            if (error instanceof DreamApiTaskPendingError) {
              const text = `DreamAPI task is not fully saved yet. Resume without submitting again by calling generateDreamApiMedia with only operationId "${error.operationId || operation.id}" and taskId "${error.taskId}".\n${error.message}`;
              return toolResult(text, { status: "pending", taskId: error.taskId, operationId: error.operationId || operation.id });
            }
            if (error instanceof DreamApiOutputTooLargeError) {
              const links = error.urls.map(url => `<${url}>`).join("\n");
              const text = `DreamAPI task ${error.taskId} completed, but Toonflow's global asset library accepts files up to 100 MB. Do not resubmit this task. The result URL(s) remain available from the completed task:\n${links}`;
              return toolResult(text, { status: "completed_not_archived", taskId: error.taskId, urls: error.urls });
            }
            throw error;
          }
        },
      }),
    ];
    return tools;
  },
};

export default plugin;
