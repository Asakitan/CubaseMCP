# Cubase AI 16 MCP

Windows 本地 MCP，使用单一 MIDI Remote 后台通道控制 Cubase 16。参考 PIXELHIZE/CubaseMCP 的 MIDI 桥接方向，独立实现；不是其 238 个工具的复制版。

## 固定约束

- MCP 运行时不启动、激活或切换 Cubase 窗口，不发送键盘鼠标输入，不操作菜单或对话框。独立的诊断启动器可以在隔离桌面打开测试副本，不接入 MCP 工具。
- 只有 `midi` 后端；无 mock、UI、其他适配器或协议 fallback。
- 指定端口不存在、对象失效、API 缺失、命令不可执行时直接返回错误。
- 超时或取消后的修改可能已被 Cubase 接收，结果记为 `unknown`；不重试、不重放。重新连接必须显式调用工具。
- 当前 MIDI 后端尚未实现工程创建、存储、编辑和参数化导出；完整目标仍在进行，新增能力必须以实际 Cubase 结果验收。

## 安装和启动

需要 Node.js 22+、已激活的 Cubase AI 16，以及提供两个独立双向虚拟 MIDI 端口的驱动，例如 loopMIDI。端口必须精确命名：

```text
CubaseAI MCP To Cubase
CubaseAI MCP From Cubase
```

```powershell
npm ci
npm run build
npm test
npm run setup:midi
npm run start:ports
npm run install:remote
npm run doctor -- --live
```

`setup:midi` 需要管理员权限，只通过 WinGet 安装官方 loopMIDI 包；已安装时不重复安装。`start:ports` 使用已安装的 virtualMIDI 库，在无窗口进程中提供两个回环端口。没有注册开机或登录自启动，结束进程或重新登录后需重新运行。`stop:ports` 可明确停止端口宿主。

`install:remote` 只复制四个 MIDI Remote 文件，默认不覆盖不同内容。Cubase 需要在正常使用时加载该驱动。不要把这两个控制端口加入 MIDI 轨道的输入或 MIDI Thru 回路。MCP 服务本身不会安装驱动或启动其他应用。

本机已经完成以上安装。诊断用 `npm run start:cubase-background` 在独立 Windows 桌面打开官方 AI 模板的副本，不切换当前桌面；它不是不依赖 GUI 的 Cubase 引擎，首次工程目录等初始化可能仍需确认。本次已获得允许，在隔离桌面完成了一次性初始化；相关临时代码仅留在忽略的 `artifacts/setup`，未接入 MCP 后端。

VS Code 配置已放在 `.vscode/mcp.json`，构建后可在 MCP 面板启动 `cubase-ai16-headless`。其他客户端的 stdio 启动命令为 `node E:/VC/CubaseMCP/dist/src/server.js`。标准输出只用于 MCP 协议。

## 本机路径

`D:\CubaseAI` 中发现的是 Steinberg Download Assistant 安装包和音色内容，包括 `WIN64\Cubase 16.0.5 - Application\Cubase_16.0.5_Installer_win64.zip`。

已安装程序是 `C:\Program Files\Steinberg\Cubase 16\Cubase 16.exe`（16.0.5）。两个目录分别记录在 `cubase.config.json`；不会把下载目录作为可执行程序启动，也不会扫描并切换其他安装。

## 控制流程

1. `cubase_status` 获取本次活动页面的 `session`、实际能力及 `serverCompatibility`。只有 `readyForOperations:true` 的当前版本活动映射才接受会话操作；旧版控制器仅供状态诊断，不执行读取或修改请求。
2. `cubase_objects_list` 分页发现根及子对象；`cubase_parameters_list` 取得该对象的真实参数标签。
3. 带同一 `session`、`root`、`objectId` 和 `tag` 调用 `cubase_parameter_set`；可指定 normalized、plain 或 display 格式。
4. 读回确认修改。`submitted` 只表示已经提交，不等于操作已完成。

共 23 个 MCP 工具。新增单参数及单控制项查询、所选轨道身份和前后导航、混音通道位置、速度和时间显示反馈，以及宿主版本和功能上限查询。已选轨控制包括四段 EQ、前级滤波、音频发送、Cue Send、乐器槽、五类通道条效果的 20 个绑定、自动化和只读电平表；发送槽数量按宿主返回值确定，可用性以实际返回为准。`cubase_control_set` 可传入 `expectedTrackUniqueId` 防止写到已经改变的选中轨道。插件替换要求 `confirmReplacement:true`，当前选择命令要求 `confirmCurrentSelection:true`。另有 Control Room 根、主通道及按宿主上限创建的索引通道绑定；这不表示 AI 版本实际开放了 Control Room。菜单执行仅限固定清单。

