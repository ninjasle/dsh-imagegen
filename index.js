/**
 * dsh-imagegen —— 给 DeepSeek Harness 接上「文生图」能力。
 *
 * 为什么要有这个插件：LLM provider（llm-pi-ai）只串「文本进、文本出」的 chat 路由，
 * 图像模型（qwen-image-*）不是 chat 模型，配进 provider 会 404
 * `Unsupported model 'qwen-image-3.0' for OpenAI compatibility mode`（OpenAI images
 * 端点在兼容模式下也不开放），或者 400 `The product is not activated`。
 * 文生图要走 DashScope 原生 multimodal-generation 端点，所以以「工具」形式暴露。
 *
 * 暴露的工具：
 *   generate_image   文生图 / 参考图改图；同步返回 OSS URL，下载落盘 + 存成附件，
 *                    结果直接以图片块回给模型与前端（对话里能看到图）
 *   imagegen_models  可用模型、输出目录、密钥来源（不泄露密钥）
 *   imagegen_config  读当前配置 + 设置版本号（改配置前先读，拿 revision）
 *   imagegen_set_config  改接口地址/模型名/API Key/协议/输出目录/超时，立即生效；
 *                    API Key 走 credentials 服务，不进配置文件明文
 *
 * 人工编辑入口（图形界面）：lib/client.js 是浏览器侧的一半，注册到设置页的
 * Plugins 面板（槽位 plugins.item），卡片里能改 接口地址 / 模型名 / 超时 / API Key。
 * 两者改同一份配置：宿主侧走 SettingsForms 的 volatile 字段，密钥走 credentials。
 *
 * 依赖解析：本包在 profile 目录下，@deepseek-ai/dsh-tools 可能在 runtime 树里，
 * 不一定与本包同树，所以按候选基准目录逐个试（require 失败再动态 import）。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-imagegen'
/**
 * `tools` 是必需的：没有它就不注册工具。
 * `settings` 是可选的服务（见 apply 里的 ctx.inject），只用来把本 entry 标记成
 * 「自己带设置页」，所以不放进这里——否则缺 settings 的部署会连工具都不注册。
 */
export const inject = ['tools']

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com'
const DASHSCOPE_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const DEFAULT_MODEL = 'qwen-image-3.0'
const TOOLS_MODULE = '@deepseek-ai/dsh-tools'

/** 已知可用的 DashScope 文生图模型；未登记但服务端支持的 id 也允许（目录仅作提示）。 */
const KNOWN_MODELS = {
  'qwen-image-3.0': '千问-Image 3.0（默认，速度与质量均衡）',
  'qwen-image-3.0-pro': '千问-Image 3.0 Pro（细节与画面文字最强）',
  'qwen-image-2.1-pro': '千问-Image 2.1 Pro',
  'qwen-image-2.0-pro': '千问-Image 2.0 Pro',
  'qwen-image-2.0': '千问-Image 2.0',
}

const EXT_BY_MEDIA = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }
const SIZE_RE = /^\d{2,5}[*x]\d{2,5}$/

/**
 * Cordis 读取的配置 schema。⚠️ 这里必须是真正的 schemastery schema（带 `~standard.validate`）：
 * 写成普通对象会让 cordis 的 resolveConfig 报 `Cannot read properties of undefined (reading 'validate')`
 * 而整条 entry 不激活。schemastery 是本包的 dependencies，装包时由 pnpm 解析到 profile 的 node_modules。
 *
 * `.volatile()` 是「编辑入口」的关键：只有标了 volatile 的字段才会被
 * @deepseek-ai/dsh-settings 投影成可编辑表单项，也只有它们能通过 settings.write()
 * （否则报 `Plugin entry "…" has no volatile fields`）。代价是 cordis 解析后，这些字段的值
 * 不再是裸值，而是 cosmokit 的 Volatile 引用（`{ get() }`），所以本文件一律用 cfg() 取值。
 *
 * `.role('secret')` 让 apiKey 成为只写字段：describe() 会把它从值里剔掉，只回一份
 * 「哪位字段已设置」的标记，密钥字面量永远不出宿主进程。
 */
