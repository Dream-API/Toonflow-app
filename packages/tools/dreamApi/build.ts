import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "dreamApi",
  displayName: "DreamAPI",
  description: "通过 DreamAPI 生成或处理图片、视频与音频，并将结果保存到工作区和 Toonflow 全局素材库。",
  author: "DreamAPI",
  github: "https://github.com/dreamfaceapp/skill",
  prompt: `DreamAPI 是 Agent 素材工具，不是媒体模型下拉项或画布生成节点。
先使用 listDreamApiOperations 查询当前支持的操作、素材角色和参数，再根据用户要求选择最匹配的一项。
输入素材只使用当前工作区内已存在的相对路径；不要把 API Key 放进工具参数、提示词、文件名或结果中。
单次生成调用会提交一个可能计费的任务。若返回 taskId 或等待超时，只使用同一 taskId 恢复查询，不要重新提交生成。
成功后确认工具返回的工作区路径与全局素材库路径；不要仅返回远程链接。`,
  configRules: [
    {
      type: "input",
      field: "apiKey",
      title: "DreamAPI API Key",
      value: "",
      props: { type: "password", showPassword: true, autocomplete: "new-password", placeholder: "在此填写你自己的 DreamAPI API Key" },
    },
    {
      type: "inputNumber",
      field: "timeoutSeconds",
      title: "单次任务等待超时（秒）",
      value: 600,
      props: { min: 60, max: 1800, step: 60, stepStrictly: true },
    },
  ],
}, import.meta.url);
