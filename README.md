# Cubase AI 16 MCP

Windows 本地 MCP，使用单一 MIDI Remote 后台通道控制 Cubase 16。参考 PIXELHIZE/CubaseMCP 的 MIDI 桥接方向，独立实现；不是其 238 个工具的复制版。

## 固定约束

- 正式生命周期工具可在隔离桌面启动和管理自有 Cubase 实例；不激活或切换到用户前台，不向任何窗口发送键盘鼠标输入，不点击菜单或对话框。音频导出使用宿主 NonUI 控制器，音频导入直接传路径，不打开文件选择或导出窗口。非自有实例不会被接管或结束。
- 参数与控制走单一 `midi` 通道；创建、打开、另存为、MIDI/音频导入、音频导出和原生事件读写走明确的固定操作，不按失败结果切换通道，无 mock、UI 或协议 fallback。
- 宿主弹出的提示框无法被应答。会弹窗的命令已从白名单移除；`cubase_runtime_windows` 只读地报告隔离桌面上的意外窗口，出现后需要用 `cubase_project_open`/`cubase_project_create`（`replaceCurrent`）更换实例。
- 指定端口不存在、对象失效、API 缺失、命令不可执行时直接返回错误。
- 超时或取消后的修改可能已被 Cubase 接收，结果记为 `unknown`；不重试、不重放。重新连接必须显式调用工具。
- 第 34 轮修复了 Group/FX 设备工厂令牌和连接构造，真实 MCP 新进程重开验证通过。现支持空 MIDI、乐器、Group、FX、文件夹创建、插入插件卸载、自动化轨道及点编辑、音频总线和发送路由。乐器加载、路由和六个编辑后的自动化点均保留；构建与 199 项测试通过。完整范围见 [当前状态](STATUS.md) 与 [当前契约](docs/native-host-contracts-34.md)。

## 安装和启动

需要 Node.js 22+、已激活的 Cubase AI 16，以及提供两个独立双向虚拟 MIDI 端口的驱动，例如 loopMIDI。端口必须精确命名：

```text
CubaseAI MCP To Cubase
CubaseAI MCP From Cubase
```

```powershell
npm ci
npm run build
npm run build:native
# 仅执行本次改动所需的定向验证
npm run setup:midi
npm run start:ports
npm run install:remote
npm run doctor -- --live
```

`setup:midi` 需要管理员权限，只通过 WinGet 安装官方 loopMIDI 包；已安装时不重复安装。`start:ports` 使用已安装的 virtualMIDI 库，在无窗口进程中提供两个回环端口。没有注册开机或登录自启动，结束进程或重新登录后需重新运行。`stop:ports` 可明确停止端口宿主。

`install:remote` 只复制四个 MIDI Remote 文件，默认不覆盖不同内容。Cubase 需要在正常使用时加载该驱动。不要把这两个控制端口加入 MIDI 轨道的输入或 MIDI Thru 回路。MCP 服务不自动安装驱动；显式生命周期请求会在私有桌面启动自有 Cubase 和必要的端口宿主。

正式 `cubase_project_create` / `cubase_project_open` 已内置独立启动，不再需要手动运行外部启动脚本。若原生工程操作尚未提交且启动停在“检查许可证”，MCP 会结束受管 Cubase 和同会话的确切许可辅助进程，然后自动重启一次；结果带 `startupRecovery` 记录。不会结束用户另开的 Cubase，不改授权文件，不回答提示框，也不重放已提交的编辑操作。双进程停止顺序通过定向夹具测试，本轮实机正常启动及保存重开通过。

本机已经完成以上安装。诊断用 `npm run start:cubase-background` 在独立 Windows 桌面打开测试副本；目标进程挂起时先加入禁止桌面创建和切换的 Windows 作业，再核对输入桌面后恢复运行。另一独立诊断启动器支持无 CPR 参数启动，并与原启动器共享作业和桌面核心。它们不是不依赖 GUI 的 Cubase 引擎，也不是 MCP 工程创建接口。后台启动返回的 JSON 包含宿主 PID 和独立启动记录、错误日志路径，长时间运行的宿主不继承调用者的输出管道；`starting` 本身不是启动成功证明。输入桌面和前台句柄是采样值，并非连续监控。这些旧启动脚本仍是诊断入口；正式生命周期工具已另行接入创建、打开、另存为和关闭。

