# Changelog

按轮次记录可观察的功能增量。轮次编号与 `docs/session-log/` 一致，测试数字是当时实际运行的结果；`package.json` 版本为 `0.1.0`，仓库尚未打 tag。当前状态和剩余工作以 [STATUS.md](STATUS.md) 为准。

## [0.1.0] - 2026-11-11

### 第 42 轮：采样率导入实机验证与 32 条音频轨上限

- 采样率导入的三个分支在真实 Cubase 里跑过：`match`（15 个已转换的层，原样复制）、`reject`（`AUDIO_SAMPLE_RATE_MISMATCH`，`execution: not_started`，没有写文件）、`convert`（147/160，每相 140 抽头，32 位浮点 44.1 kHz 副本，导出与源的包络相关 1.0000、滞后 0、电平比 1.000；错速假设只有 0.0093）。
- Cubase AI 16 最多 32 条音频轨：第 33 次导入返回成功、写出文件，却不添加通道。`cubase_audio_import` 在“没有新增通道、窗口状态干净、导入前音频通道数已达 32”时返回 `AUDIO_TRACK_LIMIT_SUSPECTED`（`details.audioChannelsBefore`），其余失败仍是 `AUDIO_IMPORT_NOT_OBSERVED`。新增一个夹具测试，完整测试 **218/218**；生产对话里运行的服务是改动前的构建，重启后才会出现新代码。见 [session 42](docs/session-log/session-42.md)。

### 第 41 轮：文档拆分

- README 改成使用文档，本机安装、控制器部署、客户端注册和临时目录移到 [本机环境记录](docs/local-environment.md)，轮次与修订历史移到本文件。没有代码、控制器或工具变更。

### 第 40 轮：MIT 许可

- 根目录新增 `LICENSE`（MIT，版权 2026 Asakitan），`package.json` 声明 `"license": "MIT"`，README 增加许可证段。见 [session 40](docs/session-log/session-40.md)。

### 第 39 轮：公开发布

- 仓库发布到 GitHub（`https://github.com/Asakitan/CubaseMCP`，`main`）。见 [session 39](docs/session-log/session-39.md)。

### 第 38 轮：跨采样率音频导入

- `cubase_audio_import` 从已保存的 CPR（`PArrangeSetup` 记录）读取工程采样率并与源文件比较；`sampleRateMismatch` 提供 `convert`（默认，仅 WAV，写转换后的 32 位浮点副本）、`reject`、`ignore`，结果报告 `sampleRate.check`。48 kHz 源进 44.1 kHz 工程原本会慢放 8.1 %。
- 定向夹具和一段 213 秒真实素材通过（与独立转换的差值为 -139.8 dB），完整测试 **212/212**。该轮运行中的服务器仍是旧构建，新分支尚未在真实 Cubase 里导入。见 [session 38](docs/session-log/session-38.md)。

### 第 37 轮：端口宿主就绪与生命周期管道

- 生命周期等待本次 PID 的就绪记录和精确端口枚举，最长 15 秒；端口宿主由独立进程创建，不继承生命周期响应管道。
- 创建流程的空工程启动器改为只选一个 Node 可执行文件，修复两条 Node 路径被拼接后 `Win32_Process.Create` 返回 9 的问题。
- 端口已就绪时完成一次真实创建并保存（Cubase 16.0.5，`readyForOperations: true`，`saveReturned: true`，67,559 字节 CPR）；延迟就绪分支仍只有独立假进程证据。见 [session 37](docs/session-log/session-37.md)。

### 第 36 轮：能力发现与只读握手

- `cubase_capabilities` 在没有宿主应答时不再返回裸 `MIDI_TIMEOUT`：先读自有运行时清单，再做 2000 ms 只读握手；无映射应答时 `host` 为 `null`，`hostState` 给出 `observed`、`code`、`timeoutMs`、`nextAction`。
- `bridge.status` 为只读：丢失回复记为 `execution: "not_started"`，空闲通道丢弃后由下一次请求重开，不重发；同刻在途写入仍按未知结果处理。`cubase_status` 保留 8000 ms 预算。
- 真实 stdio MCP 对空宿主的调用 2.9 秒返回 `ok: true` 与 `hostState.code = MIDI_TIMEOUT`，重复调用和一次 8 秒超时后的调用均可用；**201/201** 测试通过。见 [session 36](docs/session-log/session-36.md)。

