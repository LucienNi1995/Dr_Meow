# Dr. Meow · 猫博士

Dr. Meow 是一个支持 Windows 和 macOS 的桌面宠物。它会眨眼、打盹，接受抚摸和投喂。双击猫咪可打开聊天，使用你自己授权的 ChatGPT 套餐进行对话。

## 安装与启动

在 Windows 10 或 11（x64）上手动运行 `release/Dr-Meow-Upgrade-1.1.0-x64.exe`。也可以在本目录从源码启动。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

已安装旧版时，直接运行新版安装包即可原位升级，保留本地会话、登录状态和设置。通过 Windows 卸载 1.0.4 或更新版本时，可选择删除或保留当前 Windows 用户的 Dr. Meow 本地数据。选择「是」会删除本地登录、聊天记录、桌宠状态和设置，重新安装后需登录。选择「否」会保留这些数据。

Windows 开发构建需要 Node.js 24、pnpm 11 和系统自带的 .NET Framework 4.x 编译工具。也可使用 `npm install` 和 `npm run dev`。生产模式可用 `pnpm build` 后执行 `pnpm start`。

悬停猫咪头部可查看简洁状态，左键单击打开完整面板。饱食度、心情和亲密度以液面和数字一起显示，抚摸、喂食、玩耍、休息和聊天都可以在面板中选择。每轮成功的 AI 对话只计一次亲密度。按住身体可拖动，右键菜单提供固定位置、设置和退出。置顶可在设置中独立控制。可从 Windows 系统托盘显示或隐藏猫咪，关闭聊天只会隐藏聊天窗口。

饱食度每小时下降 5 点，单次离线最多计算 8 小时。心情每小时向 56 靠近 1 点，心情归零后通过照料恢复。亲密度长期保留。小鱼干、罐头和猫条分别补充 8、14、5 点饱食度。抚摸增加 6 点心情和 1 点亲密度，玩耍增加 10 点心情和 1 点亲密度。食物与心情增益同类间隔 30 秒，亲密度增益同类间隔 5 分钟。普通照料在动作接触点结算。

每轮成功的 AI 回复按长度消耗 1、1.5 或 2 点饱食度。本地词组判断决定心情和亲密度变化，最多检查用户消息与回复各 1,024 个字符。含引用、代码、讨论、否定或截断歧义时采用保守的普通交流结果。状态判断使用本地规则，额外模型请求和 token 消耗均为零。失败、取消和重试按同一轮次去重，回复与状态在一笔事务中保存。

聊天窗口可直接照料猫咪。任一照料状态归零时暂停新请求，保留草稿，并提供「照料并继续」补到饱食度 12、心情 12、亲密度 3 的保底值。完成 20 轮交流可出现照料轻提示。

## 全屏避让和闲置动作

前台应用全屏覆盖猫博士所在的显示器时，猫咪会暂时隐藏。退出全屏后它回到原位，手动隐藏状态优先保留。普通最大化窗口和其他显示器的全屏不会触发避让。可在「设置 → 外观」关闭这一项。

猫博士平时安静坐着，偶尔眨眼。闲置时会拨球、读魔法书、解数学题或做实验。休息时先钻进被窝，醒来时撑起身体再坐稳。四款皮肤分别制作完整姿势帧，喂食、抚摸、玩耍等动作按时间线内的有效接触帧结算。可在「设置 → 外观 → 动作预览」选择全部动作及变体、播放、重播或停止。预览与桌面用同一套素材，独立于照料与聊天。「安静模式」或系统减少动态效果设置会停用自动闲置动作。

## 连接 ChatGPT

