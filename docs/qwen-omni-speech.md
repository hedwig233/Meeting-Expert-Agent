# Next Qwen 专家语音

腾讯会议控制台的专家语音通过 Next 上的 qwen3-omni-flash 生成，当前音色为 Ethan，搭配温润、沉稳、克制、稍慢的朗读风格，用于古装医官演示。它是平台预置男声，不是“温实初”演员原声复刻。未设置 NEXT_SPEECH_VOICE 时，适配器使用平台默认 Cherry。语音与转写独立配置，共用 NEXT_API_KEY / NEXT_BASE_URL；切换语音不修改 ASR_PROVIDER、NEXT_ASR_MODEL 或 LLM 配置。

## 已验证结果

2026-10-31 使用本项目 .env 中的真实 Next 凭证发送固定测试句，取得有声的 24 kHz、单声道 PCM16；封装后的 WAV 可解码。当前音色、风格、耗时和音频长度记录在 result.json。模型输出文字与原句一致，生成音频经现有 Qwen 转写再次核对，也与原文一致（忽略标点）。主观音质可通过生成的 WAV 试听，远端腾讯会议音频路由仍需设备测试。

~~~powershell
npm.cmd run qwen:tts:check -- --roundtrip
npm.cmd run qwen:tts:configure
# 更换音色：先验证，再切换。
npm.cmd run qwen:tts:check -- --voice=Ethan --roundtrip
npm.cmd run qwen:tts:configure -- --voice=Ethan
~~~

检查脚本只发送固定文字和生成音频，不采集会议、不向会议发言、不打印密钥。结果保存为 data/speech-check/qwen-omni.wav、qwen-omni-Ethan.wav 和 result.json（命名音频随 voice 改变）。--style=描述 可覆盖检查时的朗读风格，配置脚本保存验证过的风格。

配置脚本要求有通过验证的目标模型/音色报告，仅设置：

~~~ini
SPEECH_PROVIDER=next_omni
NEXT_SPEECH_MODEL=qwen3-omni-flash
NEXT_SPEECH_VOICE=Ethan
NEXT_SPEECH_STYLE=温润、沉稳、克制的中青年男声，语速稍慢，吐字清楚，像谨慎有礼的古装医官，避免夸张和播音腔
~~~

写入前校验其余 .env 设置保持原值。修改后重启后端；控制台的“专家语音”应显示 qwen3-omni-flash · Ethan。音色和风格都由后端读取，此次更换不需要重新构建前端。

## 协议和播放

server/next-omni-speech.mjs 向 NEXT_BASE_URL/chat/completions 发起独立 HTTP 请求：仅发送待朗读文字和风格描述，不发送会议音频、资料或检索工具。参数为目标模型、modalities=[text,audio]、audio={voice:所选音色,format:wav}、stream=true、enable_thinking=false。风格只影响朗读表现，不能改变原文。

按 SSE 解析 choices[0].delta.audio.data 的 Base64 音频以及文本，支持网络与编码分块。经当前 Next 账号验证，format=wav 实际返回的是 24 kHz 单声道 PCM16；后端补齐 WAV 文件头。其他封装会显式报错，避免将文件头当音频数据。

完成后校验朗读文字与专家建议一致（容许标点及空白差异），再返回 audio/wav。无音频、无朗读文字、改写内容、编码异常、截断、流中断和超时均拒绝播放；不静默降级到 Windows。单次语音生成上限为 60 秒，单次最多接收 12 MiB 音频。

POST /api/sessions/:id/speech 仅接收当前会话的 messageId 或 test=true；普通建议朗读 finding + question + proposal，截取最多 1800 字。GET /api/config 只公开 provider、model、voice 和可用状态，不返回凭证。取消接口和 HTTP 客户端断开会终止生成请求。

浏览器取得完整 WAV 后，沿用 setSinkId 将音频发送到 CABLE Input，腾讯会议麦克风接收 CABLE Output。生成和播放期间暂停传送会议输入，播放完成后恢复。首页浏览器 speechSynthesis 不使用此后端语音接口。

严格校验可能拒绝将数字或术语改写为另一种表达的模型结果；应核对错误、缩短或调整专家表述后重试，不播放未核对的改写。

协议参考：[阿里云 Qwen-Omni 音频输出](https://help.aliyun.com/zh/model-studio/qwen-omni)、[Omni 音色列表](https://help.aliyun.com/en/model-studio/omni-voice-list)。平台支持以本项目的真实验证结果为准。
