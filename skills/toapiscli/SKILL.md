---
name: toapiscli
description: 通过 ToAPIs MCP 使用已配置员工凭证调用批准的生图模型，支持文生图、参考图编辑、任务恢复与结果下载；用于用户指定 toapiscli 的图片任务。
metadata:
  version: 0.1.1
---

# ToAPIs CLI

输入：用户的生图目标、明确选择的模型、可选参考图片、分辨率与输出位置。首次配置使用管理员提供的 JSON 文件。
输出：本地图片、结果链接、请求与任务 ID、实际结算积分；失败时交付真实状态和恢复入口。

## 执行入口

能力要求是 Node.js 22+、执行命令、读写本地文件和 HTTPS。任意满足要求的当前 Agent 可调用。先读取 [通用适配](adapters/generic.json)，再从本 Skill 的实际目录解析独立运行时：`node <SKILL_ROOT>/.runtime/dist/cli.mjs`。以下以 `CLI` 表示这一入口。使用 `CLI capabilities --json` 发现当前合同；`CLI doctor --json` 检查依赖与脱敏认证状态。

本 Skill 与运行时由同一 npm 包管理，版本为 `0.1.1`。包安装和更新说明见包根 INSTALL.md、UPDATE.md；升级只同步当前 Agent 明确指定的目录。

## 自动更新

首次使用及新任务开始时运行 `CLI prepare --json`。安装时为当前精确目录保存自动更新策略；日常使用自动安装兼容稳定新版（0.x 同 minor，1.x 起同 major），备份并校验当前 Skill 和独立运行时。若返回 `status: updated`，重新读取本目录完整 SKILL.md、从返回的 updatedEntry 探测能力，再进入下方主线。缓存检查约 24 小时，离线或安全冲突保留已验证旧版；本地修改保留并报告。`RECOVERY_REQUIRED` 时暂停任务，交付恢复回执和备份路径。已提交任务始终使用原目录查询。

手动管理入口：`CLI update policy --target <本目录> --mode auto|off --json`；`TOAPISCLI_AUTO_UPDATE=0` 暂停安装，`TOAPISCLI_UPDATE_CHECK=0` 关闭检测和安装。其他宿主独立管理。版本、帮助和任务查询不触发更新。

## 主线

1. **检查凭证**：`CLI auth status --json`。尚未配置时，请用户提供管理员配置文件的路径或附件；执行 `CLI auth import --file <文件绝对路径> --json`，再回到本步骤。让 CLI 读取文件，Agent 无需查看文件内容。已有配置需要替换时先告知存在的配置，并在获得替换授权后使用 `--replace`，保留备份。
2. **确定模型与参数**：运行 `CLI models list --json`，仅使用当前 Key 可用的批准模型。用户明确指定模型时保持该选择；未指定时说明所选模型。运行 `CLI models docs --model <模型ID> --json`，读取当前参数合同。默认单张、2K、正方形；用户明确参数优先，模型不支持时报告冲突。普通版 Sunburst 使用 high。具体可用选项以 CLI 能力和当前模型文档交集为准。
3. **生成**：用户请求生图即授权所请求范围内的付费执行。执行 `CLI image generate --model <模型ID> --prompt-file <提示词文件> --resolution 2K --aspect 1:1 --out-directory <新的绝对目录> --submit --wait --json`。简短文本可用 `--prompt`。每个 `--reference <本地文件>` 表示一张用户提供的参考图；保持原有产品或人物身份语义，由参考图承载外观事实。CLI 负责上传、MCP 调用、请求标识和任务记录。
4. **恢复与等待**：任务仍在运行或提交状态不明时，使用原目录执行 `CLI task get --directory <原目录> --json` 或 `CLI task wait --directory <原目录> --json`。这些命令只查询已有请求，成功后下载结果。未知状态停止新提交并报告；明确失败后，新的付费尝试需要用户授权。保存的 request.json 是恢复入口。
5. **验收与交付**：核对任务终态、本地文件、图片内容与用户目标。交付本地图片与每个远程结果链接、实际模型、任务 ID 和结算积分。未结算时明确标记。视觉验收由当前 Agent 完成；CLI 成功不等于内容验收通过。

## 权限与费用

只支持 `doubao-seedream-5-5`、`gemini-nano-banana-2.1`、`gpt-image-2.6-sunburst`。CLI 同时受服务端员工 Key 的权限约束。Key 创建、权限调整及其他媒体生成由管理员独立管理。模型列表价格是报价，任务 billing 才是实际结算。

凭证由管理员文件导入并存入包外的用户配置目录；普通输出只含脱敏状态。配置文件、Key、Cookie 和管理员凭证均不写入提示词、对话、共享目录或任务记录。配置导入免费，只调用 MCP 验证模型权限。

## 错误与回到主线

- `AUTH_REQUIRED`：完成配置文件导入，回到步骤 1。
- `MODEL_NOT_ALLOWED` / `KEY_MODEL_DENIED`：报告选择和可用模型，等待用户调整后回到步骤 2。
- `SUBMISSION_UNCERTAIN`：保留请求目录，进入步骤 4；查询之前不重放生成。
- `PATH_EXISTS`：使用新的输出目录；恢复既有任务则进入步骤 4。
- MCP 认证、参数或服务故障：保留错误和任务证据。维持 ToAPIs MCP 路由，向用户报告缺口。

新出现的可重复错误应在单独授权的维护任务中修复 CLI／Skill 合同；运行期间保持用户选择，更新由上述 CLI 合同执行。