VS Code 配置已放在 `.vscode/mcp.json`，构建后可在 MCP 面板启动 `cubase-ai16-headless`；已运行的 MCP 服务需要重启才能加载新增工具，控制器仍为 3.14，无需重新安装。其他客户端的 stdio 启动命令为 `node E:/VC/CubaseMCP/dist/src/server.js`。标准输出只用于 MCP 协议。

## 本机路径

`D:\CubaseAI` 中发现的是 Steinberg Download Assistant 安装包和音色内容，包括 `WIN64\Cubase 16.0.5 - Application\Cubase_16.0.5_Installer_win64.zip`。

已安装程序是 `C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe`（16.0.5）。两个目录分别记录在 `cubase.config.json`；不会把下载目录作为可执行程序启动，也不会扫描并切换其他安装。

## 做一首歌的流程

1. `cubase_project_create`（或 `cubase_project_open`）得到托管工程和 `session`。
2. `cubase_tempo_set` 设速度，`cubase_transport_set`（`field: "signature"`，如 `"3/4"`）设拍号。
3. `cubase_midi_import` 传入 `song`：每条轨道的音符以四分音符拍为单位（`pitch`、`start`、`duration`、`velocity`），可带 `channel`（9 为 GM 鼓）、`program`、控制器和弯音；也可传现成的 `.mid` 路径。空轨道使用 `cubase_track_create`，`kind` 可选 `midi`、`instrument`、`group`、`fx`、`folder`。乐器轨道初始插槽为空，通过 `cubase_objects_list` 发现该槽，再用 `cubase_plugins_list` 和 `cubase_plugin_set` 分配实际候选乐器。
4. `cubase_events_list` 直接读取原生轨道、Part、音频事件和单个 MIDI 音符，返回临时 `eventId`、路径和工程秒数，以及音符的音高、力度与通道。`cubase_midi_read` 保留为宿主 MIDI 文件导出解析路径；`cubase_channels_list` 列出混音通道。
5. `cubase_event_edit` 移动或裁剪一个音频事件/Part；`cubase_midi_note_edit` 修改一个音符的 `pitch`、`velocity`、`position` 或 `duration`，每次一个字段。把快照中的 `root`、`path`、`eventId` 和原值复制到请求，停止走带后提交，以回执 `confirmed` 为准。轨道与选择编辑继续使用 `cubase_channel_set`、`cubase_track_edit` 和白名单命令。`cubase_audio_import` 按明确路径导入音频并保留源文件。
6. `cubase_transport_action` 播放、停止、回零；`cubase_audio_export` 通过宿主 NonUI 导出器写出缩混，`outputPath` 指定文件名和目录，`format` 选择 WAV/AIFF/FLAC，`sampleRate`、`bitDepth`、`floatingPoint` 指定采样格式，结果按实际文件头核对；不打开导出窗口、不执行导出键盘命令；`cubase_project_save` 保存工程。

`cubase_automation_read` 按轨道返回参数轨道和归一化点；`cubase_automation_edit` 支持 `createLane`、`insert`、`setValue`、`move`、`delete`，带原值及点数校验。`cubase_routes_list` 返回宿主实际音频输入/输出和发送目标，`field: "send"` 另带零基 `sendIndex`；写入时传列表返回的 `expectedSlotUniqueId`。`cubase_routing_set` 校验旧值及目标名称后写入，并通过 MIDI 独立读回。输出/发送路由和编辑后的自动化点已通过保存重开验收。

详细契约、观察到的宿主行为和限制见 [做歌工具](docs/song-tools-30.md)，逐条命令的实机结果见 [命令白名单](docs/command-allowlist-30.md)。回执中的 `submitted` 只表示宿主接受了请求；是否生效以读回为准。

## 控制流程

1. `cubase_status` 获取本次活动页面的 `session`、实际能力及 `serverCompatibility`。只有 `readyForOperations:true` 的当前版本活动映射才接受会话操作；旧版控制器仅供状态诊断，不执行读取或修改请求。
2. `cubase_objects_list` 分页发现根及子对象；`cubase_parameters_list` 取得该对象的真实参数标签。
3. 带同一 `session`、`root`、`objectId` 和 `tag` 调用 `cubase_parameter_set`；可指定 normalized、plain 或 display 格式。
4. 读回确认修改。`submitted` 只表示已经提交，不等于操作已完成。

