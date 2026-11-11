# Cubase AI 16 MCP 🐾

Windows 本地 MCP，用一条 MIDI Remote 后台通道指挥 Cubase 16 干活喵。参考 PIXELHIZE/CubaseMCP 的 MIDI 桥接思路独立实现，不是那 238 个工具的翻版喵。

本喵只待后台：工具能在隔离桌面启动和管理自有 Cubase，但不抢前台、不点菜单、不往任何窗口塞键盘鼠标喵。安装位置、控制器版本和客户端注册这类本机记录放在 [本机环境记录](docs/local-environment.md) 里喵，版本历史在 [CHANGELOG](CHANGELOG.md) 里喵。

## 固定约束

- 正式生命周期工具在隔离桌面启动和管理自有 Cubase 实例，不激活、不切换前台，不发送键盘鼠标输入，也不点菜单或对话框喵。
- 音频导出走宿主 NonUI 控制器，音频导入直接传路径，不打开文件选择或导出窗口喵。
- 非自有实例不会被接管，也不会被结束喵。
- 参数和控制走单一 `midi` 通道；创建、打开、另存为、MIDI/音频导入、音频导出和原生事件读写走明确的固定操作喵。
- 不按失败结果切换通道，没有 mock、UI 或协议 fallback 喵。
- 宿主弹出的提示框无法被应答；会弹窗的命令已从白名单移除喵。`cubase_runtime_windows` 只读地报告隔离桌面上的意外窗口，真出现了就用 `cubase_project_open`/`cubase_project_create`（`replaceCurrent`）换一个实例喵。
- 指定端口不存在、对象失效、API 缺失、命令不可执行时直接返回错误，不编造结果喵。
- 超时或取消后的修改可能已经被 Cubase 接收，结果记为 `unknown`，不重试、不重放喵；重新连接必须显式调用工具喵。

当前支持空 MIDI、乐器、Group、FX、文件夹创建，插入插件卸载，自动化轨道和点编辑，音频总线和发送路由喵。范围、限制和实测证据见 [当前状态](STATUS.md) 与 [原生契约](docs/native-host-contracts-34.md) 喵。

## 安装和启动

需要 Node.js 22+、已激活的 Cubase AI 16，以及能提供两个独立双向虚拟 MIDI 端口的驱动，例如 loopMIDI 喵。端口名字必须精确是喵：

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

`setup:midi` 需要管理员权限，只通过 WinGet 安装官方 loopMIDI 包，已经装过就不重复装喵。`start:ports` 用已安装的 virtualMIDI 库，在无窗口进程里提供两个回环端口喵。它没有注册开机或登录自启动，结束进程或重新登录后要重新运行喵；`stop:ports` 可以明确停掉端口宿主喵。

`npm run cleanup:temp` 清理 `artifacts` 里超过 1 小时的临时输出，`--dry-run` 只预览并给出 JSON 汇总喵。MCP 服务连上 stdio 后 30 秒在后台执行一次、之后每小时一次：生命周期请求记录、`scratch-temp` 和原子写入备份都按 1 小时算，只有 `artifacts/temp-cleanup-keep.txt` 列出的目录保留喵。时长和开关写在 `cubase.config.json` 的 `cleanup` 里喵。

生命周期启动端口宿主后，会等本次 PID 的就绪记录和精确端口枚举，最长 15 秒喵。宿主由独立进程创建，不继承生命周期响应管道喵。`install:remote` 只复制四个 MIDI Remote 文件，默认不覆盖不同内容喵。Cubase 正常使用时需要加载这个驱动，别把两个控制端口加进 MIDI 轨道的输入或 MIDI Thru 回路喵。MCP 服务不会自动安装驱动；显式生命周期请求会在私有桌面启动自有 Cubase 和需要的端口宿主喵。

`cubase_project_create` / `cubase_project_open` 已经内置独立启动，不需要手动跑外部启动脚本喵。原生工程操作还没提交、启动又停在“检查许可证”时，MCP 会结束受管 Cubase 和同会话的确切许可辅助进程，然后自动重启一次，结果里带 `startupRecovery` 喵。它不会结束主人另开的 Cubase，不改授权文件，不回答提示框，也不重放已提交的编辑喵。

标准输出只用于 MCP 协议喵。其他机器按自己的 Node 路径和 `CUBASE_MCP_CONFIG` 启动 `dist/src/server.js` 就好喵。

## 做一首歌的流程

