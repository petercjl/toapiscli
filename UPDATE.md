# Update contract for the current Agent

用户入口：“更新 @petercjl/toapiscli，检查当前 Agent 的安装与 Skill。”

Agent 先定位当前宿主的精确 Skill 目录，运行其现有 `.runtime/dist/cli.mjs skill status --target <target> --agent <agent> --json`。存在本地修改或非托管内容冲突时先保留并报告，避免覆盖。

普通任务自动检测 stable latest，限时 1200 ms，持久缓存 24 小时，离线不影响既有任务；TOAPISCLI_UPDATE_CHECK=0 可关闭检测。版本、帮助和任务轮询不检查更新。自动安装默认关闭；本版本仅提供明确授权的更新安装。

执行 `update install --target <target> --agent <agent> --version <exact-version-or-tag> --yes --json`：先将完整 npm 包安装到独立 staging，再备份和同步当前宿主的 Skill 与独立运行时。同版本也核验并修复缺失资源。失败保留旧内容和恢复线索；其他宿主不受影响。

该命令更新所选宿主的完整运行时和 Skill，全局 bootstrap CLI 保持原版本；后续业务命令使用所选 Skill 自带的入口。如果也需要更新全局 bootstrap，由当前 Agent 在确认 selected target 后使用包管理器更新同一版本并重新核验 Skill。不同入口版本分别如实报告。

升级后用新的目标入口检查 version、doctor、skill status 和文件哈希，并由宿主刷新发现；保留 backup 路径。恢复时以备份为依据，先检查目的路径和现有文件，采用受保护的明确恢复流程。