### 第 35 轮：客户端注册

- 把 `cubase-ai16-headless` 注册到 Claude Code、Codex、VS Code/Insiders 和 Copilot 的用户级配置，工作区 `.vscode/mcp.json` 保持可移植。注册内容和本机路径见 [本机环境记录](docs/local-environment.md) 与 [session 35](docs/session-log/session-35.md)。

### 第 34 轮：Group/FX 持久化与 53 工具

- Group/FX 重建改用宿主 `VST Multitrack` 工厂令牌和完整设备绑定序列，此前失败的保存/重开检查通过。
- `cubase_track_create` 支持空 MIDI、乐器、Group、FX 和文件夹轨道；真实乐器轨（HALion Sonic）与文件夹轨在全新进程重开后保留。
- 自动化轨道创建和点读取/插入/改值/移动/删除可用；真实 MCP 在 PID 49344 → 54364 后保留六个编辑点、音量/静音轨道、空插槽、输出和发送目标。
- `field: send` 路由解析实际槽位和 tag 4099，校验身份并读取独立 MIDI 反馈。创建/打开使用独立 holder；观察到的一次许可证阶段停滞可在原生准入前结束自有空 Cubase 和确切许可辅助进程并重启一次，已提交工作不重放。
- 原生/TypeScript 构建和 **199/199** 测试通过；最终工程 `artifacts/managed-projects/session-34/verified-native34-final/Contracts34.cpr`（473,712 字节）。见 [契约与证据](docs/native-host-contracts-34.md)。

### 第 33 轮：原生卸载、路由和自动化

- 全新自有后台宿主成功打开保留工程；此前的 `Checking licenses...` 样本不构成持续许可失败。
- `cubase_track_create` 在事件树和混音器观察到空 MIDI、Group、FX 轨道，但混合历史工程和干净重建工程在全新重开时都出现不可连接轨道提示；session 33 保存的工程是失败样本，不是发布夹具。
- `cubase_plugin_unload` 卸载新装入的 MonoDelay 并确认空插槽，无提示框。
- `cubase_routes_list` / `cubase_routing_set` 暴露宿主枚举目标；Group 输出在 Stereo Out 和 FX return 之间往返，恢复由 MIDI 参数独立确认。
- `cubase_automation_read` / `cubase_automation_edit` 实现轨道创建和点操作，带身份与原值守卫；干净重建产生六个点。
- 两份原始崩溃转储共享 `0xC0000005` @ `Cubase+0x2e1bdb0`（访问已销毁的 `MTrackEvent`）；精确错误释放尚未修复。
- 构建和 **195/195** 本地测试通过。见 [session 33](docs/native-host-contracts-33.md)。

### 第 32 轮：空 MIDI 原型撤回

- 首次原生空 MIDI 创建只把 `MMidiTrackEvent` 插入工程树，未产生确认的混音器通道，随后出现三个宿主错误窗口；判定为失败验收，不是完成的轨道创建。
- 静态追查发现额外的 owner、混音器注册和插入后通知要求；临时 MCP 工具和原生操作 9 撤下，原生范围回到 1..8。
- 失败的进程内状态被丢弃；打开未改测试副本时停在空实例就绪阶段（PID 47292 显示 `Checking licenses...`），原生打开操作未提交。
- 路由显示值探针返回原输出 ID 22 / `Stereo Out`，未确认路由变化。包含原型的完整测试 **194/194**；恢复 47 工具后 4 项暴露检查和 2 个 PowerShell 语法检查通过。见 [session 32](docs/native-host-contracts-32.md)。

### 第 31 轮：原生文件与事件编辑

- 参数化 NonUI 音频导出通过真实 MCP：WAV 48 kHz/24-bit、AIFF 44.1 kHz/16-bit、FLAC 96 kHz/24-bit、WAV 48 kHz/32-bit float 均与请求头一致，文件名和目录正确，4 秒文件含声音；不发送导出窗口命令，旧文件保留。
- 音频导入新增一个音频通道并保留 AIFF 源；一个音频事件从 8 秒移到 12 秒、从 4 秒裁到 2 秒，宿主读回确认，渲染区间产出非静音 2 秒 WAV。
- 单音符可原地读写：真实 MCP 确认一个音符从 60/96 改为 62/80，起点 0 → 0.5 秒，时值 2 → 1.25 秒；旧原值请求在写前被拒绝，另存和全新进程重开保留修改和未触碰的音符。
- 非零 Part 暴露时间上下文单位不一致；当前代码同步 working/start/end 基点并在时间 setter 前检查逆变换。最终修正夹具保存后未再次重开。
- 完整测试 **193/193**，共 47 工具。见 [文件服务与原生操作](docs/native-file-services-31.md)。

