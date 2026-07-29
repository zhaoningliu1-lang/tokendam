// Verifies the normalizer ingests every supported export shape.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
function ok(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}
function run(name, input) {
  try {
    const r = analyze(input);
    ok(name, r.numCalls > 0, `→ ${r.numCalls} call(s), model=${r.model}`);
    return r;
  } catch (e) {
    ok(name, false, "ERR: " + e.message);
    return null;
  }
}

const bigSys = "You are a helpful assistant. " + "Follow every rule carefully. ".repeat(200);

// 1. Plain OpenAI array (baseline)
run("openai array", [
  { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "hi" }] },
  { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "bye" }] },
]);

// 2. LangSmith run
run("langsmith run", {
  run_type: "llm",
  start_time: "2026-01-02T00:00:00Z",
  extra: { invocation_params: { model: "gpt-4o", tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }] } },
  inputs: { messages: [{ role: "system", content: bigSys }, { role: "user", content: "weather?" }] },
  outputs: { usage_metadata: { input_tokens: 27, output_tokens: 13 } },
});

// 3. Langfuse observation (stringified input/output)
run("langfuse generation", [{
  type: "GENERATION",
  providedModelName: "claude-sonnet-4-6",
  input: JSON.stringify({ messages: [{ role: "system", content: bigSys }, { role: "user", content: "hey" }] }),
  output: JSON.stringify({ role: "assistant", content: "hello" }),
  usageDetails: { input: 98, output: 68, total: 166 },
}]);

// 4. OpenAI Batch output line
run("openai batch output", [{
  custom_id: "req-1",
  response: { status_code: 200, body: { object: "chat.completion", model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content: "done" } }], usage: { prompt_tokens: 1200, completion_tokens: 40 } } },
  error: null,
}]);

// 5. Vercel AI SDK onFinish object
run("vercel ai sdk onFinish", {
  finishReason: "stop",
  usage: { inputTokens: 3000, outputTokens: 120 },
  response: { modelId: "gpt-4o", messages: [{ role: "assistant", content: "ok" }] },
  text: "ok",
});

// 6. Vercel AI SDK UIMessage[]
run("vercel ai sdk UIMessage[]", [
  { role: "user", parts: [{ type: "text", text: "search cats" }] },
  { role: "assistant", parts: [{ type: "reasoning", text: "thinking..." }, { type: "tool-webSearch", input: { q: "cats" } }] },
]);

// 7. Generic {request,response} envelope, JSONL string
const jsonl = [
  { ts: 1, request: { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "a" }] }, response: { usage: { prompt_tokens: 900, completion_tokens: 20 } } },
  { ts: 2, request: { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "b" }] }, response: { usage: { prompt_tokens: 900, completion_tokens: 20 } } },
].map((o) => JSON.stringify(o)).join("\n");
run("generic {request,response} JSONL", jsonl);

// 8. OpenAI Usage Admin API (aggregate)
run("openai usage admin api", {
  object: "page",
  data: [{ object: "bucket", start_time: 1, results: [{ model: "gpt-4o", input_tokens: 50000, output_tokens: 2000 }] }],
});

console.log(failed ? `\nFAILED (${failed})` : "\nALL FORMAT CHECKS PASSED");
process.exit(failed ? 1 : 0);
