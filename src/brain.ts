import type { SelectOption } from './types'

/**
 * The brain: any OpenAI-compatible chat/completions endpoint, streamed.
 * A local server (LM Studio) or a cloud API
 * with a key. There is no session on the other end, so the history lives
 * here, trimmed in chunks back to half the cap rather than one message per
 * turn: an unchanged start lets the server reuse what it already read (its
 * prompt cache), a sliding window would make every turn a full re-read.
 */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface Provider { label: string, url: string, model: string, extra: Record<string, unknown> }

export const PROVIDERS: Record<string, Provider> = {
  abliteration: { label: 'abliteration.ai', url: 'https://api.abliteration.ai/v1', model: 'abliterated-model-large-flash', extra: { reasoning_effort: 'none', prompt_cache_key: 'playmate' } },
  // Venice adds its own system prompt unless told not to, and some of its
  // models think out loud: both off, so only the persona speaks.
  venice: { label: 'Venice', url: 'https://api.venice.ai/api/v1', model: 'deepseek-v4-flash', extra: { prompt_cache_key: 'playmate', venice_parameters: { include_venice_system_prompt: false, disable_thinking: true, strip_thinking_response: true, enable_web_search: 'off' } } },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: '', extra: {} },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', extra: {} },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b', extra: { reasoning_effort: 'none', reasoning_format: 'hidden' } },
  together: { label: 'Together', url: 'https://api.together.xyz/v1', model: '', extra: {} },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', model: '', extra: {} },
  xai: { label: 'xAI', url: 'https://api.x.ai/v1', model: '', extra: {} },
}

/** gpt-oss can't switch thinking off (low/medium/high only): lowest it has. */
export function fitExtra(extra: Record<string, unknown>, model: string): Record<string, unknown> {
  if (extra?.reasoning_effort === 'none' && /gpt-oss/.test(model || ''))
    return { ...extra, reasoning_effort: 'low' }
  return extra
}

export type Part = { type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }
export interface Msg { role: 'system' | 'user' | 'assistant', content: string | Part[] }

/** The brain refused a picture: the model or the API can't take images. */
export class NoVision extends Error {}

/**
 * Before a new turn: at the cap, cut back to half of it (an even count, so the
 * history still starts with a user message). Mutates and returns `history`.
 */
export function trimHistory(history: Msg[], cap: number): Msg[] {
  cap = Math.max(2, Math.floor(cap))
  if (history.length >= cap) {
    let keep = Math.floor(cap / 2)
    keep -= keep % 2
    history.splice(0, history.length - Math.max(0, keep))
  }
  return history
}

/** Server-sent events -> the reply's text deltas. Only `delta.content` counts; reasoning fields are ignored. */
export class SseParser {
  private buf = ''
  usage: Record<string, any> | null = null
  push(text: string): string[] {
    this.buf += text
    const out: string[] = []
    let nl = this.buf.indexOf('\n')
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      nl = this.buf.indexOf('\n')
      if (!line.startsWith('data:') || line === 'data: [DONE]')
        continue
      let msg: any
      try {
        msg = JSON.parse(line.slice(5))
      }
      catch {
        continue
      }
      if (msg.usage)
        this.usage = msg.usage
      const delta = msg.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta)
        out.push(delta)
    }
    return out
  }
}

export interface BrainConfig {
  kind: 'local' | 'api'
  url: string
  model: string
  key: string
  extra: Record<string, unknown>
  maxTokens: number
  history: number
}

/** A turn that was cut off on purpose (barge-in, stop, panic). */
export class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

const TURN_TIMEOUT_MS = 90_000

export class ChatBrain {
  history: Msg[] = []
  private ctrl: AbortController | null = null
  private chain: Promise<unknown> = Promise.resolve()
  lastUsage: Record<string, any> | null = null

  constructor(private fetchFn: FetchFn, private system: () => string, private cfg: () => BrainConfig, private log: (...a: unknown[]) => void = () => {}) {}

