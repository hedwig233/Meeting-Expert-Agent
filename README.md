# 席位 SEAT · 会议专家

接收会议音频，转成文字；听到召唤口令或被手动邀请后，专家结合当前讨论和知识资料给出建议，再生成语音发送回腾讯会议。文字、引用和人工确认的决策保存在本机。

## 运行

需要 Node.js 22.13 或以上（使用内置 SQLite）。

~~~powershell
cd 'C:/Users/wanqincao/my project/hackhon/meeting-expert'
npm.cmd install
npm.cmd run dev
~~~

- [录音演示与决策页面](http://127.0.0.1:4317/)：播放随附录音或导入音频，邀请架构专家、追问、核对引用、确认决策和导出。
- [腾讯会议控制台](http://127.0.0.1:4317/bridge.html)：采集系统音频、识别口令、专家分析，以及通过虚拟声卡回传语音。默认角色为宫廷证据评审，也可切换技术方案评审；切换角色会开启新会话。

生产运行：

~~~powershell
npm.cmd run build
npm.cmd start
~~~

修改 .env 或后端代码后需要重启服务；修改前端后，生产模式还需要重新构建并刷新页面。

## 当前配置

本项目当前使用以下组合；三个环节独立配置：

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

/bridge.html 使用以上后端语音；首页的可选朗读仍使用浏览器 speechSynthesis。

## 腾讯会议使用流程

1. 使用独立腾讯会议账号加入会议，客户端负责登录、入会及主持人准入。
2. 腾讯会议麦克风选择 **CABLE Output**，扬声器选择普通播放设备。
3. 控制台点击“识别输出设备”，专家输出选择 **CABLE Input**。点击“测试发言”确认远端参会者能听见。
4. 点击“监听腾讯会议”，在 Windows Chrome 或 Edge 中选择整个屏幕并勾选共享系统音频。只上传音频，不上传屏幕画面；系统音频可能包含其他应用。
5. 默认召唤口令为“请太医发言”；技术角色的新会话为“请专家发言”。可自定义或关闭自动触发，也可输入问题后手动邀请。
6. 在控制台查看最终转写、专家建议和引用原文，可上传知识文件、调整范围并导出记录。结束使用时停止监听并退出腾讯会议账号。

这是桌面音频桥接。官方 TencentMeetingSDK 自动入会、原始音频接收和音频注入尚未接入；远端能否听见需要实际验证本机设备路由。见 [腾讯会议接入说明](docs/tencent-bot.md)。

## 音频处理与上下文

浏览器 AudioWorklet 将系统音频混为单声道，转换为 16 kHz PCM16，每约 100 ms 经本地 WebSocket 发送。后端按音量阈值判断语音，保留约 0.5 秒前置音频，停顿约 1 秒或累计 12 秒时提交一段。

Qwen 转写是 HTTP 分段云调用，流式的是该片段的文本输出。最终结果才进入会议记录和口令匹配；临时文本、[听不清]、请求失败或未完成的输出不会成为专家上下文。单段超时 60 秒，失败后继续后续片段。

等待队列达到 3 段时暂停发送新音频，降到 1 段后自动恢复。积压期间的音频不缓存、不补转写，控制台显示累计跳过的时长。邀请专家时先等待现有转写队列完成，Next 模式同步等待上限为 5 分钟。

专家分析及发言期间暂停音频传送，完成后恢复；这段期间的讨论不会补转写。当前没有说话人识别，统一显示为“会议音频”；时间标记按累计传送音频计算。口令只在单个最终转写片段中匹配，跨片段口令可能漏触发。见 [Qwen 转写说明](docs/qwen-omni.md)。

## 专家与知识库

- 专家角色为 architecture（技术方案）或 evidence（宫廷证据）。提示词位于 server/expert-prompts.mjs。
- 知识支持 .md / .txt，最多 30 份；单份标题最多 120 字、正文最多 10 万字。前端另限制文件大小为 300 KB。
- 范围为 shared（公共）、technical（技术）和 palace（宫廷）。专家只检索公共资料和自己的专属资料；这是检索分类，不是用户权限系统。
- 文档分段后用中文双字及英文词的稀疏词项匹配排序，不依赖 embedding 服务，也没有训练模型。
- 模型收到召唤时的会议快照和最近两次专家交流，必须调用 search_company_docs，最多三轮调用。返回摘要、观察、影响、追问、建议、置信说明及引用 ID。
- 引用 ID 必须来自真实检索结果；这能防止编造出处，不能证明每一句结论都被引用支持。建议需人工核对，负责人和截止时间需明确填写后确认。

见 [专家知识范围说明](docs/expert-knowledge.md)。随附知识与剧情材料均为虚构演示资料。

## 其他 provider 与本地演示

代码保留以下适配器，通过 .env 明确选择；配置缺失或调用失败不会在不同云平台间静默切换：

| 环节 | 可选 provider | 配置入口 |
| --- | --- | --- |
| 专家分析 | openai_next / openai / deepseek / qwen | 对应 NEXT_* / OPENAI_* / DEEPSEEK_* / QWEN_* |
| 转写 | next_omni / local / openai / dui | Next 音频、本地 Whisper、OpenAI Realtime、思必驰 DUI |
| 后端语音 | next_omni / windows / openai | Next Omni、Windows 本地中文语音、OpenAI Realtime |

无选定模型凭证时，专家为明确标注的本地规则演示，仅支持示例订单重试案例。没有可用云转写凭证时，首页可播放约 40 秒合成录音，并按已发送的播放进度显示预置字幕；腾讯会议控制台会提示先配置真实转写。该演示不代表真实语音识别或通用专家能力。

本地 Whisper 需要 npm.cmd run whisper:setup 后重启；Windows 语音仍可通过 SPEECH_PROVIDER=windows 手动选择。相关说明：[本地模式](docs/next-local.md)、[识别质量](docs/asr-quality.md)、[OpenAI](docs/openai.md)、[OpenAI 转写](docs/openai-asr.md)、[DUI](docs/dui-device.md)。

## 数据与验证

前端为 React / TypeScript / Vite，后端为 Node.js / Express / WebSocket / SQLite。默认监听 127.0.0.1:4317，无登录、多租户或文档级权限。

会话与知识保存在 data/seat.sqlite。新会话使用独立 ID；旧会话仍保留，浏览器 sessionStorage 保存当前会话 ID。刷新保留文字，现场采集及导入音频源需重新选择。原始会议音频通过配置的 provider 转写；专家分析发送文字和检索片段；Next 语音发送待朗读文字。

~~~powershell
npm.cmd test
npm.cmd run build
# 先运行服务，再执行浏览器测试：
npm.cmd run test:ui
# 真实 Next 转写 / 语音验证：
npm.cmd run qwen:check
npm.cmd run qwen:tts:check -- --roundtrip
~~~

自动化测试覆盖会议隔离、音频顺序与队列恢复、角色知识范围、检索与引用校验、决策确认、导出、语音 provider 选择、编码、取消、超时和错误脱敏。浏览器测试包括录音页面和桥接页面；使用模拟设备和模型响应，不等于真实腾讯会议设备路由验收。

随附演示录音可用 npm.cmd run generate:audio 重新生成，需要 Windows 中文语音。依赖、数据库和生成文件保存在本项目目录。