1. `cubase_project_create`（或 `cubase_project_open`）得到托管工程和 `session` 喵。
2. `cubase_tempo_set` 设速度，`cubase_transport_set`（`field: "signature"`，如 `"3/4"`）设拍号喵。
3. `cubase_midi_import` 传入 `song`：每条轨道的音符以四分音符拍为单位（`pitch`、`start`、`duration`、`velocity`），可带 `channel`（9 为 GM 鼓）、`program`、控制器和弯音，也可以直接传现成的 `.mid` 路径喵。空轨道用 `cubase_track_create`，`kind` 可选 `midi`、`instrument`、`group`、`fx`、`folder` 喵。乐器轨道初始插槽为空，先用 `cubase_objects_list` 发现该槽，再用 `cubase_plugins_list` 和 `cubase_plugin_set` 分配实际候选乐器喵。
4. `cubase_events_list` 直接读原生轨道、Part、音频事件和单个 MIDI 音符，返回临时 `eventId`、路径和工程秒数，以及音符的音高、力度与通道喵。`cubase_midi_read` 保留为宿主 MIDI 文件导出解析路径，`cubase_channels_list` 列出混音通道喵。
5. `cubase_event_edit` 移动或裁剪一个音频事件/Part；`cubase_midi_note_edit` 修改一个音符的 `pitch`、`velocity`、`position` 或 `duration`，每次一个字段喵。把快照里的 `root`、`path`、`eventId` 和原值复制进请求，停止走带后提交，以回执 `confirmed` 为准喵。轨道与选择编辑继续用 `cubase_channel_set`、`cubase_track_edit` 和白名单命令喵。
6. `cubase_audio_import` 按明确路径导入音频并保留源文件喵。导入前它会从已保存的 CPR 读取工程采样率并与源文件比较：Cubase 在这条导入路径上不做转换，48 kHz 文件进 44.1 kHz 工程会慢放 8.1 % 喵。`sampleRateMismatch` 默认 `convert`（仅 WAV：写入转换后的 32 位浮点副本再导入），也可选 `reject` 或 `ignore`，结果里的 `sampleRate.check` 说明实际发生了什么喵。Cubase AI 最多只允许 32 条音频轨：满了以后再导入会“成功”却不加通道，此时工具返回 `AUDIO_TRACK_LIMIT_SUSPECTED`，先用 `cubase_track_edit remove` 删掉不用的音频轨再导入喵。
7. `cubase_transport_action` 播放、停止、回零；`cubase_audio_export` 通过宿主 NonUI 导出器写出缩混，`outputPath` 指定文件名和目录，`format` 选择 WAV/AIFF/FLAC，`sampleRate`、`bitDepth`、`floatingPoint` 指定采样格式，结果按实际文件头核对喵。它不打开导出窗口、不执行导出键盘命令；`cubase_project_save` 负责保存喵。

`cubase_automation_read` 按轨道返回参数轨道和归一化点，`cubase_automation_edit` 支持 `createLane`、`insert`、`setValue`、`move`、`delete`，带原值及点数校验喵。`cubase_routes_list` 返回宿主实际音频输入/输出和发送目标，`field: "send"` 另带零基 `sendIndex`，写入时传列表返回的 `expectedSlotUniqueId` 喵。`cubase_routing_set` 校验旧值及目标名称后写入，并通过 MIDI 独立读回喵。输出/发送路由和编辑后的自动化点都过了保存重开验收喵。

详细契约、观察到的宿主行为和限制见 [做歌工具](docs/song-tools-30.md)，逐条命令的实机结果见 [命令白名单](docs/command-allowlist-30.md) 喵。回执里的 `submitted` 只表示宿主接受了请求，是否生效以读回为准喵。

## 控制流程

1. `cubase_status` 获取本次活动页面的 `session`、实际能力及 `serverCompatibility` 喵。只有 `readyForOperations: true` 的当前版本活动映射才接受会话操作，旧版控制器只供状态诊断喵。
2. `cubase_objects_list` 分页发现根及子对象，`cubase_parameters_list` 取得该对象的真实参数标签喵。
3. 带同一 `session`、`root`、`objectId` 和 `tag` 调用 `cubase_parameter_set`，可指定 normalized、plain 或 display 格式喵。
4. 读回确认修改喵。`submitted` 只表示已经提交，不等于操作已完成喵。

