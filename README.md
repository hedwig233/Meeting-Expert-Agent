# 席位 SEAT · 会议专家

专家会议室已整合 ops-context-agent 的纪要工作流：导入纪要，按本人姓名整理任务，再按需邀请专家，通过 @ 提问获得分析与建议。专家会议室与实时会议中枢共用 SEAT 侧栏、字体、字号层级和绿色强调色，支持深色、浅色与移动端布局。

实时会议中枢保留腾讯会议 Bot 的系统音频转写、口令召唤、知识检索和专家语音回传。

左侧「实时会议中枢」进入腾讯会议控制台；「企业知识库」统一管理资料上传、原文预览与专家知识范围，两个页面使用相同入口。左下角「显示设置」支持深色、浅色或跟随系统模式，以及字号和页面缩放；设置会自动保存在当前浏览器，并在两个页面间共用。

## 工作空间入口

| 入口 | 页面与功能 |
| --- | --- |
| 专家会议室 `/` | 标题「让会议讨论，成为行动。」；导入纪要、整理本人任务和 @ 专家问答。未导入时直接展示导入引导，不再显示「等待导入会议纪要」状态字样 |
| 实时会议中枢 `/bridge.html` | 标题「让现场讨论，汇成共识。」；腾讯会议音频桥接、转写、专家分析与发言，入口位于左侧栏 |
| 企业知识库 | 左侧栏弹窗；两个页面共用同一套资料列表、上传、原文预览和知识范围设置，实时会议页底部不再单独放置专家知识库 |
| 显示设置 | 左下角弹窗；调整主题、字体大小和页面缩放，支持恢复默认 |

页面切换通过链接重新加载。专家会议室的工作台内容在离开页面后丢失，需要留存时先导出；两种会议工作流目前不会自动互相导入记录。

## 运行

需要 Node.js 22.13 或以上（使用内置 SQLite），建议使用 Node.js 24。Node.js 20 不满足项目运行要求。

~~~powershell
cd 'D:/gitPro/Meeting-Expert-Agent'
npm.cmd ci
# 首次配置；已有 .env 时保留原文件并编辑
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
# 填写所需的模型凭证后启动
npm.cmd run dev
~~~

