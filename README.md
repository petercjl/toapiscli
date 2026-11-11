# toapiscli

通过 ToAPIs MCP 使用批准的生图模型。npm 包同时提供 CLI 和配套可移植 Skill，适用于具备 Node.js 22+、命令执行、本地文件与 HTTPS 能力的当前 Agent。

管理员为每位员工创建独立 Key，并单独发送包含凭证的 JSON 配置文件。员工安装时指定这个文件，插件验证权限后将凭证复制到用户自己的受保护配置目录。安装包、Skill 和任务记录不包含 Key。

将管理员发给你的配置文件作为附件交给当前 Agent，然后发送：

> 安装 @petercjl/toapiscli，使用所附管理员配置文件。

安装完成需同时验证 CLI、当前 Agent 的 Skill 和配置状态。详细接入合同见 [INSTALL.md](INSTALL.md)。

使用：

> 用 toapiscli 的 gemini-nano-banana-2.1 生成一张 2K 正方形图片：一只橘猫坐在窗边，旁边有一杯咖啡，温暖晨光，写实摄影。

更新：

> 更新 @petercjl/toapiscli，检查当前 Agent 的安装与 Skill。

更换员工配置文件：

> 将 toapiscli 的凭证替换为所附管理员配置文件。

支持模型：doubao-seedream-5-5、gemini-nano-banana-2.1、gpt-image-2.6-sunburst。服务端 Key 决定实际权限和额度。这个包提供员工消费能力；管理员的 Key 创建和权限调整通过独立控制台执行。

普通任务入口会限时检查新版并缓存 24 小时；自动安装默认关闭。支持 macOS、Windows、Linux 的 Node.js 接口；真实宿主和操作系统测试范围见开发验收记录，设计兼容性不代表所有环境均已实测。

开发者合同：运行 `toapiscli capabilities --json` 查看命令、参数、维护及认证文件格式。使用 `TOAPISCLI_CONFIG_DIR` 显式隔离用户配置；`TOAPISCLI_UPDATE_CHECK=0` 关闭更新检测。Windows 凭证目录需由当前用户的配置目录 ACL 保护，POSIX 平台强制凭证权限 0600。
