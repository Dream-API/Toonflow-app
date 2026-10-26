export type DreamMediaType = "image" | "video" | "audio";
export type DreamParameterType = "string" | "number" | "boolean";

export interface DreamInputDefinition {
  id: string;
  label: string;
  mediaType: DreamMediaType;
  field: string;
  required?: boolean;
  minItems?: number;
  maxItems?: number;
  array?: boolean;
  accept: string[];
}

export interface DreamParameterDefinition {
  id: string;
  label: string;
  type: DreamParameterType;
  required?: boolean;
  options?: (string | number)[];
  allowCustom?: boolean;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number | boolean;
  field?: string;
  path?: string[];
  includeDefault?: boolean;
  omitFalse?: boolean;
}

export interface DreamOperation {
  id: string;
  label: string;
  type: DreamMediaType;
  endpoint: string;
  apiModel?: string;
  promptRequired?: boolean;
  promptSupported?: boolean;
  promptMaxLength?: number;
  promptField?: string;
  inputs?: DreamInputDefinition[];
  parameters?: DreamParameterDefinition[];
  special?: "tryOn" | "seedance" | "videoComposite";
}

type InputOptions = Partial<Pick<DreamInputDefinition, "required" | "minItems" | "maxItems" | "array">> & { accept?: string[] };
type ParameterOptions = Partial<Omit<DreamParameterDefinition, "id" | "label" | "type">>;

const acceptedMediaTypes: Record<DreamMediaType, string[]> = {
  image: ["image/png", "image/jpeg", "image/bmp", "image/webp", "image/gif"],
  video: ["video/mp4", "video/x-msvideo", "video/quicktime", "video/x-matroska", "video/webm"],
  audio: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/flac"],
};

const videoTranslateLanguages = ["en", "zh", "es"];

function input(id: string, label: string, mediaType: DreamMediaType, field: string, options: InputOptions = {}): DreamInputDefinition {
  return { id, label, mediaType, field, accept: acceptedMediaTypes[mediaType], ...options };
}

function parameter(id: string, label: string, type: DreamParameterType, options: ParameterOptions = {}): DreamParameterDefinition {
  return { id, label, type, ...options };
}