export const Config = z.object({
  provider: z.union(['dashscope', 'openai']).default('dashscope').volatile(),
  baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
  model: z.string().default(DEFAULT_MODEL).volatile(),
  apiKey: z.string().default('').role('secret').volatile(),
  apiKeyEnv: z.string().default('DASHSCOPE_API_KEY').volatile(),
  credentialsKey: z.string().default('MULTIMODAL_GENERATION_API_KEY').volatile(),
  credentialsFile: z.string().default(''),
  outputDir: z.string().default('').volatile(),
  timeoutMs: z.number().default(180000).volatile(),
})

/**
 * 读一个配置字段的裸值。volatile 字段经 cordis 解析后是 `{ get() }` 引用，
 * 普通字段还是裸值；两种都接受，这样同一份代码在「插件被 loader 装载」和
 * 「直接以普通对象调用 apply() 做测试」两种情形下行为一致。
 * @param {unknown} value 配置值或 Volatile 引用
 * @returns {any} 裸值
 */
function unwrap(value) {
  if (value && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/**
 * 把整份配置摊平成裸值。每次调用现取，所以设置页改了字段后下一次工具调用
 * 立刻生效，不需要重启或重新装载插件。
 * @param {object} config cordis 传入的（可能含 Volatile 引用的）配置
 * @returns {object} 全裸值的配置
 */
function cfg(config) {
  const plain = {}
  for (const key of Object.keys(config || {})) plain[key] = unwrap(config[key])
  return plain
}

function log(message) {
  try {
    process.stderr.write('[dsh-imagegen] ' + message + '\n')
  } catch {
    /* 无控制台时放弃报告 */
  }
}

/** 从本包位置、cwd、入口脚本目录、execPath 目录逐级找 dsh-tools。 */
function toolModuleBases() {
  const bases = new Set([process.cwd()])
  try {
    bases.add(dirname(fileURLToPath(import.meta.url)))
  } catch {
    /* 非 file: 入口时跳过 */
  }
  if (process.argv && process.argv[1]) bases.add(dirname(process.argv[1]))
  // runtime 树：<root>/node_modules/@deepseek-ai/dsh 或任意 @deepseek-ai 包
  bases.add(join(process.cwd(), 'node_modules'))
  // 打包安装的部署可用环境变量指到 runtime 根（标准安装走 argv[1] 祖先即可）
  if (process.env.DSH_RUNTIME_ROOT) bases.add(process.env.DSH_RUNTIME_ROOT)
  if (process.execPath) bases.add(dirname(process.execPath))
  return [...bases].filter((p) => typeof p === 'string' && p.length > 0)
}

async function acquireToolsModule() {
  const notes = []
  for (const base of toolModuleBases()) {
    let resolved
    try {
      const { createRequire } = await import('node:module')
      resolved = createRequire(join(base, 'noop.js')).resolve(TOOLS_MODULE)
    } catch {
      // 裸路径兜底：直接探 runtime 的 node_modules
      const direct = join(base, 'node_modules', TOOLS_MODULE, 'lib', 'index.js')
      resolved = existsSync(direct) ? direct : null
    }
    if (!resolved) continue
    try {
      const mod = await import(pathToFileURL(resolved).href)
      if (typeof mod.defineTool === 'function') return { mod, note: 'via ' + resolved }
      notes.push(resolved + ': no defineTool')
    } catch (error) {
      notes.push(resolved + ': ' + ((error && error.message) || error))
    }
  }
  throw new Error(TOOLS_MODULE + ' 不可用：' + (notes.join('; ') || '所有候选目录都没找到'))
}

/** 从 DSH 凭据 YAML 里读一条 ref（只支持本机用到的 `KEY: value` 形态）。 */
function readCredential(file, keyName) {
  if (!file || !existsSync(file)) return ''
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  const escaped = keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = new RegExp('^\\s*' + escaped + '\\s*:\\s*(\\S+)\\s*$', 'm').exec(text)
  return hit ? hit[1].replace(/^['"]|['"]$/g, '') : ''
}

/**
 * 本插件认的凭据引用名，按优先级排列。
 *
 * `apiKeyEnv` 是主引用（也是设置页里用户填 key 时写进去的名字）；
 * `credentialsKey` 是历史兼容名——早先的版本直接扫 .credentials.yaml 的
 * MULTIMODAL_GENERATION_API_KEY。两个都试，用户的旧文件照样能用。
 * @param {object} plain 摊平后的配置
 * @returns {string[]} 去重后的引用名
 */
function credentialRefs(plain) {
  const names = [plain.apiKeyEnv || 'DASHSCOPE_API_KEY', plain.credentialsKey || 'MULTIMODAL_GENERATION_API_KEY']
  return [...new Set(names.map((item) => String(item || '').trim()).filter(Boolean))]
}

/** 该引用名是否是合法的 POSIX 环境变量名（credentials 服务只收这种）。 */
function isRefName(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

/**
 * 密钥解析：工具参数 > 插件配置 apiKey > 环境变量 > credentials 服务 > 凭据文件。
 *
 * credentials 服务（@deepseek-ai/dsh-credentials）是「设置页填的 key」的落点：
 * 它把值写进 provider 管理的库，并且每次调用现取，所以改完 key 下一次生成就生效。
 * 服务不可用的部署里退回到直接扫 .credentials.yaml。
 * @param {object} ctx 插件上下文，用来取可选的 credentials 服务
 * @param {object} plain 摊平后的配置
 * @param {string} [explicit] 本次调用显式传入的 key
 * @returns {Promise<{key: string, source: string}>} 密钥与来源（来源只用于提示，不含值）
 */
async function resolveKey(ctx, plain, explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return { key: explicit.trim(), source: '本次调用参数' }
  if (plain.apiKey) return { key: plain.apiKey, source: '插件配置 apiKey 字段' }
  const refs = credentialRefs(plain)
  const fromEnv = (process.env[refs[0]] || '').trim()
  if (fromEnv) return { key: fromEnv, source: '环境变量 ' + refs[0] }

  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  if (credentials && typeof credentials.resolve === 'function') {
    for (const ref of refs) {
      if (!isRefName(ref)) continue
      try {
        const hit = await credentials.resolve(ref)
        const value = hit && (typeof hit.value === 'string' ? hit.value : hit.key)
        if (value && String(value).trim()) return { key: String(value).trim(), source: '凭据 ' + ref }
      } catch (error) {
        log('读取凭据 ' + ref + ' 失败：' + ((error && error.message) || error))
      }
    }
  }

  const files = []
  if (plain.credentialsFile) files.push(plain.credentialsFile)
  files.push(join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml'))
  for (const file of files) {
    for (const ref of refs) {
      const value = readCredential(file, ref)
      if (value) return { key: value, source: '凭据文件 ' + file + ' (' + ref + ')' }
    }
  }
  return { key: '', source: '' }
}

function defaultOutputDir(config) {
  if (config.outputDir) return resolve(config.outputDir)
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'imagegen')
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

/** DashScope 用 `1024*1024`；OpenAI 用 `1024x1024`。 */
function normalizeSize(raw, provider) {
  const size = String(raw || '').trim()
  if (!size) return provider === 'openai' ? '1024x1024' : '1024*1024'
  if (!SIZE_RE.test(size)) throw new Error('size 格式应为 宽*高（如 1024*1024），收到: ' + size)
  return size.replace('x', '*')
}

/** DashScope multimodal-generation：同步返回，无需轮询任务。 */
async function dashscopeGenerate(config, key, opts, signal) {
  const content = [{ text: opts.prompt }]
  for (const url of opts.refImages) content.push({ image: url })
  const parameters = {
    size: opts.size,
    n: opts.n,
    watermark: opts.watermark === true,
    prompt_extend: opts.promptExtend !== false,
  }
  if (opts.negative) parameters.negative_prompt = opts.negative
  const response = await fetch(config.baseURL.replace(/\/+$/, '') + DASHSCOPE_PATH, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, input: { messages: [{ role: 'user', content }] }, parameters }),
    signal,
  })
  const body = await response.text()
  if (!response.ok) throw new Error('DashScope HTTP ' + response.status + ': ' + body.slice(0, 600))
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('DashScope 返回非 JSON: ' + body.slice(0, 300))
  }
  const urls = []
  const choices = (parsed.output && parsed.output.choices) || []
  for (const choice of choices) {
    for (const part of (choice.message && choice.message.content) || []) {
      if (isHttpUrl(part.image)) urls.push(part.image)
    }
  }
  if (urls.length === 0) throw new Error('没拿到图片: ' + body.slice(0, 600))
  return { urls, usage: parsed.usage || {}, requestId: parsed.request_id || '' }
}

/** OpenAI 兼容 /images/generations（不支持参考图）。 */
async function openaiGenerate(config, key, opts, signal) {
  const response = await fetch(config.baseURL.replace(/\/+$/, '') + '/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.negative ? opts.prompt + '\n\n避免出现: ' + opts.negative : opts.prompt,
      n: opts.n,
      size: opts.size.replace('*', 'x'),
    }),
    signal,
  })
  const body = await response.text()
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + body.slice(0, 600))
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('返回非 JSON: ' + body.slice(0, 300))
  }
  const urls = []
  for (const item of Array.isArray(parsed.data) ? parsed.data : []) {
    if (isHttpUrl(item.url)) urls.push(item.url)
    else if (typeof item.b64_json === 'string') urls.push('data:image/png;base64,' + item.b64_json)
  }
  if (urls.length === 0) throw new Error('没拿到图片: ' + body.slice(0, 600))
  return { urls, usage: parsed.usage || {}, requestId: '' }
}

