# 本机环境记录

只记录当前开发机的安装、部署、注册和临时目录事实。这些不是项目要求，换一台机器按 README 的通用步骤重新配置。控制器当前安装 `2026-11-10-coverage-3.14`。

## Cubase 安装

- 已安装程序：`C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe`（16.0.5）。原生初始化器固定对应 16.0.5.174。
- `D:\CubaseAI` 中是 Steinberg Download Assistant 的安装包和音色内容，包括 `WIN64\Cubase 16.0.5 - Application\Cubase_16.0.5_Installer_win64.zip`。
- 两个目录分别记录在 `cubase.config.json`；不会把下载目录当可执行程序启动，也不会扫描并切换其他安装。
- loopMIDI/virtualMIDI 已通过 `npm run setup:midi` 安装；两个 `CubaseAI MCP ...` 端口在没有 Cubase 或 loopMIDI 进程时也存在，因此空宿主表现为 MIDI 超时，而不是 `MIDI_PORT_NOT_FOUND`（session 36 记录）。
- 远程驱动四个文件已由 `npm run install:remote` 部署，控制器 3.14 已加载并激活；session 35 时确认无需重新安装。

## 客户端注册

已把 `cubase-ai16-headless` 注册到以下用户级配置，工作区 `.vscode/mcp.json` 保持可移植、未改：

- Claude Code：`C:/Users/99325/.claude.json`（`~/.claude.json`）
- Codex：`C:/Users/99325/.codex/config.toml`
- Copilot：`C:/Users/99325/.copilot/mcp-config.json`
- VS Code：`%APPDATA%/Code/User/mcp.json`
- VS Code Insiders：`%APPDATA%/Code - Insiders/User/mcp.json`

用户级条目固定使用：

```text
Node:   C:/Users/99325/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64/node.exe
Server: E:/VC/CubaseMCP/dist/src/server.js
Env:    CUBASE_MCP_CONFIG=E:/VC/CubaseMCP/cubase.config.json
```

不依赖客户端工作目录。四条 JSON 注册已解析且条目一致；Codex 原生查询报告 `enabled=true`，Claude Code 原生查询报告 User scope 和 `Connected`。从工作区外发起真实 stdio 初始化和 `tools/list` 返回 53 个工具。注册时没有调用任何 Cubase 工具，也没有重启 Cubase；已有聊天需要刷新 MCP 或开新会话，当前聊天里的原生工具加载尚未验证，详见 [session 35](session-log/session-35.md)。

检查命令：

```powershell
claude mcp get cubase-ai16-headless
codex mcp get cubase-ai16-headless --json
```

## 诊断启动入口

- `npm run start:cubase-background` 在独立 Windows 桌面打开测试副本；目标进程挂起时先加入禁止桌面创建和切换的 Windows 作业，核对输入桌面后再恢复运行。
- 另一独立诊断启动器支持无 CPR 参数启动，并与原启动器共享作业和桌面核心。它们不是不依赖 GUI 的 Cubase 引擎，也不是 MCP 工程创建接口。
- 后台启动返回的 JSON 包含宿主 PID、独立启动记录和错误日志路径；长时间运行的宿主不继承调用者的输出管道，`starting` 本身不是启动成功证明。输入桌面和前台句柄是采样值，不是连续监控。
- 这些旧启动脚本仍是诊断入口；正式生命周期工具已另行接入创建、打开、另存为和关闭。

## 临时目录与清理

- session 28 把 12 个确认属于本任务的 C 盘会话临时及崩溃文件（3,937,635 字节）归档到 E 盘并移除 C 盘副本；其他软件正在使用的临时文件和已安装依赖保留。
- 后续任务辅助进程、编译和自有 Cubase 启动的 `TEMP`/`TMP` 指向 `E:\VC\CubaseMCP\artifacts\scratch-temp`，只影响这些进程，不改系统或用户全局设置。
- 超过 1 小时的 `artifacts/project-create-<32 位十六进制>` 请求记录、`scratch-temp` 条目和 `artifacts/runtime` 原子写入备份由 MCP 服务在连接后 30 秒、之后每小时后台清理；`npm run cleanup:temp` 可手动执行。`artifacts/temp-cleanup-keep.txt` 列出被文档引用的两个请求记录（session 37 与 `native-host-contracts-33.md`），清理不会删除它们。2026-11-11 按 1 小时实跑删除 550 项、释放 179,045,321 字节。

## 本机验收副本

- Session 31：`artifacts/managed-projects/session-31/native-a/Native31-Verified.cpr`；此前 `Native31-Edited.cpr` 有独立重开证据，最终文件保存后没有再次重开。
- Session 34：`artifacts/managed-projects/session-34/verified-native34-final/Contracts34.cpr`（473,712 字节）；最终扩展重开结果 `artifacts/ipc/contracts33-native34-final-extended-reopen-result.json`。
- 项目接口只读探针报告：`artifacts/ipc/service-probe-20261110.json`。

## 只读诊断前提

R1 工具曾返回缺少 `SeLoadDriverPrivilege`、驱动未加载；后续用普通用户态只读检查确认一个记录在案的宿主进程注册了项目接口。该快照不等于当前进程已就绪，也没有增加其他运行后端（session 31）。
