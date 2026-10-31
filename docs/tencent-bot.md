# 腾讯会议专家 Bot 接入

目标：专家以可见参会成员身份进入真实腾讯会议，接收会议现场内容，结合企业知识回答，并让其他参会者在腾讯会议中听到回答。网页作为控制台与证据展示界面，不代替会议本身。

## 官方接入与当前已验证的边界

腾讯官方提供 TencentMeetingSDK，覆盖 Windows、Mac、Electron 等平台。官方入门要求通过售后获取 SDK 包，并按 SDK 鉴权与登录文档配置账号。

- SDK 的 joinMeeting 支持入会，leaveMeeting 支持离会。
- 公开接口文档的 onAudioStatusChanged 是音频状态回调，不能仅凭这个名称认为已经提供原始 PCM 数据。
- 实时转写有专门的服务端 API，开启/关闭接口需要主持人角色和相应鉴权；管理转写的 API 本身不等于独立 Bot 入会能力。
- 原始音频接收、音频注入、Bot 账号授权、主持人准入和可用转写推送，需要结合实际 SDK 包与企业权限验证。

未获取 SDK 包和开发资源前，不将“已编写适配器”标为腾讯会议 Bot 已接通。

## 现场桌面 Bot 路径

可用独立腾讯会议账号作为专家参会成员，通过本地桥接程序连接现有 Agent。需要验证本机音频路由与可用设备。

1. 独立账号以“太医专家 Agent”身份加入主持人授权的演示会议。
2. 从会议客户端的播放音频取得输入，并传给真实语音识别。
3. 逐步形成当前会议上下文；按钮或呼叫词触发专家。
4. 专家检索剧情演示知识资料，给出观点、出处与追问。
5. TTS 输出送至腾讯会议选定的虚拟麦克风，参会者能在会议里听到专家。
6. 回答时暂停输入或隔离音频路由，防止专家把自己的声音反复送入识别。

桌面路径中的登录、入会和音频设备选择可能需要人工操作；不描述为已完成官方自动入会。没有真实 ASR/TTS、输入路由和会议发言回传时，不算完成 Bot 验证。

## 验收

- 另一台设备的参会者在腾讯会议成员列表中看到专家身份。
- 参会者说一句没有写在演示脚本里的话，控制台收到对应的真实转写。
- 专家回答从腾讯会议中被远端参会者听到。
- 专家不会获得尚未播放的剧本或预设事件真相。
- 退出会议后不再采集或发言。

## 官方资料

- [TencentMeetingSDK 官方仓库](https://github.com/Tencent-Meeting/TencentMeetingSDK)
- [SDK 鉴权与登录说明](https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Common/SDK%E9%89%B4%E6%9D%83%E4%B8%8E%E7%99%BB%E5%BD%95%E8%AF%B4%E6%98%8E.md)
- [SDK 接口参考](https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Common/TencentMeetingSDK%EF%BC%88TMSDK%EF%BC%89%E6%8E%A5%E5%8F%A3%E5%8F%82%E8%80%83%E6%96%87%E6%A1%A3.md)
- [实时转写能力](https://cloud.tencent.com/document/product/1095/113427)
- [开启或关闭实时转写](https://cloud.tencent.com/document/product/1095/106034)
