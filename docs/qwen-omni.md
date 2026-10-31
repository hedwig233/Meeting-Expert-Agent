# 使用 Next 上的 qwen3-omni-flash 转写

当前项目使用 ASR_PROVIDER=next_omni、NEXT_ASR_MODEL=qwen3-omni-flash，经 Next 平台做分段云转写。更换账号或平台地址时应先验证音频输入及流式文本输出。

~~~powershell
npm.cmd run qwen:check
~~~

测试只发送已有的原创合成录音，打印参考文字、识别结果与耗时。不上传现场会议，不向腾讯会议发言。需要 NEXT_API_KEY 和 NEXT_BASE_URL=https://api.openai-next.com/v1。

已有 Qwen 转写配置保持原样。新环境验证支持并确认识别效果后，再设置 ASR_PROVIDER=next_omni、NEXT_ASR_MODEL=qwen3-omni-flash 并重启服务。专家语音由独立的 SPEECH_PROVIDER / NEXT_SPEECH_MODEL / NEXT_SPEECH_VOICE 控制，见 [Qwen 语音说明](qwen-omni-speech.md)。

实现按停顿或最长 12 秒收集一段音频，通过 input_audio 发送 WAV Base64，设置 modalities 为 text、stream 为 true，读取文本增量与完成事件。它是 HTTP 分段云转写，不是专用 ASR 的持久实时连接。原音频会发送到 Next 平台。

队列达到 3 个待处理片段时暂缓发送新音频，减少到 1 个后自动恢复；不会关闭屏幕音频采集或要求重新点击监听。控制台显示等待片段数、是否处理以及积压期间未转写的系统音频时长。暂停期间的新音频不缓存、不补转写，参会者应等恢复后重说；这项改动解决监听停止的问题，不能消除模型本身的延迟。

单个片段未听清、请求失败或超过 60 秒时跳过该片段，清除临时文本并继续处理后续片段；失败文字不会加入专家上下文。停止监听或邀请专家时会等待整个已有队列处理，云转写同步等待上限为 5 分钟。

通用音频理解模型仍可能漏字、改写或推测，尤其是噪声或多人重叠。测试接口成功不代表识别精度满足会议要求。专用 Qwen ASR 需对应百炼服务权限。

参考：[Qwen Omni 原厂文档](https://help.aliyun.com/zh/model-studio/qwen-omni)、[Next 接入说明](https://credits.openai-next.com/guide/quickstart)。