当前工程保存通过 `cubase_command_execute` 提交 `key: "project.save"`、当前 `session` 和 `confirmCurrentSelection: true`。控制器使用独立的最小 Save 映射页，只发送一次 MIDI 按下，观察到绑定后释放并返回主映射；后续请求使用回执中的**新 `session`**，重新发现对象。这条保存路径不选择目标；带路径另存为使用 `cubase_project_save_as`。超时后的未确认结果不重发，实测链路见 [保存与重开](docs/project-save-chain-28.md)。

`cubase_project_save` 把单次 MIDI 保存与文件观察封装为一个工具：传入已确认的当前 CPR 绝对路径及 `confirmCurrentProjectPath: true`，返回 `file.state`。`changed_stable` 表示观察到内容变化并稳定，`change_not_observed` 表示未确认变化；路径来自调用方声明，工具不选择目标、不另存为，也不把文件变化冒充重开语义验收。该新封装通过定向 MCP 测试，实际宿主验收记录来自前述底层保存链路；详见 [工具契约](docs/project-save-tool.md)。

共 53 个 MCP 工具。单参数及单控制项查询、参数编辑锁、所选轨道身份和前后导航、混音通道位置、速度和时间显示反馈，以及宿主版本和功能上限查询均有明确会话约束。`cubase_parameter_edit_lock_set` 需要已观察的参数和匹配的 `expectedLocked`，回执表示已提交；使用 `cubase_parameter_get` 读取后续状态。已选轨控制包括四段 EQ、前级滤波、发送、乐器槽、五类通道条效果及其参数页、自动化和只读电平表。`cubase_control_set` 可同时校验选中通道的唯一 ID 和运行时 ID；这些检查不是与宿主状态原子绑定的事务。插件装入和替换使用 `cubase_plugin_set`；新增的 `cubase_plugin_unload` 校验插槽及其中的插件 ID，原生卸载后确认子对象数为零，已在实机观察到无提示框卸载。Control Room、固定银行及菜单白名单的可用性仍以宿主实际返回为准。

`cubase_status` 返回紧凑握手，不再内嵌完整对象和控制表。`cubase_controls_list` 的控制和分组分别分页，按 `nextOffset`、`nextGroupOffset` 获取全部项目；`cubase_transport_get` 提供速度与定位器的可用性和实际反馈。长身份标识原样保留，描述性元数据有长度上限。

从版本 3.9 起，已选轨道及混音器银行的插入效果查看器支持提交开启、旁路、自动化和参数写入。调用前通过 `cubase_control_get` 取得完整插件身份，并在 `cubase_control_set` 中传入该身份和当前轨道或银行通道身份；这些检查不是原子事务，提交后仍需独立读回。这些新增写入的实际 Cubase 效果尚待验证，见 [插入效果查看器](docs/midi-insert-viewer.md)。

轨道控制的过程值和显示值来自宿主反馈，尚未收到反馈时为 `null`；切换轨道会撤销上一轨缓存。速度和时间显示也只返回本次活动映射收到的回调，不推测未反馈的值。

对象编号和参数标签必须来自当次发现；标签可以是有符号整数。页面切换使旧 `session` 失效，实际对象删除会撤销对应记录。根对象首屏重新发现会显式刷新该根快照；后续参数读取不会暗中重建 ID。普通变化通知不会清空独立的轨道控制反馈。

参数的 `value` 和 `defaultValue` 是宿主原生数值，不保证在 0–1 之间。`normalized` 写入仍校验 0–1；工程单位和显示文本分别使用 `plain`、`display`。`expectedValue` 比较原生过程值。

连接出错后，先核对实际状态，再显式调用 `cubase_connection_reset`，该工具不会重放之前的请求。每条请求都有截止时间，过期的排队工作不会执行。

状态返回队列和发现记录的容量上限。请求编号按各自的截止时间记忆（最多 4096 个，截止时间最远 10 分钟），过期后才遗忘，页面切换不会清空；同一编号不会被执行第二次。Cubase 偶尔会丢掉一条应答（走带停止时观察到），客户端会按请求编号向桥接取回已保存的应答，操作本身不会重发。

3.14 把控制分成两个映射页：主页面（走带、所选轨、快速控制、Control Room、全部命令和 DirectAccess）与混音器页面（全部 `mixer.*` 银行控制）。`cubase_pages_list` 查看当前页面和激活计数，`cubase_page_activate` 切换并返回新 `session`；对非当前页面的操作返回 `PAGE_INACTIVE`。`cubase_control_set` 默认等待宿主反馈并在 `confirmation.state` 中报告是否观察到，`cubase_command_execute` 报告 `bindingObserved`。

