# 使用截图中的 SDK 授权参数

Product ID、Product Key、Product Secret 是设备授权配置，不能把 Product Key 填入 DUI_API_KEY 冒充云对云凭证。

已新增设备激活和 Device Profile WebSocket 鉴权支持，不需要为了这一条协议路径先下载原生 SDK。

1. 在本地 .env 中填写 DUI_PRODUCT_ID、DUI_PRODUCT_KEY、DUI_PRODUCT_SECRET。
2. 产品版本发布到测试分支，DUI_BRANCH 填实际分支号。
3. 执行 npm.cmd run dui:activate。这会创建并绑定一个设备，成功后占用一个设备激活名额。
4. 设备返回的 deviceName、deviceSecret 保存到 data/dui-device.json。已有凭证时，脚本保留它，不自动重新注册或轮换。
5. 重启应用，后端使用设备凭证签名连接 DUI WebSocket。

激活不是开启完整会议 Bot：桌面音频桥接和真实语音请求仍需联调。截图中的“免费赠送 10 个设备激活名额”不说明 ASR/TTS 调用时长、并发或其他服务免费。

同时支持 DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL。DeepSeek 作为文本专家推理服务，不提供本程序需要的实时语音转写。

官方参考：[设备激活接口](https://www.duiopen.com/docs/ct_device_activeAPI)、[WebSocket 鉴权](https://www.duiopen.com/docs/websocket)。
