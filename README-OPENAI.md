# 会议专家 · OpenAI 使用说明

当前可以体验：播放或导入会议录音 → OpenAI 实时转写 → 邀请专家分析 → 查看资料依据 → 确认决策并导出。

**当前内置场景是订单服务的技术方案评审。腾讯会议桌面音频采集、独立 Bot 入会、虚拟麦克风回传，以及宫廷剧情场景尚未接通。安装腾讯会议和 VB-CABLE 后，还不能直接在腾讯会议里召唤本程序。**

## 1. 准备运行环境

- Node.js 22.13 或以上版本。
- Chrome 或 Edge 浏览器。
- OpenAI API Key，以及对应模型的使用权限和可用额度。

在 VS Code 中打开终端，进入项目：

~~~powershell
cd 'C:\Users\wanqincao\my project\hackhon\meeting-expert'
~~~

本工作区已安装依赖。重新安装项目时使用：

~~~powershell
npm.cmd install
~~~

Windows 使用 npm.cmd 可以避免 npm.ps1 被 PowerShell 执行策略拦截。

## 2. 配置 OpenAI

打开 [本机 .env 文件](</C:/Users/wanqincao/my project/hackhon/meeting-expert/.env>)。文件已经创建；直接编辑以下配置，保留其他配置和已有密钥。

~~~dotenv
LLM_PROVIDER=openai
ASR_PROVIDER=openai
OPENAI_API_KEY=在这里填入你的OpenAI_API_Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6-terra
OPENAI_REASONING_EFFORT=none
OPENAI_TRANSCRIPTION_MODEL=gpt-live-transcribe
~~~

- OPENAI_API_KEY：填写真实 Key，不保留示例占位文字。
- OPENAI_MODEL：负责专家判断与资料检索。
- OPENAI_TRANSCRIPTION_MODEL：负责实时语音转写，与专家模型不同。
- 当前 OpenAI 路线不需要配置 DUI 的产品授权或等待 DUI 发布审核。
- Key 只保存在本地后端配置中，不发到聊天里，也不放进前端代码。

配置更改后必须重启后端，单独刷新网页不会重新读取 .env。

## 3. 启动程序

如果之前已经启动，在那个终端按 Ctrl+C 结束旧进程，再执行：

~~~powershell
cd 'C:\Users\wanqincao\my project\hackhon\meeting-expert'
npm.cmd run dev
~~~

终端出现 SEAT ready 后，打开 [会议专家工作台](http://127.0.0.1:4317)。保持启动终端运行。

页面显示“会议连接就绪”后，可以开始使用。

### 检查配置是否生效

在另一个终端执行：

~~~powershell
Invoke-RestMethod 'http://127.0.0.1:4317/api/config' | Select-Object provider, asr, model, asrModel
~~~

预期 provider 和 asr 都是 openai；模型分别显示你配置的专家模型和转写模型。这个接口只返回配置状态，不返回 Key；状态正确也不代表账号权限和联网调用已经验证成功。

## 4. 跑通第一次真实转写

1. 点击右上角“新会议”，使用干净的会议上下文。
2. 在会议录音区找到“输入方式”，选择 **OpenAI 真实转写**。
3. 点击播放按钮。现有演示录音会按播放进度发送音频，而不是一次性提前发送整个文件。
4. 等待左侧出现实际识别的会议文字。语音停顿时会提交一段音频，临时字幕随后转成最终记录。
5. 出现至少一条最终记录后，点击 **邀请专家加入**。
6. 播放自动暂停，等待已提交音频的最终结果，再让专家检索资料并分析此前的讨论。

**“预置字幕演示”使用随附时间轴，不调用语音识别；要验证 OpenAI ASR，必须选择“OpenAI 真实转写”。**

## 5. 换成自己的会议录音

1. 点击“新会议”。
2. 点击录音名称右侧的上传图标，选择 WAV 或 MP3 音频。
3. 当前原型支持不超过 40 MB、最长 15 分钟的录音；具体能否解码也取决于浏览器支持的格式。
4. 导入后会自动选择配置好的真实语音服务，点击播放即可。

更换录音需要新会议，避免把两次会议内容混在一起。上传只完成本地解码；播放后才开始向语音服务发送音频。

## 6. 与专家讨论并保存结果

- 在右侧输入框补充条件或追问，按 Enter 发送，Shift+Enter 换行。
- 点击专家回答下方的资料标签，查看引用原文。
- 点击“记录为决策”，核对或修改建议，再填写负责人和截止时间。未约定的字段留空，系统记录为“待确认”。
- 在左侧“已确认决策”标签中查看结果。
- 点击“结束会议”，再点击“导出会议记录”，下载 Markdown 文件。
- 右下角语音图标使用浏览器系统语音读出回答；它不是已接通的腾讯会议发言通道。

当前默认专家和资料针对架构评审。上传公司 Markdown / TXT 资料的入口在右侧“企业知识库”中；宫廷场景还需要另行配置专家角色与对应资料。

## 7. 常见问题

| 现象 | 检查方法 |
| --- | --- |
| OpenAI 真实转写选项是灰色 | 确认 OPENAI_API_KEY 已填，ASR_PROVIDER=openai，保存后重启后端 |
| 仍显示“本地规则演示” | 确认 LLM_PROVIDER=openai、Key 非空，并检查是否仍在访问旧进程 |
| 看不到新的“输入方式” | 使用 npm.cmd run dev 加载当前源码，并刷新网页；构建版需要先重新构建 |
| 端口 4317 已被占用 | 在原启动终端按 Ctrl+C 结束旧程序，再重新启动 |
| OpenAI 连接失败或识别失败 | 检查网络、API Key、转写模型权限和账户额度，按页面错误提示排查 |
| 邀请专家按钮不可点击 | 需要会议连接就绪，并且已经有至少一条最终会议记录 |
| 录音已播放，但字幕稍后才出现 | 等待语音分段提交和服务响应；最长音频段约 12 秒，停顿通常会更早提交 |
| 修改 .env 后没有变化 | 必须重启启动终端里的后端进程 |
| 结束会议后无法继续提问 | 点击“新会议”开始另一场会议 |

## 8. 构建版与验证命令

日常体验使用 dev 即可。需要运行构建版时：

~~~powershell
cd 'C:\Users\wanqincao\my project\hackhon\meeting-expert'
npm.cmd run build
npm.cmd start
~~~

核心测试与类型检查：

~~~powershell
cd 'C:\Users\wanqincao\my project\hackhon\meeting-expert'
npm.cmd test
node node_modules/typescript/bin/tsc --noEmit
~~~

测试使用模拟模型和语音服务消息，不代表已使用你的真实 Key 完成联调。

会议文字、专家回答和资料保存在本地 SQLite；真实转写会把音频发送到 OpenAI，真实专家调用会发送相关会议上下文与检索资料片段，并使用 API 额度。

参考：[OpenAI Docs · 实时语音转写](https://developers.openai.com/api/docs/guides/realtime-transcription)。