## 验证状态

**第 31 轮已通过的增量**：47 个工具，TypeScript/原生构建通过，完整测试 **193/193 passed**。真实 MCP 验证了 WAV/AIFF/FLAC 参数化导出、源文件保留的音频导入、音频事件移动裁剪，以及单音符的音高、力度、位置和时值编辑。旧音符原值请求在写前被拒绝；保存后在新进程重开，音符和音频状态一致。非零 Part 的写入换算缺陷已修复并通过定向实机检查，详见 [文件服务与原生操作](docs/native-file-services-31.md)。

第 31 轮已保存测试工程为 `artifacts/managed-projects/session-31/native-a/Native31-Verified.cpr`。此前的 `Native31-Edited.cpr` 有独立重开验收证据；最终文件保存后没有重复重开。第 32 轮另存了独立副本，首次空 MIDI 创建只观察到工程树新增，混音器确认失败并出现宿主错误窗口；暂定入口已撤下，后续实机验收被新实例的许可证检查阻塞。插件卸载、自动化和路由仍未完成，见 [本轮契约与回执](docs/native-host-contracts-32.md)。本轮完整测试通过 194/194（包含后来撤下的原型测试）；恢复 47 工具后，4 项受影响的清单检查和 2 个 PowerShell 文件语法检查通过。

**第 30 轮基线**：控制器 `2026-11-10-coverage-3.14`。此前写入无效的根因已查明并修复：3.13 在宿主反馈回调里遍历整张控制表，页面激活耗时数秒，Cubase 会放弃后续激活，该页面的表面值从此不再传到宿主；现在回调为常数时间并拆成两个页面（[根因记录](docs/binding-root-cause-30.md)）。第 24、25 轮未确认的所选轨音量与银行通道音量写入均已在实机由宿主反馈和独立 DirectAccess 读回确认。

`scripts/verify-song30.cjs` 通过真实 stdio MCP 在后台实例完成一首四轨、八小节的歌：28 项检查全部通过，证据在 `artifacts/ipc/song30-live-e2e1.json`。其中导入 192 个音符并逐一读回一致，贝斯轨整体升八度并连奏而其他轨不变，两次音频导出（44.1 kHz 立体声 32 位浮点，18.462 秒，峰值 -12.9 dBFS），保存后在新进程重开，读回内容与保存前一致。命令白名单 181 条逐条实机执行：103 条读回到效果，55 条宿主已接收但现有读回看不到变化，23 条在所准备的上下文中不可执行；会弹窗的命令已移除。完整测试套件 **191/191 passed**。另对控制器声明的 2550 个绑定控制逐个写入一次：645 个由宿主反馈确认（主页面 165，混音器页面 480），1426 个在该工程中不可用（银行槽位无通道、插槽无插件或宿主分支缺失），其余为只读或动作，见 [控制逐项扫描](docs/control-sweep-30.md)。

以下为此前各轮的记录。

第 28 轮：3.13 构建并通过当时改动相关的 3 项定向检查；此前 3.12 的 7 项 Save/MIDI/MCP 定向检查通过，随后真实 MCP 保存与重开内容验收通过。没有重复运行未变化的完整套件，**109/109** 是 3.9 的历史结果。统一版本门禁覆盖全部带会话的宿主操作。

第 28 轮：控制器 `2026-11-10-coverage-3.13` 当时已安装并在隔离实例激活。正式 MCP 把独立副本速度改为 **146.75** 并保存，CPR 从 **93,085** 增至 **93,730** 字节；全新进程重新打开后，MCP 读回 **146.75**，文件与保存快照一致。保存时记录的内部页在重开时自动返回主映射，不再次发出保存输入。旧的未确认请求没有重放。

3.7 新增已选通道仪器槽以及混音银行通道仪器槽、通道条效果的参数银行控制。调用 `cubase_control_get` 读取完整 `pluginIdentity`，写入时原样传入 `expectedPluginIdentity`，并附带对应通道身份；回调和宿主状态并非原子绑定，提交回执仍需后续宿主反馈确认。详见 [插件参数银行](docs/midi-plugin-banks-3.7.md)。

进一步只读快照发现，新实例在首个工程请求之前 MIDI Remote 内部输入与输出端口集合为空；之后的快照观察到了两个命名端口，控制器日志记录映射激活。两次快照和采样到的工程根变化提供了时序证据，但不单独证明全部内部回调因果。已加载的 DAWproject 组件也在调查中，尚未建立后台工程导入或存储契约。

