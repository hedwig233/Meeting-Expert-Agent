# 中文识别质量改进

已经验证：base 模型在一段清晰的原创合成录音里仍把“重试”识别为“重视”，平均 token 概率较高。因此概率过滤不能保证语义正确，不能把高置信度当作准确率。

本次调整：前置音频保留 0.5 秒、停顿等待 1 秒、最长片段 12 秒；加入当前专家领域术语和用户设置的口令作为识别提示；短噪声与低置信度文字不进入专家上下文。口令判断兼容“請太醫發言”，但不会把无关乱码强行改成口令。

建议先升级多语言 small：

~~~powershell
npm.cmd run whisper:setup -- --model small
npm.cmd run whisper:quality
npm.cmd start
~~~

small 约 466 MiB，比 base 需要更多 CPU 时间。已有 base 会保留，下载支持断点续传。服务重启后顶部应显示 Whisper small。测试脚本只检查固定合成录音，仍需用真实腾讯会议音频评估。

如背景噪声较多，可另外启用本地 Silero VAD：

~~~powershell
npm.cmd run whisper:vad
~~~

完成后重启应用，程序会自动使用检测模型。它用于筛除非语音，不能修复模型听错的词。
