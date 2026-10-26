# DreamAPI Agent 插件设计

## 目标与维护者反馈

按 Toonflow #354 维护者“改动变化过大，该需求可以使用插件实现”的意见，改为贡献一个独立、可配置的 DreamAPI Agent 工具插件。减少对 Toonflow 公共媒体请求、节点与服务端逻辑的侵入，同时覆盖 DreamAPI Skill 中产出图片、视频或音频素材的操作。

## 已核对的现有架构

- `packages/toolScaffold/src/runtime.ts` 定义 `ToolPlugin` 为 `validateConfig` 与 `createTools(context)`；工具上下文提供经过校验的插件专属 `config` 和统一工作区文件接口。
- `packages/toolScaffold/readme.md:3-17,27-29` 说明 `packages/tools/<name>` 可独立打包为 `.tool.js`，插件配置只属于该工具，`context.files` 将写入限制在当前工作区。
- `packages/tools/mediaGeneration/src/runtime.ts:12-55` 当前 Agent 媒体工具只包含通用提示词、媒体路径与常见画幅/时长/音色字段；这不足以呈现 DreamAPI 每项操作的专属角色输入与参数。
- `packages/tools/assetOperator/src/runtime.ts` 定义全局素材库 `create` 动作的 `{path, sourcePath}` 契约；`apps/server/src/agent/assets.ts` 通过 `ToolContext.assets.execute` 将工作区文件复制到全局素材库，并限制单个文件不超过 100 MB。
- `docs/development.md:11-20,27-45` 将“工具”和“媒体提供方”列为不同扩展类型；工具可通过内置构建或桌面插件安装，媒体提供方单独安装为 `.ts`。
- `package.json:20-25,49` 已将 `packages/tools/*` 纳入 Bun workspace 和工具构建命令；`apps/server/src/app.ts:46-48` 从构建目录初始化工具插件。

## 设计决策

新增 `packages/tools/dreamApi` 工具包，不改 `packages/providers`、`packages/tools/mediaGeneration`、节点、服务端路由或公共请求类型。

插件提供两个 Agent 工具：

1. `listDreamApiOperations`：返回支持的素材操作、媒体输入角色、提示词要求和参数定义，供 Agent 先查询再调用。
2. `generateDreamApiMedia`：接收操作 ID、工作区内的输入素材路径、该操作的提示词与参数，并在服务端调用 DreamAPI。

操作清单以 DreamAPI Skill 中会产出图片、视频或音频的操作为界，覆盖文生/图生、图片编辑、视频生成/处理、口型同步/数字人、视频翻译及语音合成等；不把查询、账户或纯文本能力包装为媒体生成操作。逐项的 API 字段必须按 DreamAPI 当前 Skill/接口文档核验后保留，不从名称推断。

DreamAPI API Key 由用户在插件自己的密码型配置项填写，通过 Toonflow 服务端插件配置读取；不进入源码、Agent 参数或日志。参考文件从当前工作区读取后按 DreamAPI 上传流程发送；只提交一次生成任务，按返回 task ID 轮询，不因超时自动重复提交。完成后将结果写入工作区 `assets/dreamapi/`，再通过 `ToolContext.assets.execute` 的 `create` 动作归档到 Toonflow 全局素材库 `DreamAPI/` 目录，以两处路径和媒体预览返回。全局素材库单文件上限为 100 MB；若宿主未提供资产上下文，则在提交付费任务前拒绝执行。

## 用户体验边界

该方案是 Agent 插件工具，不会注册到“媒体模型”提供方下拉框，也不会让既有画布生成节点直接列出 DreamAPI 模型。Agent 可调用插件完成素材制作，结果同时保存在当前工作区和全局素材库。若维护者或用户要求标准模型下拉框/原生节点接入，应另行确认是否允许改公共媒体契约，不混入本 PR。

## 错误与安全边界

- 插件缺少 API Key 时在调用前给出配置提示；所有输入素材路径必须是工作区相对路径并通过 `context.files` 读取。
- 仅允许向固定 DreamAPI API/存储服务发起请求；校验上传策略目标及返回结果类型，拒绝无效媒体 URL、空文件和不支持格式。
- 网络/轮询失败时保留 task ID 的错误上下文，不自动创建第二个任务，避免重复扣费。
- 输出采用唯一文件名和独占写入，避免覆盖用户素材；全局素材归档失败时保留已生成的工作区副本并返回失败阶段，不会重复提交任务。

## 验证与限制

遵循仓库 `AGENTS.md:220-225`，不新增测试文件、测试依赖或测试脚本。实现后运行插件包 `typecheck`、插件单包构建和根目录 `bun run build:tools`；以模拟 DreamAPI 响应进行本机无扣费验证，并检查构建产物不含 API Key。不会在无新的明确授权下调用真实生成接口，因此真实端到端供应商响应仍需用户配置自己的 Key 后验证。
