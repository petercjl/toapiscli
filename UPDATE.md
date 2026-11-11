# Update contract for the current Agent

首次接入自动更新的用户入口：“更新 @petercjl/toapiscli。” 后续正常使用即可，员工无需重复发送更新指令。

当前 Agent 解析自己的精确 Skill 目录，使用该目录内的 `.runtime/dist/cli.mjs` 运行任务。引导包、源码目录与其他宿主不自动选择目标；更新只覆盖当前精确目录。

## 自动更新

安装或首次升级时，在包外按精确目标保存 mode=auto 的策略，代表此安装的持续更新授权。`prepare --json`、`models list` 和 `image generate` 在任务开始前检查 stable latest；网络超时 1200 ms，正常缓存约 24 小时，离线退避 1 小时。兼容稳定版本：0.x 同 minor，1.x 起同 major；旧版、预发行及不兼容版本均不自动安装。范围外新版返回可发现通知。

自动更新先用 npm 在独立目录安装准确版本（禁用安装脚本），验证包身份，备份并同步目标的 Skill、独立运行时和哈希回执。保留凭证、任务记录及宿主 UI 元数据。更新成功后 `prepare` 返回 `skillReloadRequired`，Agent 重新读取本目录 Skill，再回到原任务；直接业务命令在任何付费操作之前仅转交新入口一次，并保留原参数、退出状态和结果，不重放已提交任务。

互斥锁阻止并发写入，失败退避 1 小时。离线、权限不足、本地修改或安全冲突时返回 deferred 并继续已验证旧版。更新中断留下包外 recovery 回执，任务会停止；根据回执 backup 恢复原目标并核验哈希后才能继续，不自动猜测或重新提交生图。其他宿主不受影响。源码与 CI 使用 `TOAPISCLI_UPDATE_CHECK=0` 冻结自动更新。

## 策略与显式维护

`update policy --target <exact-target> --agent <current-agent> --json` 查询策略；`--mode auto|off` 修改。策略和缓存格式异常时保留原文件并返回 deferred，由当前 Agent 保留备份后修复。`TOAPISCLI_AUTO_UPDATE=0` 临时停安装；`TOAPISCLI_UPDATE_CHECK=0` 同时停检测和安装。版本、帮助、任务查询不联网检查更新。

显式更新：`update install --target <target> --agent <agent> --version <exact-version-or-tag> --yes --json`。首次从旧版升级沿用同一接口。同版本也校验并修复缺失资源；本地修改和非托管目标受保护。

更新当前目标的完整运行时和 Skill，全局 npm 引导 CLI 保持原版本。后续业务使用目标自带入口。当前 Agent 如需更新引导包，在确认 selected target 后通过包管理器更新并重新核验 Skill，不同步其他 Agent。

升级后核对新目标入口 version、doctor、skill status 和实际哈希；由宿主刷新发现。安装回执内 backup 目录是恢复入口。尚未确认宿主发现时如实报告 pending。
