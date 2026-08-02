import type { NormCall, NormMessage, NormTool, NormTrace, Role } from "./types.js";
import { countTokens } from "./tokens.js";
import { priceFor } from "./pricing.js";

// Accepts loose JSON that looks like one or more OpenAI/Anthropic requests and
// flattens it into a NormTrace. We're deliberately permissive: real traces come
// from logs, SDK dumps, LangSmith exports, etc., so we sniff shapes rather than
// demand an exact schema.

type Any = any;

function asText(content: Any): { text: string; toolCalls: string[]; cached: boolean } {
  let text = "";
  const toolCalls: string[] = [];
  let cached = false;

  if (typeof content === "string") return { text: content, toolCalls, cached };
  if (!Array.isArray(content)) {
    // Some shapes nest {content: "..."} or are already objects.
    if (content && typeof content === "object") {
      if (typeof content.text === "string") text += content.text;
      if (content.cache_control) cached = true;
    }
    return { text, toolCalls, cached };
  }

  for (const block of content) {
    if (typeof block === "string") {
      text += block;
      continue;
    }
    if (!block || typeof block !== "object") continue;
    if (block.cache_control) cached = true;
    const t = block.type;
    if (t === "text" || t === "input_text" || t === "output_text") {
      text += block.text ?? "";
    } else if (t === "tool_use") {
      if (block.name) toolCalls.push(block.name);
      text += JSON.stringify(block.input ?? {});
    } else if (t === "tool_result") {
      const c = block.content;
      text += typeof c === "string" ? c : JSON.stringify(c ?? "");
    } else if (block.text) {
      text += block.text;
    }
  }
  return { text, toolCalls, cached };
}

function mkMsg(role: Role, content: Any): NormMessage {
  const { text, toolCalls, cached } = asText(content);
  return {
    role,
    text,
    tokens: countTokens(text),
    toolCalls: toolCalls.length ? toolCalls : undefined,
    cached,
  };
}

function parseTools(rawTools: Any): { tools: NormTool[]; cached: boolean } {
  const tools: NormTool[] = [];
  let cached = false;
  if (!Array.isArray(rawTools)) return { tools, cached };
  for (const t of rawTools) {
    if (!t || typeof t !== "object") continue;
    if (t.cache_control) cached = true;
    // OpenAI: {type:"function", function:{name, parameters}}
    // Anthropic: {name, input_schema}
    const fn = t.function ?? t;
    const name: string = fn.name ?? t.name ?? "unnamed_tool";
    const raw = JSON.stringify(t);
    tools.push({ name, raw, tokens: countTokens(raw) });
  }
  return { tools, cached };
}

function normalizeCall(call: Any): NormCall {
  const system: NormMessage[] = [];
  let hasCacheMarker = false;

  // system: string | blocks[] (Anthropic) or a leading {role:"system"} message (OpenAI)
  if (call.system !== undefined) {
    const m = mkMsg("system", call.system);
    if (m.cached) hasCacheMarker = true;
    if (m.text) system.push(m);
  }

  const messages: NormMessage[] = [];
  const rawMessages: Any[] = Array.isArray(call.messages) ? call.messages : [];
  for (const rm of rawMessages) {
    if (!rm || typeof rm !== "object") continue;
    const role: Role = (rm.role as Role) ?? "user";
    // OpenAI assistant tool calls live on message.tool_calls
    const openAiToolCalls: string[] = Array.isArray(rm.tool_calls)
      ? rm.tool_calls.map((c: Any) => c?.function?.name).filter(Boolean)
      : [];
    const m = mkMsg(role, rm.content);
    if (openAiToolCalls.length) {
      m.toolCalls = [...(m.toolCalls ?? []), ...openAiToolCalls];
    }
    if (m.cached) hasCacheMarker = true;
    if (role === "system") {
      system.push(m);
    } else {
      messages.push(m);
    }
  }

  const { tools, cached: toolsCached } = parseTools(call.tools);
  if (toolsCached) hasCacheMarker = true;

  const usage = call.usage
    ? {
        inputTokens: call.usage.input_tokens ?? call.usage.prompt_tokens,
        outputTokens: call.usage.output_tokens ?? call.usage.completion_tokens,
        cachedInputTokens:
          call.usage.cache_read_input_tokens ??
          call.usage.cached_tokens ??
          call.usage.prompt_tokens_details?.cached_tokens,
        reasoningTokens:
          call.usage.completion_tokens_details?.reasoning_tokens ??
          call.usage.reasoning_tokens ??
          call.usage.output_tokens_details?.reasoning_tokens,
      }
    : undefined;

  const model = String(call.model ?? "unknown");
  const { price, matched } = priceFor(model);
  return {
    model,
    system,
    messages,
    tools,
    usage,
    hasCacheMarker,
    price,
    priceMatched: matched,
    reasoningEffort: call.reasoning_effort ?? call.reasoning?.effort,
    verbosity: call.verbosity ?? call.text?.verbosity,
    thinkingBudget: call.thinking?.budget_tokens,
    structuredOutput: !!(
      call.response_format ||
      call.text?.format ||
      call.tools?.some?.((t: Any) => t?.type === "json_schema")
    ),
  };
}

