# DreamAPI Agent 工具

通过 DreamAPI 的 BYOK（自带密钥）API 生成或处理素材，并将完成的文件保存到当前工作区 `assets/dreamapi/`，同时归档到 Toonflow 全局素材库的 `DreamAPI/` 目录。

## 配置

1. 在 Toonflow「设置 → 插件市场」安装并启用 DreamAPI 工具。
2. 打开工具配置，在本机填写你自己从 [DreamAPI Dashboard](https://api.newportai.com/) 获取的 API Key。
3. 可调整单次任务等待时间（60–1800 秒；默认 600 秒）。

API Key 由用户填写在 Toonflow 的 DreamAPI 工具配置中，并由服务端工具在请求 DreamAPI 时读取；它不属于 Agent 工具参数，也不会编入插件源码或生成的 `.tool.js` 文件。配置值仍由 Toonflow 的插件配置界面保存和管理。

## 使用

Agent 先调用 `listDreamApiOperations` 查询当前操作、必需素材角色、提示词要求和可用参数，再调用 `generateDreamApiMedia`。输入素材必须是当前工作区内的相对路径。每次生成只提交一次任务；等待超时后，使用原操作 ID 与返回的 `taskId` 恢复查询，不要再次提交任务。

已完成的图片、视频或音频文件会先写入工作区 `assets/dreamapi/`，再通过 Toonflow 提供的素材归档接口复制到全局素材库 `DreamAPI/`。工具返回两个实际路径和适用的预览链接。全局素材接口限制单文件不超过 100 MB；输入和输出沿用这一上限。写入使用唯一名称且不会覆盖现有素材。

支持范围以 `listDreamApiOperations` 的返回清单为准，覆盖 DreamAPI Skill 中可产生图片、视频或音频文件的生成、编辑、换脸、抠像、试衣、口型同步、数字人、动作迁移、视频翻译及 TTS 操作。返回 `cloneId` 的 Voice Clone、音色查询、积分查询等不直接产出媒体文件，因此不作为素材生成操作。

本插件通过 Agent 工具运行 DreamAPI，不会把 DreamAPI 注册到 Toonflow 的原生媒体模型下拉框或画布生成节点。真实生成会按 DreamAPI 账户规则计费；仅在用户要求时调用。