/** 下载 URL / 解 data: URL。DashScope 回的是带签名的 OSS 直链。 */
async function fetchBytes(url, signal) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const meta = url.slice(5, comma)
    const data = Buffer.from(url.slice(comma + 1), meta.includes('base64') ? 'base64' : 'utf8')
    return { data, mediaType: (meta.split(';')[0] || 'image/png') }
  }
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('下载图片失败 HTTP ' + response.status)
  const mediaType = (response.headers.get('content-type') || 'image/png').split(';')[0]
  return { data: Buffer.from(await response.arrayBuffer()), mediaType }
}

/** 按魔数嗅探真实格式（代理可能改写 Content-Type）。 */
/**
 * 给 Markdown / 客户端用的路径：Windows 上反斜杠在 Markdown 图片语法里不可用，
 * 统一换成正斜杠；文件系统操作仍用原始路径。
 * @param {string} target 绝对路径
 * @returns {string} 正斜杠形式
 */
function displayPath(target) {
  return String(target).replace(/\\/g, '/')
}

function sniffMediaType(bytes, fallback) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 3 && bytes.toString('latin1', 0, 3) === 'GIF') return 'image/gif'
  return fallback && String(fallback).startsWith('image/') ? fallback : 'image/png'
}

function combinedSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms)
  if (signal && AbortSignal.any) return AbortSignal.any([signal, timeout])
  return signal || timeout
}