当前工程保存通过 `cubase_command_execute` 提交 `key: "project.save"`、当前 `session` 和 `confirmCurrentSelection: true` 喵。控制器使用独立的最小 Save 映射页，只发送一次 MIDI 按下，观察到绑定后释放并返回主映射，后续请求使用回执里的新 `session` 重新发现对象喵。这条保存路径不选择目标，带路径另存为使用 `cubase_project_save_as` 喵。超时后的未确认结果不重发，实测链路见 [保存与重开](docs/project-save-chain-28.md) 喵。

`cubase_project_save` 把单次 MIDI 保存与文件观察封装成一个工具：传入已确认的当前 CPR 绝对路径及 `confirmCurrentProjectPath: true`，返回 `file.state` 喵。`changed_stable` 表示观察到内容变化并稳定，`change_not_observed` 表示未确认变化喵；路径由调用方声明，工具不选择目标、不另存为，也不把文件变化冒充重开语义验收喵。详见 [工具契约](docs/project-save-tool.md) 喵。

## 工具一览

共 53 个 MCP 工具喵。单参数及单控制项查询、参数编辑锁、所选轨道身份和前后导航、混音通道位置、速度和时间显示反馈，以及宿主版本和功能上限查询都有明确会话约束喵。`cubase_parameter_edit_lock_set` 需要已观察的参数和匹配的 `expectedLocked`，回执表示已提交，后续状态用 `cubase_parameter_get` 读喵。已选轨控制包括四段 EQ、前级滤波、发送、乐器槽、五类通道条效果及其参数页、自动化和只读电平表喵。`cubase_control_set` 可同时校验选中通道的唯一 ID 和运行时 ID，但这些检查不是与宿主状态原子绑定的事务喵。插件装入和替换使用 `cubase_plugin_set`；`cubase_plugin_unload` 校验插槽及其中的插件 ID，原生卸载后确认子对象数为零，已在实机观察到无提示框卸载喵。Control Room、固定银行及菜单白名单的可用性仍以宿主实际返回为准喵。

`cubase_status` 返回紧凑握手，不再内嵌完整对象和控制表喵。`cubase_controls_list` 的控制和分组分别分页，按 `nextOffset`、`nextGroupOffset` 获取全部项目；`cubase_transport_get` 提供速度与定位器的可用性和实际反馈喵。长身份标识原样保留，描述性元数据有长度上限喵。

`cubase_capabilities` 始终返回静态约束；宿主部分先读取自有运行时清单，再用 2000 ms 的只读握手读取喵。没有自有实例或映射不回答时，`host` 为 `null`，`hostState` 明确给出 `observed`、`code`、`timeoutMs` 和下一步操作，不会把整个查询变成一次 8 秒传输超时喵。`cubase_status` 仍使用完整配置时限喵。`bridge.status` 是只读请求：丢失回复记为 `not_started`，空闲连接会被丢弃并在下一次请求时重新打开，请求本身不重发；有写入在途时仍按未知结果处理喵。

插入效果查看器支持提交开启、旁路、自动化和参数写入喵。调用前通过 `cubase_control_get` 取得完整插件身份，并在 `cubase_control_set` 中传入该身份和当前轨道或银行通道身份；这些检查不是原子事务，提交后仍需独立读回，实际 Cubase 效果待验证，见 [插入效果查看器](docs/midi-insert-viewer.md) 喵。

轨道控制的过程值和显示值来自宿主反馈，尚未收到反馈时为 `null`，切换轨道会撤销上一轨缓存喵。速度和时间显示也只返回本次活动映射收到的回调，不推测未反馈的值喵。

对象编号和参数标签必须来自当次发现，标签可以是有符号整数喵。页面切换使旧 `session` 失效，实际对象删除会撤销对应记录喵。根对象首屏重新发现会显式刷新该根快照，后续参数读取不会暗中重建 ID 喵。普通变化通知不会清空独立的轨道控制反馈喵。

参数的 `value` 和 `defaultValue` 是宿主原生数值，不保证在 0–1 之间喵。`normalized` 写入仍校验 0–1；工程单位和显示文本分别使用 `plain`、`display`，`expectedValue` 比较原生过程值喵。

连接出错后，先核对实际状态，再显式调用 `cubase_connection_reset`，该工具不会重放之前的请求喵。每条请求都有截止时间，过期的排队工作不会执行喵。

状态返回队列和发现记录有容量上限喵。请求编号按各自的截止时间记忆（最多 4096 个，截止时间最远 10 分钟），过期后才遗忘，页面切换不会清空；同一编号不会被执行第二次喵。Cubase 偶尔会丢掉一条应答（走带停止时观察到），客户端会按请求编号向桥接取回已保存的应答，操作本身不会重发喵。