轨道控制的过程值和显示值来自宿主反馈，尚未收到反馈时为 `null`；切换轨道会撤销上一轨缓存。速度和时间显示也只返回本次活动映射收到的回调，不推测未反馈的值。

对象编号和参数标签必须来自当次发现；标签可以是有符号整数。页面切换使旧 `session` 失效，实际对象删除会撤销对应记录。根对象首屏重新发现会显式刷新该根快照；后续参数读取不会暗中重建 ID。普通变化通知不会清空独立的轨道控制反馈。

参数的 `value` 和 `defaultValue` 是宿主原生数值，不保证在 0–1 之间。`normalized` 写入仍校验 0–1；工程单位和显示文本分别使用 `plain`、`display`。`expectedValue` 比较原生过程值。

连接出错后，先核对实际状态，再显式调用 `cubase_connection_reset`，该工具不会重放之前的请求。每条请求都有截止时间，过期的排队工作不会执行。

状态返回队列和发现记录的容量上限。当前页面最多记录 4096 个请求编号；达到上限会拒绝新请求，需要在 Cubase 中重新激活映射页后取得新会话，不会为了继续执行而自动清空去重记录。

## 验证状态

本轮 TypeScript 构建通过，测试 **57/57** 通过。统一版本门禁覆盖全部 19 个带会话的宿主操作，诊断命令将端口和握手状态与实际操作就绪状态分开报告。

控制器 `2026-11-10-coverage-2` 已安装并读回核对；原版本备份于 `artifacts/runtime/controller-before-coverage-2-20261110.js`，另外三个脚本内容未变。上一轮运行的隔离 Cubase 当时加载更早版本，实机返回 `readyForOperations:false`，一次旧版对象读取在执行前以 `BRIDGE_UPGRADE_REQUIRED / not_started` 结束，证据见 `artifacts/live-smoke/guard-live-20261110.json`。新控制器尚待自动激活及实机验收。

较早的 `artifacts/live-smoke/verification.json` 记录了真实 Cubase AI 16.0.5 的发现、参数、反馈和音量写入恢复；它不证明本轮新增控制项、工程存储或完整功能覆盖。新版 `verify:live` 脚本要求当前控制器，旧记录与本轮实机验收分别记录。详细状态见 [STATUS](STATUS.md)。

**当前状态（第 07 轮）**：已获准重启专用隔离测试实例，原工程和自动备份均已保留。启动器新增显式现有 CPR 路径和私有桌面隐藏控制台，当前测试副本为 `MCP Recovered 20261110.cpr`；实例尚停在启动确认阶段，当前没有已验证的 MIDI 握手。创建、存储、编辑工程和完整功能验收仍在进行，端口存在、进程存活和完成状态分别记录。详见 [启动恢复记录](docs/startup-recovery-investigation.md)。

## 原生项目接口调查

已定位项目服务的类标识、接口标识、宿主请求及回调路径；标准工厂的公开数量为零，和内部登记表是否有类是两回事。显式探针命令：

```powershell
powershell.exe -NoProfile -File scripts/Inspect-ProjectFactory.ps1 -ProbeProjectService
```

该探针在独立进程中成功获取并释放了原生项目服务接口，没有修改工厂检查、伪造宿主、连接运行中的 Cubase 或发送工程请求。报告见 `artifacts/ipc/service-probe-20261110.json`。已静态还原一个 `GetMusicalTrack` 请求候选，但真实工程上下文和返回值生命周期仍待接通；当前 MCP 尚未实现工程创建、存储、编辑和参数化导出。

此前 R1 工具返回缺少 `SeLoadDriverPrivilege`，驱动未加载；本轮已通过普通用户态只读检查，确认一个记录在案的宿主进程确实注册了项目接口。该快照不等于当前进程已就绪，也未增加其他运行后端。

另有显式 `-ProbeEmptyRequest` 模式，在独立探针进程中验证固定空输入分支，返回值为 `1`、状态为 `4`。该结果不涉及项目数据读取或写入。详见 [服务请求契约](docs/service-request-contract.md) 和 [宿主注册入口](docs/host-registry-access.md)。

详见 [工厂恢复](docs/native-factory-recovery.md)、[项目请求路径](docs/host-project-api.md)、[原生调查范围](docs/native-interface-investigation.md) 和 [MIDI 声明覆盖清单](docs/midi-coverage-audit.md)。

## 参考

- https://github.com/PIXELHIZE/CubaseMCP
- https://steinbergmedia.github.io/midiremote_api_doc/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/Julusian/node-midi