/** 后端协议：只认 dashscope / openai，其余一律当 dashscope。 */
function providerOf(plain) {
  return plain && plain.provider === 'openai' ? 'openai' : 'dashscope'
}

/** 单次调用的超时；配错或缺失时回到 180s。 */
function timeoutMs(plain) {
  const value = Number(plain && plain.timeoutMs)
  return Number.isFinite(value) && value > 0 ? value : 180000
}

/**
 * 让本插件在设置界面里「自带一页」。
 *
 * dsh-settings 会给每个活跃 entry 生成一份表单描述；`configure({ auto: false })`
 * 表示这页由插件自己渲染、不走自动投影，同时这一步把本 entry 登记为可配置项。
 * settings 是可选服务：没装载 settings 的部署里插件其余功能照常工作。
 * @param {object} ctx 插件上下文
 */
function registerSettingsPage(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}

/**
 * 本插件加进系统提示的一段指令：生成完图片必须真的把图交到用户眼前。
 *
 * 只有工具返回值里带附件是不够的 —— 用户看到的可能只是一张工具卡片，
 * 所以这里明确要求模型在回复正文里把图片内嵌出来（必要时再补 present）。
 */
const PROMPT_GUIDANCE = [
  '**Image delivery (`generate_image`).** When you generate a picture, the user must SEE it in this conversation, not merely learn that it exists.',
  'In the reply that reports the result, embed the file as a Markdown image and say what it is:',
  '`![short description](.dsh/imagegen/name.png)` — use the path relative to the working directory when the file lies inside it, otherwise the absolute path.',
  'When the `present` tool is available, also present the same file so it appears as a card.',
  'Never answer with only a path, only a URL, or only a promise that the image exists — a picture the user cannot see was not delivered.',
  'If the user says they cannot see it, send it again (inline image plus `present`) instead of describing it in words.',
].join(' ')

