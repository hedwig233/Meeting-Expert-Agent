# OpenAI 专家推理配置

根据 OpenAI Docs 使用 Responses API，支持公司资料函数检索与结构化评审。默认模型为 gpt-5.6-terra，推理强度为 none；可按账号可用模型调整。

在本机 .env 配置 LLM_PROVIDER=openai，填写 OPENAI_API_KEY，重启应用。其他配置：OPENAI_BASE_URL=https://api.openai.com/v1、OPENAI_MODEL=gpt-5.6-terra、OPENAI_REASONING_EFFORT=none。

显式选择 openai 后，缺少 OpenAI Key 会进入已标注的本地演示，不会转用现有 DeepSeek Key。账号凭证不会通过配置接口返回前端，也不会打印到日志。

调用使用当前会议快照、公司资料检索、最近专家交流；Responses 请求设置 store=false 并在本地维护上下文。调用仍会发送这些内容到 OpenAI，store=false 不是不传输或对所有服务端保留策略的保证。

当前没有拿到真实 Key，测试使用模拟服务响应，不代表已完成账号联调。思必驰继续负责语音识别；腾讯会议音频桥接与语音回传仍需要实现、验证。

参考：[OpenAI 函数调用](https://developers.openai.com/api/docs/guides/function-calling)、[模型说明](https://developers.openai.com/api/docs/models/gpt-5.6-terra)。