控制器把控制分成两个映射页：主页面（走带、所选轨、快速控制、Control Room、全部命令和 DirectAccess）与混音器页面（全部 `mixer.*` 银行控制）喵。`cubase_pages_list` 查看当前页面和激活计数，`cubase_page_activate` 切换并返回新 `session`；对非当前页面的操作返回 `PAGE_INACTIVE` 喵。`cubase_control_set` 默认等待宿主反馈并在 `confirmation.state` 中报告是否观察到，`cubase_command_execute` 报告 `bindingObserved` 喵。

## 原生项目接口调查

已定位项目服务的类标识、接口标识、宿主请求及回调路径；标准工厂的公开数量为零，和内部登记表是否有类是两回事喵。显式探针命令：

```powershell
powershell.exe -NoProfile -File scripts/Inspect-ProjectFactory.ps1 -ProbeProjectService
```

这个独立探针成功获取并释放原生项目服务接口，报告见 `artifacts/ipc/service-probe-20261110.json` 喵。另一个经批准的固定诊断 DLL 在隔离测试进程中取得宿主接口并提交一次只读 `GetMusicalTrack` 请求，收到关联的错误回调，没有取得工程数据，也没有修改程序指令或产品准入状态喵。这是早期项目服务的调查边界，后续生命周期、MIDI 导入与参数化无窗导出使用各自已验证的原生入口喵。

另有显式 `-ProbeEmptyRequest` 模式，在独立探针进程中验证固定空输入分支，返回值为 `1`、状态为 `4`，不涉及项目数据读写喵。详见 [服务请求契约](docs/service-request-contract.md) 和 [宿主注册入口](docs/host-registry-access.md) 喵。

详见 [工厂恢复](docs/native-factory-recovery.md)、[项目请求路径](docs/host-project-api.md)、[原生调查范围](docs/native-interface-investigation.md) 和 [MIDI 声明覆盖清单](docs/midi-coverage-audit.md) 喵。

## 正式后台生命周期

`cubase_runtime_status` 查询自有实例，`cubase_project_create` 创建真实空白 CPR，`cubase_project_open` 打开已有 CPR，`cubase_project_save_as` 使用当前会话另存为新路径，`cubase_runtime_stop` 关闭自有实例喵。替换实例需要同时传 `replaceCurrent: true` 与 `confirmDiscardChanges: true`，关闭需要明确丢弃确认，默认保留现有实例喵。另存为不覆盖已有文件，要求已登记的当前工程路径匹配喵。

`cubase_midi_import` 使用同一初始化器的第四个固定操作，把一个标准 MIDI 文件按宿主自己的导入流程并入托管工程；它不选择文件、不弹窗、不改偏好喵。

原生初始化器对应固定的 Cubase 版本，文件路径长度上限 500 字符喵。调用会检查进程寿命、父进程、隔离作业、事件线程及文档路径；创建/打开后先观察映射激活，再发送一次 MIDI 握手喵。失败不会重发，原生结果和文件会保留喵。源代码和实机证据见 [详细契约](docs/background-project-lifecycle.md)，这不代表所有 Cubase 功能都已完成喵。

## 文档地图

- [CHANGELOG.md](CHANGELOG.md)：轮次、版本和控制器修订记录喵。
- [STATUS.md](STATUS.md)：当前状态、覆盖范围和剩余工作喵。
- [docs/local-environment.md](docs/local-environment.md)：本机安装位置、控制器部署、客户端注册和临时目录喵。
- [docs/architecture.md](docs/architecture.md)：模块边界和调用链路喵。
- [docs/module-inventory.md](docs/module-inventory.md)：源码到运行目标的映射喵。
- [docs/native-host-contracts-34.md](docs/native-host-contracts-34.md)：原生生命周期与操作契约喵。
- [docs/background-project-lifecycle.md](docs/background-project-lifecycle.md)：正式后台生命周期喵。
- [docs/song-tools-30.md](docs/song-tools-30.md)：做歌工具详细契约喵。

## 参考

- https://github.com/PIXELHIZE/CubaseMCP
- https://steinbergmedia.github.io/midiremote_api_doc/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/Julusian/node-midi

## 许可证

本项目使用 [MIT License](LICENSE)，版权归 2026 Asakitan 所有喵。
