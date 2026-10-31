# OpenAI 实时语音转写

依据 OpenAI Docs，语音入口改为 Realtime transcription。默认模型是 gpt-live-transcribe，后端 WebSocket 使用独立的 transcription session，API Key 只留在后端。

## 配置与体验

本机 .env 中设置 ASR_PROVIDER=openai，并填写 OPENAI_API_KEY。OPENAI_TRANSCRIPTION_MODEL 默认 gpt-live-transcribe。专家推理配置独立保留，ASR 更换不改变原有专家模型或其它密钥。

重启后端、开启新会议，在“输入方式”选择“OpenAI 真实转写”，然后播放现有演示录音；也可以导入自己的音频。默认“预置字幕演示”保持可用并明确标注，不会冒充真实识别。

本次变更仅接入语音转写。腾讯会议桌面音频采集、虚拟麦克风语音回传和完整 Bot 入会不是本次实现的一部分。

## 音频与上下文

- 保留本地传输的 16 kHz 单声道 PCM16 接口，在后端连续重采样到 OpenAI 要求的 24 kHz PCM16。
- 根据输入声音的能量判断停顿并提交音频轮次，最长 12 秒提交一次。它是简单的能量分段，噪声可能影响断句，需要实际环境调试。
- 不启用 server_vad 或 semantic_vad；当前 gpt-live-transcribe 不支持这些服务端模式。
- 临时文本仅用于字幕；最终文本进入会议上下文。不同音频轮次的完成事件可能乱序，程序按 item_id 关联并按音频顺序发布。
- 只有暂停/同步后确认所有已提交轮次完成，才能将本次完整快照用于专家评审。服务错误或超时会显示错误，不回退成预置字幕。
- 原始音频将发往 OpenAI；使用此入口需要账号拥有相应模型权限及可用额度。

当前测试使用本地模拟 WebSocket 服务，尚未使用真实 API Key 完成账号联调。

参考：[OpenAI 实时转写](https://developers.openai.com/api/docs/guides/realtime-transcription)。
