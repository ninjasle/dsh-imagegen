# dsh-imagegen

给 [DeepSeek Harness](https://github.com/deepseek-ai) 接上**文生图**能力的插件：模型可以直接画图，图片直接显示在对话里；输入框上还会多一个按钮，点开就能改接口地址 / 模型名 / API Key。

- 默认后端 DashScope 的 Qwen-Image（`qwen-image-3.0`），也支持任何 OpenAI 兼容的 `/images/generations` 端点
- 提供 4 个 agent 工具 + 1 个输入框按钮 + 1 张「插件」设置卡片
- 配置改动**即时生效**，不用重启进程

---

## 为什么需要它

`llm-pi-ai` 这类 LLM provider 只串「文本进、文本出」的 chat 路由。`qwen-image-*` 是图像模型，不是 chat 模型，把它配成 provider 的模型只会得到：

```
404 Unsupported model `qwen-image-3.0` for OpenAI compatibility mode.
400 The product is not activated, please confirm that you have activated products ...
```

文生图要走 DashScope 原生的 `multimodal-generation` 端点，所以本插件以**工具**的形式暴露能力，而不是伪装成一个 chat 模型。

## 安装

前提：DSH ≥ 0.2，profile 里已装载 `@deepseek-ai/dsh-tools`（默认就有）与 `@deepseek-ai/dsh-settings`（Web profile 默认就有）。

在 DSH 会话里让 agent 安装，或直接调 `plugin_manager` 工具：

```
plugin_manager(action: "install_bundle", target: "github:ninjasle/dsh-imagegen")
```

也可以指向本地源码目录（绝对路径）：

```
plugin_manager(action: "install_bundle", target: "/path/to/dsh-imagegen")
```

安装成功后：

- profile 的 `package.json` 出现 `"dsh-imagegen": "github:ninjasle/dsh-imagegen"`
- `dsh.profile.bundles` 末尾出现 `dsh-imagegen`
- 重启一次 DSH Web / 桌面端（宿主插件在启动时组装，没有热更）

## 使用

### 1. 对话里直接说

「画一只戴围巾的橘猫」→ agent 调 `generate_image`，图片落盘并作为附件显示在对话里。

### 2. 输入框上的按钮

输入框左下角工具行会多一个图片按钮（在表情按钮右边）。点开是一个浮层，可以直接改：

| 字段 | 说明 |
|---|---|
| 接口地址 | 例如 `https://dashscope.aliyuncs.com`，或你自己的代理 / OpenAI 兼容端点 |
| 模型名 | 例如 `qwen-image-3.0-pro` |
| 超时 | 单次生成超时（毫秒），默认 180000 |
| API Key | 只写不回显，存进 DSH 凭据库，不写进配置文件 |

保存后立刻生效（配置字段是 volatile 引用，loader 就地更新，不重载插件）。

同一张表单也会出现在 **设置 → 插件 → 图片生成** 里。

### 3. 用工具改

| 工具 | 说明 |
|---|---|
| `generate_image` | 文生图 / 参考图改图 |
| `imagegen_models` | 当前配置、可用模型、密钥来源（不回显密钥） |
| `imagegen_config` | 读当前生效配置 |
| `imagegen_set_config` | 改接口地址 / 模型名 / 超时 / API Key |

`generate_image` 参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `prompt` | string，必填 | 画面描述。具体写主体、动作、构图、风格、光线、配色；要出现文字就用引号写清楚 |
| `model` | string | 覆盖默认模型 |
| `size` | string | DashScope 用 `1024*1024` 形式，OpenAI 用 `1024x1024`；自动转换 |
| `n` | number 1–4 | 生成张数 |
| `negative` | string | 不想出现的元素（DashScope 用负向提示词，OpenAI 拼进 prompt） |
| `refImages` | string[] 最多 3 | 参考图 http(s) 地址，图生图 / 改图 |
| `watermark` | boolean | 是否加水印 |
| `promptExtend` | boolean | 服务端是否自动扩写提示词 |
| `name` | string | 文件名前缀 |

返回：图片写入 `outputDir`，同时存进 DSH 附件服务，最终以 `text + image` 内容块渲染，所以对话里能直接看到图。

## 配置项

`cordis.patch.yml` 里的 `config`，全部可在运行时改（`credentialsFile` 除外）：

| 键 | 默认 | 说明 |
|---|---|---|
| `provider` | `dashscope` | `dashscope` 走 `multimodal-generation`；`openai` 走 `/v1/images/generations` |
| `baseURL` | `https://dashscope.aliyuncs.com` | 端点根地址 |
| `model` | `qwen-image-3.0` | 默认模型 |
| `apiKeyEnv` | `DASHSCOPE_API_KEY` | 从这个环境变量找密钥 |
| `apiKey` | 空 | 直接把密钥写配置里（不推荐，优先用凭据库） |
| `credentialsFile` | `$DSH_HOME/.credentials.yaml` | DSH 凭据文件路径 |
| `credentialsKey` | `MULTIMODAL_GENERATION_API_KEY` | 从凭据文件读哪个键 |
| `outputDir` | `$DSH_HOME/imagegen` | 图片落盘目录 |
| `timeoutMs` | `180000` | 单次生成超时 |

**密钥解析顺序**：调用参数 `key` > `config.apiKey` > 环境变量 `apiKeyEnv` > DSH 凭据服务（`apiKeyEnv` 与 `credentialsKey` 两个名字都试）> 直接扫 `credentialsFile`。

密钥不会出现在工具返回值、日志或配置文件里（`apiKey` 字段标了 `role('secret')`，跨线前被剔除）。

## 已知模型

`qwen-image-3.0`（默认）、`qwen-image-3.0-pro`、`qwen-image-2.1-pro`、`qwen-image-2.0-pro`、`qwen-image-2.0`。

列表只是提示——服务端支持但没列出的 id 也能直接传。

## 实现要点（给要改代码的人）

- **宿主侧**（`index.js`）：`defineTool` 注册工具；`Config` 是真 schemastery schema，可编辑字段标 `.volatile()`，密钥标 `.role('secret')`；每次工具调用都重新摊平配置（`cfg(config)` 解包 volatile 引用），所以改配置无需重启。
- **客户端**（`lib/client.js`）：手写的预打包 bundle（`window.__ModuleLoader__.load` 包装），往 `conversation.input.left` + `conversation.input.overlay` 注册按钮与浮层，往 `plugins.item` 注册设置卡片。表单用 `@deepseek-ai/dsh-client-ui-primitives` 的 `SettingsFormModel`，密钥走 `ctx.remote.credentials.set()`。
- **投递指令**：插件向 `ctx.systemPrompt` 注册一条 section，要求模型出图后在回复正文里内嵌图片，避免「只在磁盘上生成了，用户看不见」。

## 踩过的坑

1. **`Config` 必须是真 schemastery schema**（带 `~standard.validate`）。写成普通对象会让 cordis 的 `resolveConfig` 抛 `Cannot read properties of undefined (reading 'validate')`，整条 entry `fiberPhase: failed`，一个工具都不注册。
2. **`@deepseek-ai/schemastery` 必须写进 `dependencies`**。profile 用 `nodeLinker: hoisted` + `autoInstallPeers: false`，声明了才会进依赖树。
3. **`@deepseek-ai/dsh-tools` 只在 runtime 树里**，profile 侧解析不到，所以 `index.js` 用 `createRequire` 从多个候选目录找它，找不到再用动态 `import`。
4. **volatile 字段解析后是引用对象，不是裸值**。`z.string().volatile()` 拿到的是 `{ get() }`，读配置必须解包，否则业务代码会拿到包装对象。
5. **`.volatile()` 是方法，不是属性**。写成 `.volatile` 会退化成一个 `type: "is"` 的坏节点，类型全丢。
6. **客户端组件不能用 `jsx(Component)` 少传 props**。React 的 jsx runtime 会直接读 `config.key`，`undefined` 抛 `TypeError`，组件崩溃后被插槽监督机制静默移除（看不见、日志里也没有）。
7. **客户端 bundle 缓存是 immutable 的**。改完 `lib/client.js` 要重启服务才重新算 rev，只刷新页面不够。

## 许可证

MIT