- [专家会议室](http://127.0.0.1:4317/)：导入纪要、整理本人任务、记录讨论、@ 专家提问、核对依据、确认建议和导出。
- [实时会议中枢](http://127.0.0.1:4317/bridge.html)：采集系统音频、识别口令、专家分析，以及通过虚拟声卡回传语音。默认角色为宫廷证据评审，也可切换技术方案评审；切换角色会开启新会话。

生产运行：

~~~powershell
npm.cmd run build
npm.cmd start
~~~

修改 .env 或后端代码后需要重启服务；修改前端后，生产模式还需要重新构建并刷新页面。

## 专家会议室使用与配置

1. 点击“导入纪要”，填写纪要中使用的本人姓名，粘贴文本或上传 `.txt` / `.md`。支持 UTF-8、带 BOM 的 UTF-16 和 GB18030；文件最多 200 KB，文本最多 30,000 字。
2. 提取本人负责、协作及分工待确认的未完成任务，查看负责人、截止时间、优先级和原文依据；可勾选完成。截止时间保留原文，不自动推算日期。缺少包含本人姓名的连续原文引用的任务会被过滤，剩余结果仍需核对。
3. 选择任务，或取消选择以讨论整份纪要；邀请运维、数据库、网络、安全、产品、任务规划专家，也可填写自定义角色。邀请本身不调用模型。
4. 在输入框通过 `@` 选择已加入的专家并发送问题。普通消息和 @ 参会人只记录在本页。专家接收原始纪要、任务清单、当前任务、最近 30 条讨论及最近 5 次已完成问答；仅 @ 第一位成员决定是否调用专家。
5. 按专家查看和搜索回答，展开依据、核对原文；失败可重试。确认建议仅记录模拟执行结果。可将任务、讨论、回答和原始纪要导出为 Markdown。

本页数据仅保存在当前页面内存中，刷新、关闭或切换到实时会议中枢后需重新导入，请先导出需要留存的记录。重新提取成功会替换当前工作台；失败保留已有内容。任务专家依据纪要及讨论回答；企业知识库用于实时会议中枢的 Bot 专家。

沿用 Node 后端，无需启动 Python 服务。提取与专家回答调用 Responses API；没有密钥时提示配置，不生成本地模拟回答。独立配置示例（填入支持 Responses 的服务与模型）：

~~~ini
MINUTES_API_KEY=填写自己的凭证
MINUTES_BASE_URL=https://api.openai-next.com/v1
MINUTES_MODEL=gpt-6.1-sol
~~~

`MINUTES_*` 分别覆盖对应设置；未覆盖的值优先沿用已配置的 `openai` / `openai_next` 主模型，否则依次使用有密钥的 `OPENAI_*`、`NEXT_*`，最后尝试本机 `CODEX_HOME/auth.json`（默认 `~/.codex/auth.json`）中的 `OPENAI_API_KEY`。无配套地址或模型时使用原 ops 项目的默认地址 `https://api.openai-next.com/v1` 和模型 `gpt-6.1-sol`；`OPENAI_API_KEY` 默认配套官方地址 `https://api.openai.com/v1`。可通过 `/api/minutes/config` 查看是否配置密钥及当前模型，接口不返回密钥。实际可用性取决于账号权限与服务支持。

提取时姓名与纪要会发送给模型服务，提问时发送上述上下文。密钥只在后端读取。修改 `.env` 后重启服务。

## 实时会议中枢与腾讯会议 Bot 配置

Bot 使用以下组合；三个环节独立配置：

| 环节 | 配置 | 实际实现 |
| --- | --- | --- |
| 音频转文字 | ASR_PROVIDER=next_omni，NEXT_ASR_MODEL=qwen3-omni-flash | 分段 WAV 经 Next Chat Completions 发送，接收流式文字 |
| 专家分析 | LLM_PROVIDER=openai_next，NEXT_MODEL=gpt-5.6-terra | 读取会议快照，调用知识检索工具，生成结构化评审 |
| 专家语音 | SPEECH_PROVIDER=next_omni，NEXT_SPEECH_MODEL=qwen3-omni-flash，NEXT_SPEECH_VOICE=Ethan | 温润沉稳的男声，仅发送待朗读文字，接收流式 PCM，封装为 24 kHz 单声道 WAV |

以上 Next 调用共用后端 .env 中的 NEXT_API_KEY 和 NEXT_BASE_URL，不把密钥返回前端。语音切换只修改语音设置，保留原 Qwen 转写、专家分析和凭证。

初次配置时复制 .env.example 为 .env 并填写自己的凭证；已有 .env 时不要用示例覆盖。Next 设置如下，密钥留在本地文件中：

~~~ini
NEXT_API_KEY=
NEXT_BASE_URL=https://api.openai-next.com/v1
LLM_PROVIDER=openai_next
NEXT_MODEL=gpt-5.6-terra
NEXT_REASONING_EFFORT=none
ASR_PROVIDER=next_omni
NEXT_ASR_MODEL=qwen3-omni-flash
SPEECH_PROVIDER=next_omni
NEXT_SPEECH_MODEL=qwen3-omni-flash
NEXT_SPEECH_VOICE=Ethan
NEXT_SPEECH_STYLE=温润、沉稳、克制的中青年男声，语速稍慢，吐字清楚，像谨慎有礼的古装医官，避免夸张和播音腔
~~~

## 语音验证与切换

先验证当前 Next 账号能返回目标模型的音频，再切换：

~~~powershell
npm.cmd run qwen:tts:check -- --roundtrip
npm.cmd run qwen:tts:configure
~~~

验证只发送固定测试文字；--roundtrip 会将生成音频交给现有 Qwen 转写再次核对，不采集现场会议或向腾讯会议发言。输出音频为 data/speech-check/qwen-omni.wav 和带音色名称的 WAV，报告为同目录的 result.json。配置脚本要求存在通过验证的报告，仅设置语音 provider、model、voice 和朗读风格；不修改 ASR、LLM、API 地址或密钥。更换音色时先用 --voice=目标音色 运行检查，通过后向配置命令传入相同参数。

2026-10-31 已通过真实 Next 账号验证：音色返回有效的 24 kHz、单声道、16-bit 音频，模型返回文字和音频重新转写均与测试原文一致（忽略标点）。具体音色、耗时和音频长度见本机 result.json；短句验证不代表所有会议发言的延迟或主观音质。当前使用 Ethan 和温润、沉稳、稍慢的朗读风格，作为古装医官的演示声音，不是演员原声复刻。

语音接口只朗读当前会议中已有专家建议的 finding + question + proposal（最多 1800 字），或固定通道测试句。生成时等待完整音频后播放；拒绝无音频、流中断、异常编码、超时和朗读文字不一致的结果。失败会显示错误，不自动切回 Windows。见 [Qwen 语音接入说明](docs/qwen-omni-speech.md)。

`/bridge.html` 使用以上后端语音；专家会议室通过文字问答。

## 腾讯会议使用流程

1. 使用独立腾讯会议账号加入会议，客户端负责登录、入会及主持人准入。
2. 腾讯会议麦克风选择 **CABLE Output**，扬声器选择普通播放设备。
3. 控制台点击“识别输出设备”，专家输出选择 **CABLE Input**。点击“测试发言”确认远端参会者能听见。
4. 点击“监听腾讯会议”，在 Windows Chrome 或 Edge 中选择整个屏幕并勾选共享系统音频。只上传音频，不上传屏幕画面；系统音频可能包含其他应用。
5. 默认召唤口令为“请太医发言”；技术角色的新会话为“请专家发言”。可自定义或关闭自动触发，也可输入问题后手动邀请。
6. 在实时会议中枢查看最终转写、专家建议和引用原文，并导出当前会议记录。上传资料和调整知识范围统一通过左侧「企业知识库」完成。结束使用时停止监听并退出腾讯会议账号。

这是桌面音频桥接。官方 TencentMeetingSDK 自动入会、原始音频接收和音频注入尚未接入；远端能否听见需要实际验证本机设备路由。见 [腾讯会议接入说明](docs/tencent-bot.md)。

## Bot 音频处理与上下文

浏览器 AudioWorklet 将系统音频混为单声道，转换为 16 kHz PCM16，每约 100 ms 经本地 WebSocket 发送。后端按音量阈值判断语音，保留约 0.5 秒前置音频，停顿约 1 秒或累计 12 秒时提交一段。

Qwen 转写是 HTTP 分段云调用，流式的是该片段的文本输出。最终结果才进入会议记录和口令匹配；临时文本、[听不清]、请求失败或未完成的输出不会成为专家上下文。单段超时 60 秒，失败后继续后续片段。

等待队列达到 3 段时暂停发送新音频，降到 1 段后自动恢复。积压期间的音频不缓存、不补转写，控制台显示累计跳过的时长。邀请专家时先等待现有转写队列完成，Next 模式同步等待上限为 5 分钟。

专家分析及发言期间暂停音频传送，完成后恢复；这段期间的讨论不会补转写。当前没有说话人识别，统一显示为“会议音频”；时间标记按累计传送音频计算。口令只在单个最终转写片段中匹配，跨片段口令可能漏触发。见 [Qwen 转写说明](docs/qwen-omni.md)。

## 企业知识库与 Bot 专家

在任一页面点击左侧「企业知识库」即可管理同一个资料库：选择上传知识范围，上传文件，展开资料查看原文，并修改已有资料范围。保存失败会显示错误并保留原范围，可重试；加载或保存期间禁用相关操作。关闭弹窗不会中断实时会议的监听，弹窗支持关闭按钮及 Esc。

- 专家角色为 architecture（技术方案）或 evidence（宫廷证据）。提示词位于 server/expert-prompts.mjs。
- 知识支持 .md / .txt，最多 30 份；单份标题最多 120 字、正文最多 10 万字。前端另限制文件大小为 300 KB。
- 范围为 shared（公共）、technical（技术）和 palace（宫廷）。专家只检索公共资料和自己的专属资料；这是检索分类，不是用户权限系统。
- 文档分段后用中文双字及英文词的稀疏词项匹配排序，不依赖 embedding 服务，也没有训练模型。
- 模型收到召唤时的会议快照和最近两次专家交流，必须调用 search_company_docs，最多三轮调用。返回摘要、观察、影响、追问、建议、置信说明及引用 ID。
- 引用 ID 必须来自真实检索结果；这能防止编造出处，不能证明每一句结论都被引用支持。建议需人工核对，负责人和截止时间需明确填写后确认。

见 [专家知识范围说明](docs/expert-knowledge.md)。随附知识与剧情材料均为虚构演示资料。

## 字体、缩放与主题

点击左下角「显示设置」，修改后即时生效并自动保存：

| 设置 | 默认值 | 可选范围 |
| --- | --- | --- |
| 页面模式 | 深色模式 | 深色、浅色、跟随系统；跟随系统时响应系统明暗变化 |
| 字体大小 | 基准字号 16 px | 12–20 px，每次 1 px；标题、正文与注释按层级缩放，正文默认 14 px |
| 页面缩放 | 100% | 80%–125%，每次 5% |

两个页面使用相同字体和对应字号，窄屏标题会自动调整。显示偏好保存在当前站点的浏览器 `localStorage`，刷新、切页后保留，同源标签页同步应用；不随 Git 提交或 SQLite 数据库迁移。点击「恢复默认」回到深色、16 px 基准字号与 100% 缩放。图标导航在悬停或键盘聚焦时显示入口名称。

## Bot 其他 provider 与本地演示

代码保留以下适配器，通过 .env 明确选择；配置缺失或调用失败不会在不同云平台间静默切换：

| 环节 | 可选 provider | 配置入口 |
| --- | --- | --- |
| 专家分析 | openai_next / openai / deepseek / qwen | 对应 NEXT_* / OPENAI_* / DEEPSEEK_* / QWEN_* |
| 转写 | next_omni / local / openai / dui | Next 音频、本地 Whisper、OpenAI Realtime、思必驰 DUI |
| 后端语音 | next_omni / windows / openai | Next Omni、Windows 本地中文语音、OpenAI Realtime |

无选定模型凭证时，Bot 专家为明确标注的本地规则演示，仅支持示例订单重试案例。腾讯会议控制台会提示先配置真实转写。该演示不代表真实语音识别或通用专家能力；专家会议室需要真实模型凭证。

本地 Whisper 需要 npm.cmd run whisper:setup 后重启；Windows 语音仍可通过 SPEECH_PROVIDER=windows 手动选择。相关说明：[本地模式](docs/next-local.md)、[识别质量](docs/asr-quality.md)、[OpenAI](docs/openai.md)、[OpenAI 转写](docs/openai-asr.md)、[DUI](docs/dui-device.md)。

## 数据与验证

前端为 React / TypeScript / Vite，后端为 Node.js / Express / WebSocket / SQLite。默认监听 127.0.0.1:4317，无登录、多租户或文档级权限。

| 数据 | 保存位置 | 刷新或切页后的行为 |
| --- | --- | --- |
| 专家会议室的纪要、任务、完成状态、讨论、专家回答及模拟确认 | 当前页面内存 | 丢失；需事先导出 Markdown，再重新导入纪要开始工作 |
| 实时会议中枢的会话文字与企业知识 | `data/seat.sqlite` | 保留；新会话使用独立 ID，旧会话不会因开启新会话而删除 |
| 当前 Bot 会话 ID | 浏览器 `sessionStorage`，键 `seat-bridge-session` | 同一标签页刷新可恢复文字；现场采集音频源需重新选择 |
| 主题、基准字号、页面缩放 | 浏览器 `localStorage`，键 `seat-workspace-appearance` | 保留并在两个页面共用 |

原始会议音频通过配置的 provider 转写；Bot 专家分析发送文字和检索片段；Next 语音发送待朗读文字。企业知识库的上传内容保存在本地数据库，模型分析时才将检索片段加入上下文。

~~~powershell
npm.cmd test
npm.cmd run build
# 先运行服务，再执行浏览器测试：
npm.cmd run test:ui
# 真实 Next 转写 / 语音验证：
npm.cmd run qwen:check
npm.cmd run qwen:tts:check -- --roundtrip
~~~

当前代码最近一次完整验证通过 78 项服务端测试、11 项浏览器测试及 TypeScript / Vite 构建。自动化测试覆盖纪要任务原文校验、模型配置、接口校验与错误脱敏，以及 Bot 会议隔离、音频顺序与队列恢复、知识检索和语音处理。浏览器测试还覆盖纪要工作流、@ 路由、重试、确认、导出、移动布局、统一知识库上传与范围保存失败重试、显示设置持久化、系统主题变化和两页字号一致性；使用模拟设备和模型响应，不等于真实模型调用或腾讯会议设备路由验收。浏览器测试默认使用本机 Edge，需要先启动服务；自定义地址可设置 `PLAYWRIGHT_BASE_URL`。

## 代码入口与进一步说明

- `src/MinutesRoom.tsx`、`server/minutes.mjs`：纪要工作台与 Responses API 路由；`src/App.tsx` 指向纪要工作台。
- `src/Bridge.tsx`、`server/app.mjs`：实时会议界面、会话与音频桥接接口。
- `src/WorkspaceNav.tsx`、`src/EnterpriseKnowledge.tsx`、`src/WorkspaceDialog.tsx`：共用侧栏、企业知识库及弹窗。
- `src/AppearanceSettings.tsx`、`src/appearance.ts`、`src/workspace.css`：显示设置、持久化与两页统一样式。
- [代码与运行说明](代码与运行说明.md)：安装、配置、源码结构、接口及排查方法。
- [项目介绍](项目介绍.md)：目标用户、功能与当前实现边界。

随附演示录音可用 npm.cmd run generate:audio 重新生成，需要 Windows 中文语音。依赖、数据库和生成文件保存在本项目目录。