较早的 `artifacts/live-smoke/verification.json` 记录了真实 Cubase AI 16.0.5 的发现、参数、反馈和音量写入恢复；它不证明本轮新增控制项、工程存储或完整功能覆盖。新版 `verify:live` 脚本要求当前控制器，旧记录与本轮实机验收分别记录。详细状态见 [STATUS](STATUS.md)。

**第 29 轮**：正式 MCP 已完成原生空白创建（67,595 字节）、另存为（68,380 字节）、更换后台实例后打开同一文件并连接映射；没有复制模板。旧的 146.75 保存链路没有重复测试。轨道和 MIDI/音频事件编辑、完整自动化、路由、插件状态和导出仍未完成，详见 [生命周期](docs/background-project-lifecycle.md) 与 [第 29 轮覆盖矩阵](docs/feature-coverage-29.md)；其中轨道与 MIDI 事件部分已由第 30 轮补上。

## 原生项目接口调查

已定位项目服务的类标识、接口标识、宿主请求及回调路径；标准工厂的公开数量为零，和内部登记表是否有类是两回事。显式探针命令：

```powershell
powershell.exe -NoProfile -File scripts/Inspect-ProjectFactory.ps1 -ProbeProjectService
```

该独立探针成功获取并释放原生项目服务接口，报告见 `artifacts/ipc/service-probe-20261110.json`。另一个经批准的固定诊断 DLL 在隔离测试进程中取得宿主接口并提交一次只读 `GetMusicalTrack` 请求，收到关联的错误回调，没有取得工程数据；没有修改程序指令或产品准入状态。这是早期项目服务的调查边界；后续生命周期、MIDI 导入与参数化无窗导出使用各自已验证的原生入口。

此前 R1 工具返回缺少 `SeLoadDriverPrivilege`，驱动未加载；本轮已通过普通用户态只读检查，确认一个记录在案的宿主进程确实注册了项目接口。该快照不等于当前进程已就绪，也未增加其他运行后端。

另有显式 `-ProbeEmptyRequest` 模式，在独立探针进程中验证固定空输入分支，返回值为 `1`、状态为 `4`。该结果不涉及项目数据读取或写入。详见 [服务请求契约](docs/service-request-contract.md) 和 [宿主注册入口](docs/host-registry-access.md)。

详见 [工厂恢复](docs/native-factory-recovery.md)、[项目请求路径](docs/host-project-api.md)、[原生调查范围](docs/native-interface-investigation.md) 和 [MIDI 声明覆盖清单](docs/midi-coverage-audit.md)。

## 参考

- https://github.com/PIXELHIZE/CubaseMCP
- https://steinbergmedia.github.io/midiremote_api_doc/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/Julusian/node-midi

## 会话临时文件

本轮将已确认属于本任务的 12 个 C 盘会话临时及崩溃文件（3,937,635 字节）归档到 E 盘并移除 C 盘副本；保留其他正在运行软件的临时文件和已安装依赖。后续任务辅助进程、编译和自有 Cubase 启动的 `TEMP`/`TMP` 指向 `E:\VC\CubaseMCP\artifacts\scratch-temp`，只影响这些进程，不更改系统或用户全局设置。

## 正式后台生命周期

`cubase_runtime_status` 查询自有实例；`cubase_project_create` 创建真实空白 CPR；`cubase_project_open` 打开已有 CPR；`cubase_project_save_as` 使用当前会话另存为新路径；`cubase_runtime_stop` 关闭自有实例。替换实例需要同时传 `replaceCurrent: true` 与 `confirmDiscardChanges: true`，关闭需要明确丢弃确认；默认保留现有实例。另存为不覆盖已有文件，要求已登记的当前工程路径匹配。

`cubase_midi_import` 使用同一初始化器的第四个固定操作，把一个标准 MIDI 文件按宿主自己的导入流程并入托管工程；它不选择文件、不弹窗、不改偏好。

原生初始化器固定对应本机 16.0.5.174，文件路径长度上限 500 字符。调用会检查进程寿命、父进程、隔离作业、事件线程及文档路径；创建/打开后先观察映射激活，再发送一次 MIDI 握手。失败不会重发；原生结果和文件会保留。源代码和实机证据见 [详细契约](docs/background-project-lifecycle.md)。这不是所有 Cubase 功能已完成的声明。