### 第 30 轮：做歌闭环与控制器 3.14

- `scripts/verify-song30.cjs` 通过真实 stdio MCP 在后台完成四轨八小节：创建、速度/拍号、导入 192 个音符并逐一读回、事件编辑、轨道和混音编辑、走带、两次音频缩混、保存、全新进程重开一致，**28/28** 检查通过。
- 两次未确认的绑定写入查出根因：3.13 在宿主反馈回调里遍历整张控制表，页面激活过慢被宿主放弃；3.14 改为 O(1) 回调并拆分主/混音器页面。所选轨音量和银行通道音量写入由宿主反馈和独立 DirectAccess 读回确认。见 [根因记录](docs/binding-root-cause-30.md)。
- 新增 13 个工具（MIDI 导入/读取、音频导出、通道、轨道编辑、走带、页面、命令、运行时窗口等）；`cubase_plugin_set` 无窗口装入和替换插入效果，开启/旁路/参数写入由宿主反馈确认。
- 命令白名单 181 条逐条实机执行：103 条读回到效果，55 条已接收但现有读回看不到变化，23 条在准备上下文中不可执行；会弹窗的命令移除。
- 2550 个声明绑定控制逐个写入：645 个由宿主反馈确认（主页面 165，混音器 480），26 个提交无反馈，1426 个在该工程不可用，28 个只读，425 个宿主动作未触发。
- 完整测试 **191/191**。见 [做歌工具](docs/song-tools-30.md)、[命令白名单](docs/command-allowlist-30.md)、[控制扫描](docs/control-sweep-30.md)。

### 第 29 轮：正式后台生命周期

- 正式 MCP 完成原生空白创建（67,595 字节）、另存为（68,380 字节）、更换后台实例后打开同一文件并连接映射；没有复制模板。
- 旧的 146.75 保存链路未重复测试；该轮结束时轨道和事件编辑、完整自动化、路由、插件状态和导出仍未完成，后续由第 30/31 轮补上。见 [生命周期](docs/background-project-lifecycle.md)、[覆盖矩阵](docs/feature-coverage-29.md)。

### 第 28 轮：保存链路

- 控制器 `2026-11-10-coverage-3.13` 在隔离实例激活；正式 MCP 把独立副本速度改为 146.75 并保存，CPR 从 93,085 增至 93,730 字节，全新进程重开后读回 146.75，与保存快照一致。
- 保存时记录的内部页在重开时自动返回主映射，不再发出保存输入；未确认请求没有重放。
- 3.13 构建通过 3 项定向检查，3.12 的 7 项 Save/MIDI/MCP 定向检查此前通过；**109/109** 是 3.9 的历史结果。统一版本门禁覆盖全部带会话的宿主操作。

### 控制器修订

- **3.14**：O(1) 反馈回调，主页面和混音器页面分离，激活计数与停滞页守卫；`cubase_control_set` 在 `confirmation.state` 报告宿主反馈，`cubase_command_execute` 报告 `bindingObserved`。
- **3.13**：最小 Save 映射页和一次 MIDI 保存输入，回执带新 session；旧版在反馈回调中遍历控制表，页面激活过慢会被宿主放弃。
- **3.9**：所选轨与混音器银行插入效果查看器支持开启、旁路、自动化和参数写入；检查和写入不是原子事务，实际效果待验证，见 [插入效果查看器](docs/midi-insert-viewer.md)。
- **3.7**：新增乐器槽、混音器银行通道乐器槽和通道条效果参数银行；`cubase_control_get` 返回完整 `pluginIdentity`，写入时传 `expectedPluginIdentity` 和通道身份。
- **3.8 及更早**：参数编辑锁、分页和 mixer/insert 守卫等；逐轮记录见 `docs/session-log/`。

### 早期轮次

第 1–27 轮（严格后台实现、MIDI 前置安装、控制扩展、原生调查、空启动、首工程打开、绑定修复等）按轮次记录在 `docs/session-log/session-01.md` … `session-27.md`。