export const dreamApiOperations: DreamOperation[] = [
  {
    id: "fluxTextToImage", label: "Flux 文生图", type: "image", endpoint: "/api/async/flux_text2image",
    promptRequired: true,
    parameters: [
      parameter("width", "宽度", "number", { min: 16, max: 1600, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("height", "高度", "number", { min: 16, max: 1600, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("num", "生成数量", "number", { min: 1, max: 10, step: 1 }),
      parameter("seed", "随机种子", "number", { step: 1 }),
    ],
  },
  {
    id: "fluxImageToImage", label: "Flux 图生图", type: "image", endpoint: "/api/async/flux_image2image",
    promptRequired: true,
    inputs: [input("image", "参考图片", "image", "imageUrl", { required: true, minItems: 1, maxItems: 1 })],
    parameters: [
      parameter("width", "宽度", "number", { min: 16, max: 1600, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("height", "高度", "number", { min: 16, max: 1600, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("num", "生成数量", "number", { min: 1, max: 10, step: 1 }),
      parameter("seed", "随机种子", "number", { step: 1 }),
    ],
  },
  {
    id: "dreamImage20", label: "DreamImage 2.0", type: "image", endpoint: "/api/async/dreamimage_2.0",
    promptRequired: true,
    inputs: [input("sourceImage", "待编辑图片", "image", "image", { required: true, minItems: 1, maxItems: 1 })],
  },
  { id: "colorize", label: "黑白照片上色", type: "image", endpoint: "/api/async/colorize", promptRequired: false, promptSupported: false,
    inputs: [input("sourceImage", "待上色图片", "image", "url", { required: true, minItems: 1, maxItems: 1 })] },
  { id: "enhanceImage", label: "图片增强", type: "image", endpoint: "/api/async/enhance", promptRequired: false, promptSupported: false,
    inputs: [input("sourceImage", "待增强图片", "image", "imageUrl", { required: true, minItems: 1, maxItems: 1 })] },
  { id: "outpainting", label: "图片扩图", type: "image", endpoint: "/api/async/outpainting", promptRequired: false, promptSupported: false,
    inputs: [input("sourceImage", "原始图片", "image", "url", { required: true, minItems: 1, maxItems: 1 })],
    parameters: [
      parameter("left", "向左扩展像素", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["outPaintSize", "left"] }),
      parameter("right", "向右扩展像素", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["outPaintSize", "right"] }),
      parameter("top", "向上扩展像素", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["outPaintSize", "top"] }),
      parameter("bottom", "向下扩展像素", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["outPaintSize", "bottom"] }),
    ] },
  { id: "swapFaceImage", label: "图片换脸", type: "image", endpoint: "/api/async/swap_face", promptRequired: false, promptSupported: false,
    inputs: [
      input("targetImage", "目标图片", "image", "url", { required: true, minItems: 1, maxItems: 1 }),
      input("faceImage", "人脸图片", "image", "faceImgUrl", { required: true, minItems: 1, maxItems: 1 }),
    ] },
  { id: "removeBackground", label: "图片抠像", type: "image", endpoint: "/api/async/remove_background", promptRequired: false, promptSupported: false,
    inputs: [input("sourceImage", "待抠像图片", "image", "url", { required: true, minItems: 1, maxItems: 1 })] },
  { id: "virtualTryOn", label: "虚拟试衣", type: "image", endpoint: "/api/async/tryon_clothes", promptRequired: false,
    inputs: [
      input("modelImage", "人物图片", "image", "modelImage", { required: true, minItems: 1, maxItems: 1 }),
      input("upperGarment", "上装图片", "image", "upperClothes", { maxItems: 1 }),
      input("lowerGarment", "下装图片", "image", "lowerClothes", { maxItems: 1 }),
      input("onePieceGarment", "连衣裙/连体装图片", "image", "overallClothes", { maxItems: 1 }),
    ],
    parameters: [
      parameter("enableShoes", "生成鞋子", "boolean", { defaultValue: false, omitFalse: true }),
      parameter("width", "输出宽度", "number", { min: 1, step: 1 }),
      parameter("height", "输出高度", "number", { min: 1, step: 1 }),
    ], special: "tryOn" },
  ...[
    { id: "seedream40", label: "Seedream 4.0", apiModel: "seedream-4.0", sizes: ["1K", "2K", "4K"] },
    { id: "seedream45", label: "Seedream 4.5", apiModel: "seedream-4.5", sizes: ["2K", "4K"] },
    { id: "seedream50Lite", label: "Seedream 5.0 Lite", apiModel: "seedream-5.0-lite", sizes: ["2K", "3K", "4K"] },
    { id: "seedream50Pro", label: "Seedream 5.0 Pro", apiModel: "seedream-5.0-pro", sizes: ["1K", "1.5K", "2K"] },
  ].map(({ id, label, apiModel, sizes }): DreamOperation => ({
    id, label, type: "image", endpoint: "/api/async/seedream", apiModel, promptRequired: true,
    inputs: [input("images", "参考图片（可选）", "image", "image", { array: true, maxItems: 10 })],
    parameters: [parameter("size", "输出尺寸", "string", { options: sizes, allowCustom: true }), parameter("seed", "随机种子", "number", { step: 1 })],
  })),
  ...[
    { id: "nanoBanana2", label: "Nano Banana 2", apiModel: "gemini-3.1-flash-image-preview", imageSizes: ["512", "1K", "2K", "4K"] },
    { id: "nanoBananaPro", label: "Nano Banana Pro", apiModel: "gemini-3-pro-image-preview", imageSizes: ["1K", "2K"] },
  ].map(({ id, label, apiModel, imageSizes }): DreamOperation => ({
    id, label, type: "image", endpoint: "/api/async/google_gemini_image", apiModel, promptRequired: true,
    promptField: "text", inputs: [input("images", "参考图片（可选）", "image", "images", { array: true })],
    parameters: [parameter("imageSize", "输出尺寸", "string", { options: imageSizes }), parameter("aspectRatio", "画面比例", "string")],
  })),
  { id: "gptImage2", label: "GPT Image 2", type: "image", endpoint: "/api/async/gpt_image", promptRequired: true, promptMaxLength: 4000,
    inputs: [input("images", "参考图片（可选）", "image", "images", { array: true, maxItems: 4 })],
    parameters: [
      parameter("width", "宽度", "number", { min: 16, max: 3840, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("height", "高度", "number", { min: 16, max: 3840, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("quality", "画质", "string", { options: ["low", "medium", "high"], defaultValue: "low", includeDefault: true }),
      parameter("n", "生成数量", "number", { min: 1, max: 10, step: 1, defaultValue: 1, includeDefault: true }),
    ] },
  ...[
    { id: "gptImage25FlareTextToImage", label: "GPT Image 2.5 Flare 文生图", route: "flare/text_to_image", withImages: false },
    { id: "gptImage25FlareImageToImage", label: "GPT Image 2.5 Flare 图生图", route: "flare/image_to_image", withImages: true },
    { id: "gptImage25SunburstTextToImage", label: "GPT Image 2.5 Sunburst 文生图", route: "sunburst/text_to_image", withImages: false },
    { id: "gptImage25SunburstImageToImage", label: "GPT Image 2.5 Sunburst 图生图", route: "sunburst/image_to_image", withImages: true },
  ].map(({ id, label, route, withImages }): DreamOperation => ({
    id, label, type: "image", endpoint: `/api/async/gpt_image_2.5/${route}`, promptRequired: true, promptMaxLength: 4000,
    ...(withImages ? { inputs: [input("images", "参考图片", "image", "images", { required: true, minItems: 1, maxItems: 4, array: true })] } : {}),
    parameters: [
      parameter("width", "宽度", "number", { min: 16, max: 3840, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("height", "高度", "number", { min: 16, max: 3840, step: 16, defaultValue: 1024, includeDefault: true }),
      parameter("quality", "画质", "string", { options: ["low", "medium", "high", "xhigh", "max"], defaultValue: "low", includeDefault: true }),
      parameter("n", "生成数量", "number", { min: 1, max: 10, step: 1, defaultValue: 1, includeDefault: true }),
    ],
  })),
  { id: "wan21TextToVideo", label: "Wan 2.1 文生视频", type: "video", endpoint: "/api/async/wan/text_to_video/2.1", promptRequired: true, promptMaxLength: 1500,
    parameters: [parameter("resolution", "分辨率", "string", { options: ["480p", "720p"] })] },
  { id: "wan21ImageToVideo", label: "Wan 2.1 图生视频", type: "video", endpoint: "/api/async/wan/image_to_video/2.1", promptRequired: true, promptMaxLength: 1500,
    inputs: [input("sourceImage", "首帧图片", "image", "image", { required: true, minItems: 1, maxItems: 1 })],
    parameters: [parameter("resolution", "分辨率", "string", { options: ["480p", "720p"] })] },
  { id: "wan21HeadTailToVideo", label: "Wan 2.1 首尾帧视频", type: "video", endpoint: "/api/async/wan/head_tail_to_video/2.1", promptRequired: true, promptMaxLength: 1500,
    inputs: [
      input("firstFrame", "首帧图片", "image", "firstImage", { required: true, minItems: 1, maxItems: 1 }),
      input("lastFrame", "尾帧图片", "image", "lastImage", { required: true, minItems: 1, maxItems: 1 }),
    ] },
  { id: "dreamVideo30TextToVideo", label: "DreamVideo 3.0 文生视频", type: "video", endpoint: "/api/async/dreamvideo_3.0/text_to_video", promptRequired: true,
    parameters: [
      parameter("duration", "时长（秒）", "number", { min: 3, max: 15, step: 1 }),
      parameter("resolution", "分辨率", "string", { options: ["480P", "720P"] }),
      parameter("aspectRatio", "画面比例", "string", { options: ["auto", "9:16", "3:4", "1:1", "4:3", "16:9"] }),
      parameter("seed", "随机种子", "number", { step: 1 }),
    ] },
  { id: "dreamVideo30ImageToVideo", label: "DreamVideo 3.0 图生视频", type: "video", endpoint: "/api/async/dreamvideo_3.0/image_to_video", promptRequired: true,
    inputs: [input("images", "首帧/尾帧图片", "image", "images", { required: true, minItems: 1, maxItems: 2, array: true })],
    parameters: [
      parameter("duration", "时长（秒）", "number", { min: 3, max: 15, step: 1 }),
      parameter("resolution", "分辨率", "string", { options: ["480P", "720P"] }),
      parameter("aspectRatio", "画面比例", "string", { options: ["auto", "9:16", "3:4", "1:1", "4:3", "16:9"] }),
      parameter("seed", "随机种子", "number", { step: 1 }),
    ] },
  {
    id: "seedance25", label: "Seedance 2.5", type: "video", endpoint: "/api/async/seedance_2.5", apiModel: "seedance-2.5", promptRequired: true, promptMaxLength: 1500, special: "seedance",
    inputs: [
      input("images", "参考图片", "image", "images", { array: true, maxItems: 9 }),
      input("firstFrame", "首帧图片", "image", "imageUrl", { maxItems: 1 }),
      input("lastFrame", "尾帧图片", "image", "endImageUrl", { maxItems: 1 }),
      input("videos", "参考视频", "video", "videos", { array: true, maxItems: 10 }),
      input("audios", "参考音频", "audio", "audios", { array: true, maxItems: 3 }),
    ],
    parameters: [
      parameter("resolution", "分辨率", "string", { required: true, options: ["480p", "720p", "1080p"] }),
      parameter("duration", "时长（秒）", "number", { required: true, min: 4, max: 30, step: 1 }),
      parameter("ratio", "画面比例", "string", { defaultValue: "adaptive", includeDefault: true }),
      parameter("seed", "随机种子", "number", { step: 1 }),
      parameter("generateAudio", "生成视频声音", "boolean", { defaultValue: false, omitFalse: true }),
      parameter("omniReferenceTaskType", "参考视频任务模式", "string", { options: ["reference", "edit", "extend"] }),
    ],
  },
  ...[
    { id: "seedance20", label: "Seedance 2.0", apiModel: "seedance-2.0", resolutions: ["480p", "720p", "1080p", "4k"], durationMax: 15, videoMax: 3 },
    { id: "seedance20Mini", label: "Seedance 2.0 Mini", apiModel: "seedance-2.0-mini", resolutions: ["480p", "720p"], durationMax: 15, videoMax: 3 },
  ].map(({ id, label, apiModel, resolutions, durationMax, videoMax }): DreamOperation => ({
    id, label, type: "video", endpoint: "/api/async/seedance_2.0", apiModel, promptRequired: true, promptMaxLength: 1500, special: "seedance",
    inputs: [
      input("images", "参考图片", "image", "images", { array: true, maxItems: 9 }),
      input("firstFrame", "首帧图片", "image", "imageUrl", { maxItems: 1 }),
      input("lastFrame", "尾帧图片", "image", "endImageUrl", { maxItems: 1 }),
      input("videos", "参考视频", "video", "videos", { array: true, maxItems: videoMax }),
      input("audios", "参考音频", "audio", "audios", { array: true, maxItems: 3 }),
    ],
    parameters: [
      parameter("resolution", "分辨率", "string", { required: true, options: resolutions }),
      parameter("duration", "时长（秒）", "number", { required: true, min: 4, max: durationMax, step: 1 }),
      parameter("ratio", "画面比例", "string", { defaultValue: "adaptive", includeDefault: true }),
      parameter("seed", "随机种子", "number", { step: 1 }),
      parameter("generateAudio", "生成视频声音", "boolean", { defaultValue: false, omitFalse: true }),
    ],
  })),
  {
    id: "lipSync", label: "LipSync", type: "video", endpoint: "/api/async/lipsync", promptRequired: false, promptSupported: false,
    inputs: [
      input("sourceVideo", "源视频", "video", "srcVideoUrl", { required: true, minItems: 1, maxItems: 1 }),
      input("audio", "驱动音频", "audio", "audioUrl", { required: true, minItems: 1, maxItems: 1 }),
    ],
    parameters: [
      parameter("videoWidth", "输出宽度（0 保持原尺寸）", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["videoParams", "video_width"] }),
      parameter("videoHeight", "输出高度（0 保持原尺寸）", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["videoParams", "video_height"] }),
      parameter("videoEnhance", "画质增强", "boolean", { defaultValue: false, includeDefault: true, path: ["videoParams", "video_enhance"] }),
    ],
  },
  {
    id: "lipSync20", label: "LipSync 2.0", type: "video", endpoint: "/api/async/lipsync/2.0", promptRequired: false, promptSupported: false,
    inputs: [
      input("sourceVideo", "源视频", "video", "srcVideoUrl", { required: true, minItems: 1, maxItems: 1 }),
      input("audio", "原始音频", "audio", "audioUrl", { required: true, minItems: 1, maxItems: 1 }),
      input("vocalAudio", "人声分离音频（可选）", "audio", "vocalAudioUrl", { maxItems: 1 }),
    ],
    parameters: [
      parameter("videoWidth", "输出宽度（0 保持原尺寸）", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["videoParams", "video_width"] }),
      parameter("videoHeight", "输出高度（0 保持原尺寸）", "number", { min: 0, step: 1, defaultValue: 0, includeDefault: true, path: ["videoParams", "video_height"] }),
      parameter("videoEnhanceLevel", "增强等级", "number", { min: 0, max: 1, step: 1, defaultValue: 1, includeDefault: true, path: ["videoParams", "video_enhance"] }),
      parameter("fps", "帧率", "string", { options: ["25", "original"] }),
    ],
  },
  {
    id: "dreamAvatar30Fast", label: "DreamAvatar 3.0 Fast", type: "video", endpoint: "/api/async/dreamavatar/image_to_video/3.0fast", promptRequired: true,
    inputs: [
      input("portrait", "人物肖像图片", "image", "image", { required: true, minItems: 1, maxItems: 1 }),
      input("audio", "驱动音频", "audio", "audio", { required: true, minItems: 1, maxItems: 1 }),
    ],
    parameters: [parameter("resolution", "分辨率", "string", { options: ["480p", "720p"] })],
  },
  {
    id: "dreamact", label: "Dreamact 动作迁移", type: "video", endpoint: "/api/async/wan/dreamact/2.1", promptRequired: false, promptSupported: false,
    inputs: [
      input("drivingVideo", "动作驱动视频", "video", "video", { required: true, minItems: 1, maxItems: 1 }),
      input("referenceImages", "角色参考图片", "image", "images", { required: true, minItems: 1, array: true }),
    ],
    parameters: [
      parameter("seed", "随机种子", "number", { step: 1, defaultValue: 42, includeDefault: true }),
      parameter("resolution", "分辨率", "string", { options: ["480P", "720P"], defaultValue: "480P", includeDefault: true }),
      parameter("taskMode", "动作模式", "string", { options: ["replace_body", "pose2v"], defaultValue: "replace_body", includeDefault: true }),
      parameter("qualityMode", "质量模式", "string", { options: ["high", "base"], defaultValue: "base", includeDefault: true }),
    ],
  },
  { id: "swapFaceVideo", label: "视频换脸", type: "video", endpoint: "/api/async/swap_face_for_video", promptRequired: false, promptSupported: false,
    inputs: [
      input("sourceVideo", "源视频", "video", "srcVideoUrl", { required: true, minItems: 1, maxItems: 1 }),
      input("faceImage", "人脸图片", "image", "srcImgUrl", { required: true, minItems: 1, maxItems: 1 }),
    ] },
  { id: "videoMatting", label: "视频抠像", type: "video", endpoint: "/api/async/image_matting_process_video", promptRequired: false, promptSupported: false,
    inputs: [input("sourceVideo", "源视频", "video", "srcFileUrl", { required: true, minItems: 1, maxItems: 1, accept: ["video/mp4"] })],
    parameters: [parameter("bitRate", "目标码率", "string"), parameter("removeColorSpill", "去除边缘色溢", "boolean", { omitFalse: true })] },
  {
    id: "compositeAfterMatting", label: "视频抠像背景合成", type: "video", endpoint: "/api/async/image_matting_composite_video", promptRequired: false, promptSupported: false, special: "videoComposite",
    inputs: [
      input("sourceVideo", "原始视频", "video", "srcFileUrl", { required: true, minItems: 1, maxItems: 1 }),
      input("alphaVideo", "Alpha 抠像视频", "video", "mattingAlphaFileUrl", { required: true, minItems: 1, maxItems: 1 }),
      input("backgroundImage", "背景图片（背景类型为 image 时）", "image", "backgroundUrl", { maxItems: 1 }),
      input("backgroundVideo", "背景视频（背景类型为 video 时）", "video", "backgroundUrl", { maxItems: 1 }),
    ],
    parameters: [
      parameter("backgroundType", "背景类型", "string", { required: true, options: ["color", "image", "video"] }),
      parameter("backgroundColor", "背景颜色（十六进制）", "string"),
    ],
  },
  { id: "videoWatermarkRemover", label: "视频去水印", type: "video", endpoint: "/api/async/video_watermark_remover", promptRequired: false,
    inputs: [input("sourceVideo", "待处理视频", "video", "video", { required: true, minItems: 1, maxItems: 1 })],
    parameters: [parameter("seed", "随机种子", "number", { step: 1 })] },
  { id: "videoEnhance", label: "视频增强", type: "video", endpoint: "/api/async/video_super_resolution", promptRequired: false, promptSupported: false,
    inputs: [input("sourceVideo", "待增强视频", "video", "srcVideoUrl", { required: true, minItems: 1, maxItems: 1 })] },
  { id: "videoTranslate20", label: "Video Translate 2.0", type: "video", endpoint: "/api/async/video_translate/2.0", promptRequired: false, promptSupported: false,
    inputs: [input("sourceVideo", "待翻译视频", "video", "videoUrl", { required: true, minItems: 1, maxItems: 1 })],
    parameters: [
      parameter("sourceLanguage", "原语言", "string", { required: true, options: videoTranslateLanguages }),
      parameter("targetLanguage", "目标语言", "string", { required: true, options: videoTranslateLanguages }),
      parameter("enableLipSync", "启用口型同步", "boolean", { defaultValue: true, includeDefault: true }),
    ] },
  { id: "ttsClone", label: "TTS Clone", type: "audio", endpoint: "/api/async/do_tts_clone", promptRequired: true, promptField: "text",
    parameters: [
      parameter("cloneId", "已创建的音色 cloneId", "string", { required: true }),
      parameter("language", "语种代码", "string", { required: true, field: "lan" }),
    ] },
  { id: "ttsCommon", label: "TTS Common", type: "audio", endpoint: "/api/async/do_tts_common", promptRequired: true, promptField: "text",
    parameters: [
      parameter("audioId", "有效的 Common 音色 ID", "string", { required: true }),
      parameter("language", "语种代码", "string", { required: true, field: "lan" }),
    ] },
  { id: "ttsPro", label: "TTS Pro", type: "audio", endpoint: "/api/async/do_tts_pro", promptRequired: true, promptField: "text",
    parameters: [
      parameter("audioId", "有效的 Pro 音色 ID", "string", { required: true }),
      parameter("language", "语种代码", "string", { required: true, field: "lan" }),
    ] },
];

export function findDreamApiOperation(id: string): DreamOperation {
  const operation = dreamApiOperations.find(item => item.id === id);
  if (!operation) throw new Error("所选 DreamAPI 操作不存在");
  return operation;
}

export const dreamApiOperationIds = dreamApiOperations.map(operation => operation.id) as [string, ...string[]];

export function listDreamApiOperations(type?: DreamMediaType) {
  return dreamApiOperations.filter(operation => !type || operation.type === type).map(operation => ({
    id: operation.id,
    label: operation.label,
    mediaType: operation.type,
    promptRequired: operation.promptRequired !== false,
    promptSupported: operation.promptSupported !== false,
    promptMaxLength: operation.promptMaxLength ?? 10000,
    inputs: (operation.inputs ?? []).map(({ id, label, mediaType, required, minItems, maxItems, accept }) => ({
      id, label, mediaType, required: required === true, minItems: minItems ?? (required ? 1 : 0), maxItems: maxItems ?? 1, accept,
    })),
    parameters: (operation.parameters ?? []).map(({ id, label, type, required, options, min, max, step, defaultValue }) => ({
      id, label, type, required: required === true, ...(options ? { options } : {}), ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}), ...(step !== undefined ? { step } : {}), ...(defaultValue !== undefined ? { defaultValue } : {}),
    })),
  }));
}