/**
 * 把上面的投递指令注册成一条系统提示 section。
 *
 * systemPrompt 是可选服务：没有装配它的部署里插件照常工作。
 * 顺序取 3001，紧跟在官方工具段之后、MCP 段之前。
 * @param {object} ctx 插件上下文
 */
function registerPromptGuidance(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], (child) => {
    child.effect(() =>
      child.systemPrompt.section({
        name: 'plugin:dsh-imagegen',
        order: 3001,
        text: PROMPT_GUIDANCE,
      }),
    )
  })
}

/**
 * 把设置界面里的一处改动写回本 entry 的 profile patch。
 *
 * 走的是 dsh-settings 的 mutate：它按 revision 做并发校验，并且不会把
 * 被脱敏的字段（apiKey）重新带一遍，所以改 baseURL / model 不会误清密钥。
 * @param {object} ctx 插件上下文
 * @param {Array<object>} ops `{ op: 'set'|'unset', path: string[], value?: unknown }` 序列
 * @param {number} [expectedRevision] 调用方读到的 revision；省略则无条件写
 * @returns {Promise<object|null>} 写后的（脱敏）命名空间视图；settings 不可用时为 null
 */
async function writeConfig(ctx, ops, expectedRevision) {
  if (!ops.length) return null
  const settings = settingsService(ctx)
  if (!settings) {
    throw new Error(
      '本部署没有装载 settings 服务（@deepseek-ai/dsh-settings），无法在线改配置；' +
        '请改 profile 的 cordis.patch.yml 里本 entry 的 config。',
    )
  }
  await settings.mutate(name, ops, expectedRevision)
  return findDescriptor(settings)
}

/** settings 服务；未装载时为 undefined。 */
function settingsService(ctx) {
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  return settings && typeof settings.mutate === 'function' ? settings : undefined
}

/** credentials 服务；未装载时为 undefined。 */
function credentialsService(ctx) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  return credentials && typeof credentials.resolve === 'function' ? credentials : undefined
}

/** 从 describe() 里挑出本 entry 的那份（describe 会给所有 entry 各一份）。 */
function findDescriptor(settings) {
  if (!settings || typeof settings.describe !== 'function') return null
  let list = []
  try {
    list = settings.describe({ redactSecrets: true }) || []
  } catch (error) {
    log('读取设置描述失败：' + ((error && error.message) || error))
    return null
  }
  return list.find((item) => item && item.ns === name) || null
}

/**
 * 把一份设置描述翻译成人话，用于展示当前生效值。
 * 密钥字段在描述里根本不会出现（role('secret') 已被剥掉），
 * 所以这里只报「设置里有没有填」，值本身永不出宿主进程。
 * @param {object|null} descriptor 设置描述
 * @param {object} plain 摊平后的实时配置
 * @param {{key: string, source: string}} secret 实际解析到的密钥
 * @returns {string[]} 展示用文本行
 */
function describeLines(descriptor, plain, secret) {
  const revision = descriptor ? descriptor.revision : '未知'
  const keyNote = secret.key ? '已就绪（来源：' + secret.source + '）' : '缺失'
  return [
    'API 地址: ' + (plain.baseURL || DEFAULT_BASE_URL),
    '模型名: ' + (plain.model || DEFAULT_MODEL),
    '协议: ' + providerOf(plain),
    'API Key: ' + keyNote,
    '密钥引用名: ' + credentialRefs(plain).join(' / '),
    '输出目录: ' + defaultOutputDir(plain),
    '超时: ' + timeoutMs(plain) + ' ms',
    '设置版本(revision): ' + revision + (descriptor ? '' : '（settings 服务不可用）'),
  ]
}