  /** One user turn; `onText` gets each streamed piece. Turns queue: one at a time. */
  ask(text: string, onText: (delta: string) => void = () => {}, signal?: AbortSignal, image?: string | null): Promise<string> {
    const run = async () => {
      // Cut off while it waited for the turn before it: never sent.
      if (signal?.aborted)
        throw new Cancelled()
      const cfg = this.cfg()
      const ctrl = new AbortController()
      this.ctrl = ctrl
      const onAbort = () => ctrl.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        ctrl.abort()
      }, TURN_TIMEOUT_MS)
      trimHistory(this.history, cfg.history)
      // A picture goes with this turn only: afterwards the history keeps a note
      // instead, so each request carries one picture at most.
      const msg: Msg = image
        ? { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] }
        : { role: 'user', content: text }
      this.history.push(msg)
      let refused = false
      const unpicture = () => {
        if (image)
          msg.content = `${text}\n[a frame from the video was shown here]`
      }
      let reply = ''
      try {
        if (!cfg.url)
          throw new Error('no brain URL set')
        const url = cfg.url.replace(/\/+$/, '')
        const res = await this.fetchFn(`${url}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
          signal: ctrl.signal,
          // Only standard fields, plus the provider's own (extra): some APIs
          // reject any field they don't know.
          body: JSON.stringify({
            model: cfg.model || undefined,
            stream: true,
            temperature: 0.9,
            max_tokens: cfg.maxTokens,
            ...(cfg.kind === 'api' ? { stream_options: { include_usage: true } } : {}),
            ...fitExtra(cfg.extra, cfg.model),
            messages: [{ role: 'system', content: this.system() }, ...this.history],
          }),
        })
        if (!res.ok && image && res.status >= 400 && res.status < 500) {
          const body = await res.text().catch(() => '')
          if (/image|vision|multimodal|content.*type|image_url/i.test(body)) {
            // Never happened as far as the history goes: the turn is asked again without it.
            this.history.pop()
            refused = true
            throw new NoVision(body.slice(0, 200))
          }
          throw new Error(`${cfg.kind} model: ${res.status} ${body.slice(0, 300)}`)
        }
        if (!res.ok)
          throw new Error(`${cfg.kind} model: ${res.status} ${(await res.text()).slice(0, 300)}`)
        if (!res.body)
          throw new Error(`${cfg.kind} model: empty response`)
        const sse = new SseParser()
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done)
            break
          for (const d of sse.push(decoder.decode(value, { stream: true }))) {
            reply += d
            try {
              onText(d)
            }
            catch (e) {
              this.log('onText failed', e)
            }
          }
        }
        this.lastUsage = sse.usage
      }
      catch (e) {
        // A cancelled fetch may reject with a TypeError, not an AbortError:
        // the signal is what tells.
        if (ctrl.signal.aborted)
          throw timedOut ? new Error(`${cfg.kind} model turn timed out`) : new Cancelled()
        throw e
      }
      finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (this.ctrl === ctrl)
          this.ctrl = null
        if (!refused) {
          unpicture()
          // Keep the turn either way, so the history stays user/assistant pairs.
          this.history.push({ role: 'assistant', content: reply || '…' })
        }
      }
      return reply
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => {})
    return p
  }

  abort() {
    this.ctrl?.abort()
  }

  get busy() {
    return !!this.ctrl
  }
}

/** Models from GET {url}/models, with context and price in the label where the list has them. */
export async function listModels(fetchFn: FetchFn, url: string, key: string): Promise<SelectOption[]> {
  if (!url)
    throw new Error('set the URL first')
  const res = await fetchFn(`${url.replace(/\/+$/, '')}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000) })
  if (!res.ok)
    throw new Error(`models: ${res.status}`)
  const data: any[] = (await res.json())?.data ?? []
  return data.filter(m => m && typeof m.id === 'string').map((m) => {
    // Venice: model_spec.pricing {input: {usd}} per 1M; Groq/OpenRouter: pricing {prompt: '0.00000015'} per token.
    const g = m.pricing
    const perM = (x: unknown) => (x != null && !Number.isNaN(+x!) ? { usd: +(+x! * 1e6).toFixed(3) } : null)
    const price = m.model_spec?.pricing || (g && { input: perM(g.prompt), cache_input: perM(g.input_cache_read), output: perM(g.completion) })
    const usd = (x: any) => (typeof x?.usd === 'number' ? `$${x.usd}` : '')
    const cost = usd(price?.input) && usd(price?.output)
      ? `in ${usd(price.input)}${usd(price.cache_input) ? `, cached ${usd(price.cache_input)}` : ''}, out ${usd(price.output)}`
      : ''
    const ctxLen = m.context_length ?? m.max_context_length ?? m.model_spec?.availableContextTokens
    const note = [ctxLen ? `${Math.round(ctxLen / 1000)}K` : '', cost].filter(Boolean).join(', ')
    return { value: m.id, label: note ? `${m.id} (${note})` : m.id }
  }).sort((a, b) => a.value.localeCompare(b.value))
}
