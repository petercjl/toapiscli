# Installation contract for the current Agent

用户入口：把管理员配置文件作为附件，发送“安装 @petercjl/toapiscli，使用所附管理员配置文件。” 用户无需查看或输入 Key，也无需打开终端。

以下是 Agent 执行合同。确认 Node.js >=22、命令执行、文件访问及 HTTPS。先解析当前 Agent 自己支持的 Skill 精确目录和注册／刷新机制。缺少目录事实时询问；不猜测或同步其他宿主。

1. 安装管理员指定或 registry 中可核验的包版本。测试包可从指定本地 tarball 安装；本地版本不代表已发布。
2. 调用 `toapiscli capabilities --json`、`toapiscli skill source --json`，核对包版本和规范 Skill 路径。
3. 运行 `toapiscli skill install --agent <current-agent-id> --target <exact-skill-directory-ending-in-toapiscli> --credentials-file <administrator-json-path> --json`。CLI 自己读取配置，Agent 不需要展开附件内容。若已有有效凭证，可省略 credentials-file；随后验证认证状态。
4. 安装会在包外保存仅适用于该精确目录的自动更新策略。当前 Agent 通过 `update policy --target <target> --agent <agent> --json` 核验 mode 为 auto；需要关闭时使用 --mode off。始终使用目标 Skill 内的独立运行时开展日常任务。
5. 通过 `skill status` 核验 physical copy、managed、current、SHA-256 与实际入口；通过 `auth status` 和 `models list` 验证配置。加载当前 Agent 自己目录的 SKILL.md，并由宿主刷新／发现 Skill。
6. 报告版本、配置是否有效和宿主发现状态。缺少配置或宿主尚未发现时报告部分完成。npm 安装成功本身不是完整安装。

管理员配置文件 JSON 格式：schemaVersion 为数字 1，site 为 cn 或 com，apiKey 为该员工的 Key，label 为可选的员工标识。凭证文件不支持设置模型白名单或执行命令，权限由服务端管理。管理员应通过受保护的私密方式交付；原文件由员工自行保管，插件不删除它。

凭证副本位于当前用户配置目录，包和安装目录外。导入会免费验证 MCP；已有凭证必须使用独立的 `auth import --file <path> --replace` 明确替换，并保留备份。Windows 应核验用户配置目录的 ACL；macOS/Linux 使用目录 0700、凭证文件 0600。

安装脚本被禁用时，同样执行以上步骤。安装提示不会替代宿主发现。每个宿主获得完整实体 Skill、独立捆绑的运行时及依赖；引导 npm 包被移除后，该宿主的本地入口仍可运行。
