# PaperBrain Console

**简体中文** | [English](README_EN.md)

PaperBrain Console 是外部
[PaperBrain Python 流水线](https://github.com/DannyWANGD/PaperBrain)
的 Obsidian 桌面控制台。它可以启动和停止任务、显示阶段和错误，并打开写入当前
vault 的论文摘要、研究简报、笔记、PDF 和音频。

插件的 JavaScript 前端与 Python 后端保持分离，但控制台内置了受控的一键后端安装器。
由于插件需要启动本地子进程并访问 Obsidian 移动端沙盒以外的文件，因此仅支持
Obsidian 桌面版。

本仓库的 MIT License 只覆盖插件代码。外部后端、论文、模型服务以及生成或下载的内容
仍受各自的许可证和服务条款约束。

## 快速开始

1. 在 BRAT 中选择 **Add beta plugin**，输入
   `https://github.com/DannyWANGD/obsidian-paperbrain`。
2. 启用 **PaperBrain Console**，打开控制台并选择 **Install backend**。
3. 查看安装器列出的本地和网络变更，再在确认窗口中选择 **Install backend**。
   插件优先复用现有 Conda；没有可用 Conda 时才安装私有且经过校验的 Miniforge。
4. 选择 **Open API key file**，填写所选供应商的 API Key 并保存。
5. 选择 **Validate setup**，再选择运行模式并点击 **Run**。

正常桌面使用不需要终端命令、不需要克隆 Python 仓库，也不需要预先安装 Python 或
Conda。PaperBrain 不依赖其他 Obsidian 插件；后文列出的配套插件全部可选。

## 系统要求

- Obsidian 桌面版 1.5.0 或更高版本
- 为托管运行时和 Python 包预留约 1 GB 磁盘空间
- 安装时能够访问 GitHub Releases、conda-forge 和 PyPI
- 所选 LLM 供应商的账号和 API Key

高级用户也可以自行提供兼容的 PaperBrain 0.3.x 后端与 Python 3.9 或更高版本。

## BRAT 与手动安装

插件进入 Obsidian 社区目录前，推荐通过 BRAT 安装 GitHub Release：

1. 在 Obsidian 社区插件中安装并启用 BRAT。
2. 选择 **Add beta plugin**，输入
   `https://github.com/DannyWANGD/obsidian-paperbrain`。
3. 在社区插件列表中启用 **PaperBrain Console**。

BRAT 会自动下载并放置插件运行文件，无需手动下载 Release 资产。

如需手动安装：

1. 从同一个 Release 下载 `main.js`、`manifest.json`、`styles.css`。
2. 将这三个文件放入 `<vault>/.obsidian/plugins/paperbrain/`。
3. 重载 Obsidian，并在社区插件中启用 **PaperBrain Console**。

这三个文件就是完整的 Obsidian 端运行文件。`checksums.txt` 仅用于可选的完整性校验，
不是第四个运行文件；GitHub 自动生成的 Source code 压缩包用于查看源码，不用于安装。
不要混用不同版本 Release 中的文件。

## 一键后端安装器

**Install backend** 会先检查已保存位置、当前环境、PATH、可推断位置和常见位置中的
Conda。找到可用 Conda 后会直接复用，并在其中创建或复用唯一名为 `wd` 的环境，
不会再安装 Miniforge。

只有在所有 Conda 候选均不可用时，PaperBrain 才会从 conda-forge 官方 GitHub Release
下载 Miniforge 26.3.2-2，并安装到 `~/.paperbrain/runtime/miniforge3`。这个私有安装
不会修改系统 PATH、不会初始化 shell、不会注册系统 Python，也不需要管理员权限。
支持 Windows x64、macOS x64/arm64、Linux x64/arm64；目前不自动支持 Windows arm64。

安装器随后会：

1. 创建或复用包含 Python 3.10 的 `wd` 环境。
2. 从 `backend-0.3.4` GitHub Release 下载固定版本的 PaperBrain wheel 和哈希锁定依赖。
3. 在执行或安装前，用嵌入的 SHA-256 校验所有下载资产。
4. 从 `https://pypi.org/simple` 安装锁定依赖，再以不解析额外依赖的方式安装后端 wheel。
5. 在 `~/.paperbrain/config` 创建配置并指向当前 vault；已有配置和 `.env` 内容会保留。

具体路径如下：

| 内容 | Windows | macOS / Linux |
| --- | --- | --- |
| 私有 Miniforge，仅在没有 Conda 时创建 | `%USERPROFILE%\.paperbrain\runtime\miniforge3` | `~/.paperbrain/runtime/miniforge3` |
| 托管 `wd` 环境 | `%USERPROFILE%\.paperbrain\runtime\miniforge3\envs\wd` | `~/.paperbrain/runtime/miniforge3/envs/wd` |
| PaperBrain CLI | `...\envs\wd\Scripts\paperbrain.exe` | `.../envs/wd/bin/paperbrain` |
| 配置与 API Key 文件 | `%USERPROFILE%\.paperbrain\config` | `~/.paperbrain/config` |

如果复用外部 Conda，`wd` 的实际位置由该 Conda 决定；安装完成后插件会记录 Python 和
CLI 的绝对路径。Python 后端 wheel 安装在 `wd` 环境内，生成的研究内容写入当前
Obsidian vault，而不是写入托管运行时目录。

任何下载或环境变更前都会出现确认窗口。安装进度和错误保留在控制台中，失败后临时
下载会被删除。插件不会在 Obsidian 设置中索取、读取或保存 API Key。

如需移除 PaperBrain 托管安装，请先关闭 Obsidian，再删除
`~/.paperbrain/runtime/miniforge3`；如不再需要，也可删除
`~/.paperbrain/config`。不要删除 PaperBrain 仅复用的外部 Conda 安装。

## 配置 PaperBrain Console

打开 **Settings -> Community plugins -> PaperBrain Console**。首次使用可选择
**Install or repair**，完成后选择 **Validate setup**。检测只检查保存的后端目录、
当前 vault、当前与常见 Conda 位置，以及 `conda env list --json` 返回的 `wd`；
不会扫描整块磁盘，也不会保存 API Key。只有在用户明确确认后才会安装包。

- **Backend directory** 仅供高级 Python-script 模式使用，必须是包含
  `script/paperbrain.py` 的源码目录；一键托管安装使用 `paperbrain` CLI，不需要源码仓库。
- **wd Python** 是 `wd` Conda 环境中的 Python 绝对路径。
- **Default provider** 控制新任务默认选择的模型供应商。
- **Advanced** 包含 CLI 模式、配置与 vault 覆盖、Podcast 默认值和取消超时。

**Validate setup** 会依次运行 `doctor config`、`doctor env`、`doctor llm`，且不会添加
`--live`，因此验证过程不会发出模型请求或产生模型费用。

可使用侧栏的 brain-circuit 图标或 **Open console** 命令打开控制台。选择预设和日期后
运行流水线，并在同一视图中检查时间线和产物。**Validate configuration** 命令检查本地
路径，`paperbrain doctor` 执行更深入的后端检查。

## 可选配套插件

PaperBrain Console 不依赖下列任何插件。此表来自 PaperBrain 开发 vault 的实际本地快照：
10 个插件当前启用并与 Console 0.4.0 一起检查，另外 2 个已安装但当前未启用。
版本是兼容性记录，不是强制锁定版本；“已安装”不代表已验证联用效果。

| 插件 | 本地版本 | 当前状态 | 推荐用途 |
| --- | ---: | --- | --- |
| BRAT (`obsidian42-brat`) | 2.0.2 | 已启用、已检查 | 从 GitHub Release 安装和更新 PaperBrain beta |
| Dataview (`dataview`) | 0.5.68 | 已启用、已检查 | 查询笔记属性并构建研究队列 |
| Audio Player (`obsidian-audio-player`) | 0.1.1 | 已启用、已检查 | 使用更完整的控件播放生成的 Podcast 音频 |
| floating toc (`floating-toc`) | 2.7.1 | 已启用、已检查 | 导航较长的研究简报和深度分析笔记 |
| Highlightr (`highlightr-plugin`) | 1.2.2 | 已启用、已检查 | 手工标记证据和复核重点 |
| Style Settings (`obsidian-style-settings`) | 1.0.9 | 已启用、已检查 | 调整当前 Obsidian 主题 |
| Immersive Translate (`immersive-translate`) | 0.0.2 | 已启用、已检查 | 翻译生成的研究笔记 |
| Smart Connections (`smart-connections`) | 4.1.8 | 已启用、已检查 | 探索生成笔记之间的语义关系 |
| Copilot (`copilot`) | 3.2.3 | 已启用、已检查 | 围绕笔记继续提问 |
| Claudian (`realclaudian`) | 2.0.24 | 已启用、已检查 | 在 vault 中运行高级编码代理工作流 |
| Translay Translator (`aqu-translay-translator`) | 0.8.4 | 已安装、当前未启用 | 通过浮动层翻译笔记与界面文本 |
| Components (`components`) | 3.1.260325 | 已安装、当前未启用 | 构建可复用的 Obsidian 内容组件 |

详细的隐私、费用、权限和布局注意事项见
[Obsidian 配套插件说明](docs/COMPANION_PLUGINS.md)。PaperBrain 不调用这些插件的 API，
也不会打包或重新分发它们的代码。请从 Obsidian 社区插件或各自官方发布渠道单独安装。

## 数据、网络与费用说明

PaperBrain Console 本身不提供遥测、广告或付费功能，只在 Obsidian 中保存本地运行设置，
不保存 API Key。

在用户主动执行操作后，插件可以：

- 经明确确认后下载固定的 Miniforge 和 PaperBrain Release 资产、校验哈希，在没有 Conda
  时静默安装 Miniforge、创建 `wd` 并从 PyPI 安装锁定包；
- 启动配置的本地可执行文件并传入 PaperBrain CLI 参数；
- 读取配置 vault 中的运行记录和生成产物；
- 读取配置的后端与配置路径以完成验证；
- 请求取消，并在插件卸载时终止由插件启动的子进程；
- 仅在用户明确要求时将脱敏诊断复制到系统剪贴板。路径和常见凭据模式会尽力遮盖，
  分享前仍应人工检查；
- 在用户选择 Web 操作时，用浏览器打开论文链接。

外部后端会访问 arXiv、Hugging Face 等论文来源以及用户配置的 LLM 供应商。根据运行
模式，论文元数据、PDF 提取文本或渲染页面可能发送给供应商，并可能产生费用。处理机密
或受许可限制的材料前，请检查后端配置以及供应商的隐私和数据保留条款。

后端会向配置的 vault 写入摘要、笔记、PDF、资源、索引、缓存和运行记录。请备份重要
vault，并先使用非关键数据测试新版本。

为降低 SSRF 风险，后端针对不受信任资源和 PDF URL 的请求使用 DNS 固定直连，不采用
环境 HTTP 代理。论文来源和 LLM API 客户端的网络行为独立。必须使用出站代理的网络可能
需要额外设计可信出口，资源链接和 PDF 验证才能正常工作。

## 兼容性

| 插件版本 | PaperBrain 后端 | Obsidian |
| --- | --- | --- |
| 0.4.x | 0.3.1 至小于 0.4.0；安装器固定选择 0.3.4 | 1.5.0 或更高，桌面版 |
| 0.3.x | 0.3.1 至小于 0.4.0 | 1.5.0 或更高，桌面版 |
| 0.2.x | 0.3.1 至小于 0.4.0 | 1.5.0 或更高，桌面版 |

新的后端或插件次版本可能改变命令或结果协议，请让两端保持在同一条已测试兼容范围内。

## 故障排查

- 安装失败时保持控制台打开，然后重试 **Install backend**。重试前会清理不完整的托管
  Miniforge 和临时下载。
- 公司网络需要允许访问 GitHub Releases、conda-forge 软件源和
  `https://pypi.org/simple`；校验失败不会被绕过。
- 如果验证无法解析 `paperbrain`，请将 CLI executable 设置为绝对路径。图形应用获取的
  `PATH` 可能与终端不同。
- Python-script 模式失败时，检查 Python 路径，并确认后端目录包含
  `script/paperbrain.py`。
- 找不到运行记录时，确认插件的 **Vault path** 与后端实际 vault 路径一致，然后重新验证。
- 命令退出但没有有效 JSON 时，可在终端运行同一命令并检查 stderr 与 `Run_Records` 错误文件。
- 非零退出码或包含 `ok: false` 的后端结果都视为失败，插件不会把降级产物报告为成功。

## 开发与发布

```bash
npm ci
npm test
npm run check
```

源码位于 `src/`。生产构建生成 `main.js`；生成的 bundle 不进入源码提交，而是在
GitHub Release 中发布。Release 标签必须与 `manifest.json` 完全一致，并包含同一次成功
构建生成的 `main.js`、`manifest.json` 和 `styles.css`。

项目政策见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和
[CHANGELOG.md](CHANGELOG.md)。