export async function apply(ctx, config) {
  if (!config) config = {}
  /** 每次工具调用都重新摊平：设置页写入后立即生效，无需重启。 */
  const current = () => cfg(config)
  registerSettingsPage(ctx)
  registerPromptGuidance(ctx)
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    log('宿主未提供 tools 服务，工具未注册')
    return
  }
  let defineTool
  try {
    const acquired = await acquireToolsModule()
    defineTool = acquired.mod.defineTool
  } catch (error) {
    log('加载 ' + TOOLS_MODULE + ' 失败，工具未注册：' + ((error && error.message) || error))
    return
  }


  ctx.tools.register(
    defineTool({
      name: 'generate_image',
      description:
        '用图片模型画图（文生图 / 参考图改图），生成结果会落盘并在对话里直接显示成图片。' +
        'prompt 用具体画面语言：主体、动作、构图、风格、光线、配色；画面里要出现文字时把文字用引号写清楚。' +
        'refImages 传 http(s) 图片地址可以基于参考图改写（仅 dashscope 后端）。一次可以出多张（n）挑最满意的再给用户。',
      parameters: {
        prompt: { type: 'string', required: true, description: '画面描述（中文或英文，越具体越好）' },
        model: { type: 'string', description: '模型 id，默认取设置里的模型名（出厂 ' + DEFAULT_MODEL + '）' },
        size: { type: 'string', description: '尺寸，默认 1024*1024（如 1328*1328、1024*1536）' },
        n: { type: 'integer', description: '生成张数 1-4，默认 1' },
        negative: { type: 'string', description: '不想出现的元素（可选）' },
        refImages: { type: 'array', items: { type: 'string' }, description: '参考图 http(s) 地址，用于图生图（可选）' },
        watermark: { type: 'boolean', description: '是否加水印，默认 false' },
        promptExtend: { type: 'boolean', description: '服务端是否自动扩写提示词，默认 true；要精确控制画面时设 false' },
        name: { type: 'string', description: '文件名前缀（可选，默认 image）' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => {
          const blocks = [{ type: 'text', text: value.message }]
          for (const ref of value.images || []) {
            if (ref && ref.attachment) blocks.push({ type: 'image', attachment: ref.attachment })
          }
          return blocks
        },
      },
      async execute(args, exec) {
        const options = current()
        const signal = combinedSignal(exec && exec.signal, timeoutMs(options))
        const prompt = String(args.prompt || '').trim()
        if (!prompt) throw new Error('prompt 不能为空')
        const model = String(args.model || options.model || DEFAULT_MODEL).trim()
        const n = Math.min(Math.max(Number.isInteger(args.n) ? args.n : 1, 1), 4)
        const size = normalizeSize(args.size, providerOf(options))
        const refImages = Array.isArray(args.refImages) ? args.refImages.filter(isHttpUrl).slice(0, 3) : []
        const { key, source } = await resolveKey(ctx, options, args.key)
        if (!key) {
          throw new Error(
            '没有可用的 API 密钥：在设置里填 API Key，或设置环境变量 ' + (options.apiKeyEnv || 'DASHSCOPE_API_KEY') +
              '，或配置 credentialsFile+credentialsKey。',
          )
        }
        const opts = {
          prompt,
          model,
          size,
          n,
          negative: args.negative,
          refImages,
          watermark: args.watermark,
          promptExtend: args.promptExtend,
        }
        const result =
          providerOf(options) === 'openai'
            ? await openaiGenerate(options, key, opts, signal)
            : await dashscopeGenerate(options, key, opts, signal)

        const dir = defaultOutputDir(options)
        mkdirSync(dir, { recursive: true })
        const stem = String(args.name || 'image').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'image'
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const attachmentsService = ctx.get('attachments')
        const saved = []
        for (let i = 0; i < result.urls.length; i++) {
          const raw = await fetchBytes(result.urls[i], signal)
          const mediaType = sniffMediaType(raw.data, raw.mediaType)
          const suffix = result.urls.length > 1 ? '_' + (i + 1) : ''
          const file = stem + '_' + stamp + suffix + (EXT_BY_MEDIA[mediaType] || '.png')
          const path = join(dir, file)
          writeFileSync(path, raw.data)
          let attachment
          if (attachmentsService && typeof attachmentsService.saveImage === 'function') {
            try {
              attachment = await attachmentsService.saveImage({
                data: new Uint8Array(raw.data),
                mediaType,
                name: file,
              })
            } catch (error) {
              attachment = undefined
              log('存附件失败（图已落盘）：' + ((error && error.message) || error))
            }
          }
          saved.push({ path, bytes: raw.data.byteLength, mediaType, attachment })
        }
        const shown = providerOf(options) === 'dashscope' && refImages.length > 0 ? '（参考图 ' + refImages.length + ' 张）' : ''
        return {
          message:
            '已生成 ' + saved.length + ' 张 / 模型 ' + model + ' / 尺寸 ' + size + shown + '\n' +
            saved.map((item) => '- ' + displayPath(item.path) + ' (' + Math.round(item.bytes / 1024) + ' KB)').join('\n') +
            '\n回复时把图内嵌给用户：![描述](相对或绝对路径)，必要时再用 present；只给路径等于没发。',
          provider: providerOf(options),
          model,
          size,
          keySource: source,
          requestId: result.requestId || '',
          usage: result.usage || {},
          images: saved.map((item, index) => ({
            path: item.path,
            mediaType: item.mediaType,
            bytes: item.bytes,
            source: result.urls[index],
            attachment: item.attachment,
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'imagegen_models',
      description: '查看本机可用的图片生成模型、默认输出目录和密钥来源（不泄露密钥本身）。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a, value) => [{ type: 'text', text: value.message }] },
      async execute() {
        const options = current()
        const { key, source } = await resolveKey(ctx, options, '')
        const provider = providerOf(options)
        const lines = [
          'provider: ' + provider,
          'API 地址: ' + (options.baseURL || DEFAULT_BASE_URL),
          '模型名: ' + (options.model || DEFAULT_MODEL),
          '输出目录: ' + defaultOutputDir(options),
          '密钥: ' + (key ? '已就绪（' + source + '）' : '缺失'),
          '已知模型:',
          ...Object.entries(KNOWN_MODELS).map(([id, label]) => '  - ' + id + ' — ' + label),
        ]
        return {
          message: lines.join('\n'),
          provider,
          baseURL: options.baseURL || DEFAULT_BASE_URL,
          model: options.model || DEFAULT_MODEL,
          outputDir: defaultOutputDir(options),
          keyReady: !!key,
          keySource: source,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'imagegen_config',
      description:
        '查看图片生成插件当前生效的配置：调用地址、模型名、API Key 是否就绪、输出目录、超时。' +
        '密钥只报「有没有」，不回显值。设置里改过之后这里立刻能看到新值，不需要重启。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a, value) => [{ type: 'text', text: value.message }] },
      async execute() {
        const plain = current()
        const descriptor = findDescriptor(settingsService(ctx))
        const secret = await resolveKey(ctx, plain, '')
        const lines = describeLines(descriptor, plain, secret)
        return {
          message: lines.join('\n'),
          baseURL: plain.baseURL || DEFAULT_BASE_URL,
          model: plain.model || DEFAULT_MODEL,
          provider: providerOf(plain),
          keyReady: !!secret.key,
          keySource: secret.source,
          outputDir: defaultOutputDir(plain),
          timeoutMs: timeoutMs(plain),
          keyRefs: credentialRefs(plain),
          revision: descriptor ? descriptor.revision : null,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'imagegen_set_config',
      description:
        '改图片生成插件的配置并立即生效（不用重启）：调用地址 baseURL、模型名 model、API Key、协议 provider、输出目录、超时。' +
        'API Key 走凭据库存储，不会明文写进配置文件；其它字段写进本插件的设置里，下一次 generate_image 就用新值。' +
        '只传要改的字段，其余保持不变。',
      parameters: {
        baseURL: { type: 'string', description: 'API 地址，如 https://dashscope.aliyuncs.com' },
        model: { type: 'string', description: '模型名，如 qwen-image-3.0-pro' },
        apiKey: { type: 'string', description: 'API Key（存入凭据库，不落配置文件明文）' },
        apiKeyEnv: { type: 'string', description: '凭据引用名，默认 DASHSCOPE_API_KEY；填 key 时写到这个名字下' },
        provider: { type: 'string', description: '协议：dashscope（默认）或 openai' },
        outputDir: { type: 'string', description: '图片落盘目录' },
        timeoutMs: { type: 'integer', description: '单次生成超时（毫秒）' },
        clearApiKey: { type: 'boolean', description: '删掉已存的 API Key' },
        expectedRevision: {
          type: 'integer',
          description: '并发保护：imagegen_config 读到的 revision；过期会拒绝写入并要求重读',
        },
      },
      output: { schema: { type: 'json' }, render: (_a, value) => [{ type: 'text', text: value.message }] },
      async execute(args) {
        const ops = []
        const changed = []
        const setField = (field, value) => {
          ops.push({ op: 'set', path: [field], value })
          changed.push(field + ' = ' + value)
        }
        if (typeof args.baseURL === 'string' && args.baseURL.trim()) setField('baseURL', args.baseURL.trim())
        if (typeof args.model === 'string' && args.model.trim()) setField('model', args.model.trim())
        if (typeof args.provider === 'string' && args.provider.trim()) {
          const value = args.provider.trim()
          if (value !== 'dashscope' && value !== 'openai') throw new Error('provider 只能是 dashscope 或 openai')
          setField('provider', value)
        }
        if (typeof args.outputDir === 'string' && args.outputDir.trim()) setField('outputDir', args.outputDir.trim())
        if (args.timeoutMs !== undefined && args.timeoutMs !== null) {
          const value = Number(args.timeoutMs)
          if (!Number.isFinite(value) || value <= 0) throw new Error('timeoutMs 必须是正数')
          setField('timeoutMs', Math.round(value))
        }
        if (typeof args.apiKeyEnv === 'string' && args.apiKeyEnv.trim()) {
          const value = args.apiKeyEnv.trim()
          if (!isRefName(value)) throw new Error('apiKeyEnv 必须是合法的环境变量名（字母/数字/下划线）')
          setField('apiKeyEnv', value)
        }

        let descriptor = null
        if (ops.length) descriptor = await writeConfig(ctx, ops, args.expectedRevision)

        const plainNow = current()
        const refs = credentialRefs(plainNow)
        const ref = typeof args.apiKeyEnv === 'string' && args.apiKeyEnv.trim() ? args.apiKeyEnv.trim() : refs[0]

        if (typeof args.apiKey === 'string' && args.apiKey.trim()) {
          const credentials = credentialsService(ctx)
          if (!credentials) throw new Error('本部署没有装载 credentials 服务，无法保存 API Key')
          await credentials.set(ref, args.apiKey.trim())
          changed.push('API Key 已存入凭据 ' + ref)
        } else if (args.clearApiKey === true) {
          const credentials = credentialsService(ctx)
          if (!credentials) throw new Error('本部署没有装载 credentials 服务，无法删除 API Key')
          for (const item of refs) await credentials.unset(item)
          changed.push('已删除凭据 ' + refs.join(' / '))
        }

        if (!changed.length) throw new Error('没有要改的字段：至少给一个 baseURL / model / apiKey / provider / outputDir / timeoutMs')

        const plain = current()
        const after = descriptor || findDescriptor(settingsService(ctx))
        const secret = await resolveKey(ctx, plain, '')
        return {
          message: '已更新：\n- ' + changed.join('\n- ') + '\n\n当前配置：\n' + describeLines(after, plain, secret).join('\n'),
          changed,
          baseURL: plain.baseURL || DEFAULT_BASE_URL,
          model: plain.model || DEFAULT_MODEL,
          provider: providerOf(plain),
          keyReady: !!secret.key,
          keySource: secret.source,
          outputDir: defaultOutputDir(plain),
          timeoutMs: timeoutMs(plain),
          keyRefs: credentialRefs(plain),
          revision: after ? after.revision : null,
        }
      },
    }),
  )

  log('已注册 generate_image / imagegen_models / imagegen_config / imagegen_set_config')
}
