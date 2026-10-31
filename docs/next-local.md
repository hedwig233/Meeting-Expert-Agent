# Next 专家 + 本地 Whisper + Windows 中文语音

Next 平台 Key 只用于 https://api.openai-next.com/v1 的专家文本分析。原音频由本地 Whisper 识别，专家回答由 Windows 中文语音合成，再通过 CABLE Input 回到腾讯会议。

## 第一次启动

~~~powershell
cd 'C:\Users\wanqincao\my project\hackhon\meeting-expert'
npm.cmd run whisper:setup
npm.cmd run local:check
npm.cmd start
~~~

本地模型与程序从 whisper.cpp 官方发行包和其文档指定的模型仓库下载。约 142 MiB 的多语言 base 模型放在 data/whisper 中，安装程序验证校验值。不需要转写 API Key。setup 下载失败时不会显示“模型已就绪”。

## 配置

- LLM_PROVIDER=openai_next
- NEXT_API_KEY：你在 Next 平台领取的 Key
- NEXT_BASE_URL=https://api.openai-next.com/v1
- NEXT_MODEL=gpt-5.6-terra（按你提供的模型列表原样填写）
- ASR_PROVIDER=local
- SPEECH_PROVIDER=windows
- WINDOWS_SPEECH_VOICE 可留空，自动使用已安装的中文 Windows 语音。

以前误放在 OPENAI_API_KEY 的 Next Key 已迁移到 NEXT_API_KEY，不再发送到 OpenAI 官方地址。

## 入会

1. 用独立腾讯会议账号加入会议，麦克风选 CABLE Output，扬声器选普通播放设备。
2. 用 Windows Chrome / Edge 打开 http://127.0.0.1:4317/bridge.html。
3. 点击“识别输出设备”，选 CABLE Input，再测试发言。
4. 点击“监听腾讯会议”，选择整个屏幕并共享系统音频。
5. 其他成员发言后，本地模型在停顿处或最长 8 秒处处理一段音频，显示真实转写。识别速度取决于电脑，base 模型的中文准确率需要现场评估。
6. 说“请太医发言”或点击专家按钮，文字和检索资料发送到 Next 平台；专家回答用本地语音播放。

Windows TTS 没有安装中文语音时需先添加对应 Windows 语音包。local:check 只生成测试文件，不向腾讯会议发言。

这是本地分段转写，不是 OpenAI Realtime 模型。专家处理、发言期间暂停传送会议音频。当前未实现多说话人识别。

参考：[Next 接入说明](https://credits.openai-next.com/guide/quickstart)、[whisper.cpp 模型说明](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)。