1. 双击猫咪，选择 **Continue with ChatGPT**。
2. 在系统浏览器登录，选择账号或工作区，并同意让 Dr. Meow 使用符合条件的 ChatGPT 套餐。然后返回桌面应用。
3. 模型选择器旁显示 **Using ChatGPT plan** 后可发送问题。模型选项来自当前账号返回的可用列表。设置里的「默认模型」和聊天里的模型选择器都可以更换模型。
4. 点击 **Manage usage** 打开 [ChatGPT 用量概览](https://chatgpt.com/settings/usage?tab=overview)。悬停卡片的 Energy 闪电也通往该页。心情是独立的桌宠状态。用量数据按浏览器当前的 ChatGPT 账户显示。官方应用接口未公开实时剩余数值。若达到限制，先查看用量，再在应用里选择「恢复请求」。
5. 如果只同意了身份权限，应用会显示「已登录 · 待授权套餐」。从账号设置重新授权。登录窗口迟迟未返回时，先取消，再重试，并确认浏览器允许访问应用打开的 `127.0.0.1` 回调。登录过期时可重新连接。账号资格或工作区策略限制可通过更换合资格账号解决。

若聊天仍报错，可展开该条消息下的「请求诊断」，复制请求阶段、错误类别和可用的请求编号。诊断中只包含技术状态和编号。

桌宠功能无需登录。本项目使用官方开放源码 SIWC 流程。凭据由 Electron 主进程通过系统加密存储保护（macOS 使用钥匙串）。推理使用经授权的 ChatGPT OAuth 凭据。聊天支持 Markdown、复制、取消、重试和本地多会话。普通聊天会在问题明显需要最新信息时尝试官方联网搜索。可在输入框打开「联网搜索」明确发起查询。账号或模型不支持时，会给出提示和普通问答入口。来源卡片基于服务返回的引用，点击后用系统浏览器打开。

- [OpenAI 官方快速入门](https://developers.openai.com/siwc/quickstart)
- [开源应用授权、注册与续期](https://developers.openai.com/siwc/token-sharing-open-source)
- [官方模型列表与推理文档](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [套餐预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [官方 Electron DevKit 示例](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

认证参考了官方 Electron DevKit 的流程。当前示例中的 `@siwc/local` 是私有工作区包，使用其自带的非商业许可证。本项目按公开协议使用 Node 标准库独立实现，使用 OpenAI 官方的登录按钮图标。Electron 提供桌面窗口和安全存储，React 与 Vite 构建界面，Node 自带 SQLite 用于本地记录。界面样式由 CSS 实现，桌宠与设置共用逐帧播放器和时间线。

## 语言和皮肤

在「设置 → 外观」选择简体中文或 English，并切换四款皮肤。也可设置最多 24 个字符的猫咪名字。聊天显示、角色称呼与本地夸奖和责骂匹配会使用这个名字，原有猫博士称呼也可识别。

四款皮肤分别是奶橘猫、重点色布偶猫、蓝灰英国短毛猫和三花日本短尾猫。切换皮肤时，聊天窗口的头像、配色与细节也会一起切换。

[原始角色参考](src/pet/art) 保留于项目中。[1.0 逐帧源素材](art-source/v1) 与 [发布图集](public/pet/v1) 分开存放。[生成脚本](scripts/build_pet_frames.py) 先绘制各帧再合成 WebP 图集和接触帧清单。修改画稿后可用带 Pillow 的 Python 执行以下命令重建源帧与发布素材。

```powershell
python scripts/build_pet_frames.py --sources
```

## 本地记录与清除

聊天内容、宠物状态和偏好使用应用数据目录下的 SQLite 文件。发送时只选取当前会话所需的近期消息，Responses 请求使用 `store: false`。应用只管理自身历史。设置 → 本地数据可打开记录、清空对话、重置宠物或清除全部本地数据并尝试撤销已保存的授权。也可在「账号与 AI」单独注销。ChatGPT 侧的授权与额度可在 ChatGPT 设置里管理。

## macOS 开发与打包

需要 Node.js 24 或更新版本。在 Mac 上执行：

```sh
npm install
npm run dev
npm run pack:mac
npm run dist:mac
```

`pack:mac` 生成当前 Mac 架构的 `.app`，`dist:mac` 在 `release/` 生成 DMG 和 ZIP。Apple Silicon 使用 arm64，Intel 使用 x64；需要指定架构时可运行 `npm run dist:mac -- --arm64` 或 `--x64`。开发构建和 macOS 打包不需要 Windows .NET 工具。

拖动应用至 Applications 后启动。菜单栏图标可显示或隐藏猫咪、打开聊天和设置以及退出。Dock 图标可重新打开聊天；关闭聊天窗口会隐藏窗口。原生编辑菜单支持 Command-C、Command-V 和 Command-A。登录凭据通过 Electron safeStorage 和 macOS 钥匙串加密保存。自动登录仅适用于安装版。

macOS 全屏应用通常占用独立 Space。默认猫咪显示在普通桌面 Space，避开全屏 Space；关闭「全屏时自动避让」后允许猫咪显示在全屏 Space。macOS 不使用 Windows 的全屏探测器，也不申请屏幕录制或辅助功能权限。普通桌面的无边框全屏应用不做额外检测。

公开分发前需要 Apple Developer ID 签名和 notarization；本地打包不会自动提供这些凭据。可通过 electron-builder 的签名环境变量和 macOS 配置设置。未签名或仅 ad-hoc 签名的开发包可能被 Gatekeeper 拦截。

## Windows 打包

```powershell
pnpm dist:win
```

生成的 x64 NSIS 安装程序位于 `release/`。当前发布包未签名。可使用 `pnpm pack:win` 生成解包目录进行开发验证。

## 测试

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
```

v0.4.0 的 46 项自动化测试通过，覆盖 OAuth 回调、验签、授权与续期、账号切换、流式对话、搜索降级、请求取消、手势状态及持久化。OAuth 和推理测试使用模拟服务器响应。桌面测试启动实际 Electron 窗口，使用独立的临时数据目录。它验证窗口透明像素、命中切换、模拟手势、原生窗口位置和置顶、聊天关闭后桌宠存续，以及 SQLite 数据。

桌面测试已在 Windows 10 上通过，覆盖头部悬停卡片、右键喂食、英文切换、四款皮肤和三屏环境中的跨屏定位。真实 ChatGPT 账号登录、套餐推理和联网搜索需要用户授权。物理鼠标对其他应用的穿透、混合 DPI、系统休眠恢复和屏幕热插拔仍需人工验证。