function tryParse(v: Any): Any {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function usageFrom(u: Any): Any {
  if (!u) return undefined;
  return {
    input_tokens: u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokens ?? u.input,
    output_tokens:
      u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.completionTokens ?? u.output,
    cache_read_input_tokens:
      u.cache_read_input_tokens ??
      u.cachedInputTokens ??
      u.cachedPromptTokens ??
      u.prompt_tokens_details?.cached_tokens ??
      u.cached_tokens,
  };
}

/** Convert a Vercel AI SDK UIMessage[] (parts-based) into request-body messages. */
function uiMessagesToBody(arr: Any[]): Any {
  const messages = arr.map((m) => {
    const parts: Any[] = Array.isArray(m.parts) ? m.parts : [];
    let text = "";
    const toolCalls: Any[] = [];
    for (const p of parts) {
      const t = p?.type;
      if (t === "text" || t === "reasoning") text += p.text ?? "";
      else if (typeof t === "string" && t.startsWith("tool-")) {
        toolCalls.push({ function: { name: t.slice(5) } });
        text += JSON.stringify(p.input ?? p.output ?? {});
      } else if (t === "dynamic-tool") {
        toolCalls.push({ function: { name: p.toolName } });
      }
    }
    return { role: m.role, content: text, tool_calls: toolCalls.length ? toolCalls : undefined };
  });
  return { model: "unknown", messages };
}

/**
 * Adapt one raw element (from any supported export) into an OpenAI/Anthropic-
 * shaped request body that normalizeCall() already understands. Returns null to
 * skip elements that aren't LLM calls (e.g. LangSmith chain/tool spans).
 */
function adaptElement(el: Any): Any | null {
  if (!el || typeof el !== "object") return null;

  // LangSmith run
  if (el.run_type !== undefined && el.inputs !== undefined) {
    const rt = String(el.run_type).toLowerCase();
    if (rt !== "llm" && rt !== "chat") return null;
    const ip = el.extra?.invocation_params ?? {};
    return {
      model:
        ip.model ??
        el.extra?.metadata?.ls_model_name ??
        el.serialized?.kwargs?.model ??
        el.outputs?.llm_output?.model_name ??
        "unknown",
      messages: el.inputs.messages ?? el.inputs.input ?? [],
      tools: ip.tools ?? ip.functions,
      usage: usageFrom(
        el.outputs?.usage_metadata ?? el.outputs?.llm_output?.token_usage ?? el
      ),
    };
  }

  // Langfuse observation (input/output are stringified JSON)
  if (
    el.type === "GENERATION" ||
    el.observationType === "GENERATION" ||
    el.providedModelName !== undefined ||
    el.usageDetails !== undefined
  ) {
    const inp = tryParse(el.input);
    const messages = Array.isArray(inp)
      ? inp
      : inp?.messages ?? (typeof inp === "string" ? [{ role: "user", content: inp }] : []);
    return {
      model: el.providedModelName ?? el.model ?? el.modelParameters?.model ?? "unknown",
      messages,
      tools: inp?.tools ?? el.modelParameters?.tools,
      usage: usageFrom({
        input: el.usageDetails?.input ?? el.inputUsage,
        output: el.usageDetails?.output ?? el.outputUsage,
        cache_read_input_tokens: el.usageDetails?.cache_read_input_tokens,
        ...(el.usage ?? {}),
      }),
    };
  }

  // OpenAI Batch OUTPUT line (no input messages — synth an assistant turn)
  if (el.custom_id !== undefined && el.response?.body?.object === "chat.completion") {
    const body = el.response.body;
    const msg = body.choices?.[0]?.message;
    return {
      model: body.model,
      messages: msg
        ? [{ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls }]
        : [],
      usage: usageFrom(body.usage),
    };
  }
  // OpenAI Batch INPUT line — body is a real request
  if (el.custom_id !== undefined && el.method && el.url && el.body?.messages) {
    return el.body;
  }

  // Vercel AI SDK onFinish object
  if (el.usage && (el.finishReason !== undefined || el.response !== undefined || el.text !== undefined)) {
    const respMsgs = el.response?.messages;
    const messages =
      Array.isArray(respMsgs) && respMsgs.length
        ? respMsgs
        : el.text
        ? [{ role: "assistant", content: el.text }]
        : [];
    return {
      model: el.response?.modelId ?? el.modelId ?? "unknown",
      messages,
      tools: el.tools,
      usage: usageFrom(el.usage),
    };
  }

  // Generic {request,response} envelope (highest-leverage adapter)
  const req = el.request ?? el.req ?? el.input ?? el.prompt;
  if (req && typeof req === "object" && (req.messages || req.system || req.model)) {
    const res = el.response ?? el.res ?? el.output ?? el.completion;
    return { ...req, usage: res?.usage ? usageFrom(res.usage) : req.usage };
  }

  // Already an OpenAI/Anthropic request body
  if (el.messages || el.system) return el;

  return null;
}

/** Pull an array of raw (already OpenAI/Anthropic-shaped) call objects out of
 * whatever the user pasted, running format adapters as needed. */
function extractRawCalls(input: Any): Any[] {
  // JSONL string → parse each line
  if (typeof input === "string") {
    const lines = input
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(tryParse)
      .filter((x) => typeof x === "object");
    if (lines.length) input = lines;
  }

  let arr: Any[];
  if (Array.isArray(input)) {
    // Vercel AI SDK UIMessage[] — the whole array is ONE call's messages
    if (input.length && input.every((m) => m && Array.isArray(m.parts) && m.role !== undefined)) {
      return [uiMessagesToBody(input)];
    }
    arr = input;
  } else if (input && typeof input === "object") {
    // OpenAI Usage/Costs Admin API — aggregate buckets → usage-only calls
    if (input.object === "page" && Array.isArray(input.data) && input.data[0]?.object === "bucket") {
      return input.data
        .flatMap((b: Any) => b.results ?? [])
        .map((r: Any) => ({ model: r.model ?? "unknown", messages: [], usage: usageFrom(r) }));
    }
    const wrap = input.calls ?? input.requests ?? input.trace ?? input.data;
    // Otherwise treat the object as a single call/run and let the adapters decide.
    arr = Array.isArray(wrap) ? wrap : [input];
  } else {
    arr = [];
  }

  const adapted = arr.map(adaptElement).filter(Boolean) as Any[];
  if (!adapted.length) {
    throw new Error(
      "Couldn't find any LLM calls. Paste OpenAI/Anthropic request bodies, an array of them, or an export from LangSmith / Langfuse / OpenAI Batch / Vercel AI SDK."
    );
  }
  return adapted;
}

export function normalize(input: Any): NormTrace {
  const raw = extractRawCalls(input);
  const calls = raw
    .map(normalizeCall)
    .filter((c) => c.system.length || c.messages.length || c.usage);
  if (!calls.length) throw new Error("No usable messages found in the trace.");

  const vendors = new Set(calls.map((c) => detectVendorFromModel(c.model)));
  const vendor = vendors.size === 1 ? [...vendors][0] : "mixed";

  return { calls, vendor, notes: [] };
}

function detectVendorFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("claude")) return "anthropic";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("gpt") || /^o[0-9]/.test(m) || m.includes("openai"))
    return "openai";
  return "unknown";
}
