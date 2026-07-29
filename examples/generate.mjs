// Generates realistic example traces used by the CLI/web demo and tests.
// Run: node examples/generate.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// ---- 1) sd-tender-radar style: same big system prompt, huge page dumps, no cache ----
const SD_SYSTEM = `你是工程招投标公告的资质智能匹配助手。请按住建部资质体系做专业判断，严格输出 JSON。
${Array.from({ length: 40 }, (_, i) => `规则${i + 1}：判定 tender_scope / industry_sector / has_design_component 时，参照住建部 21 个行业资质与标段类型定义，边界情形按招标人主管部门归类，雨污分流看水务局或住建，EPC 一律 has_design_component=true，全过程咨询含可研规划造价审计。`).join("\n")}
输出字段：notice_no,title,notice_type,tender_scope,industry_sector,has_design_component,buyer,agent,budget_wan,deadline,bid_open_at,qualifications,deposit_wan,winner,win_amount_wan,region_text。`;

// a ~60k-char scraped bidding page — mostly boilerplate须知/评分办法
function fakeNoticePage(n) {
  const head = `潍坊市${n}区市政道路综合改造工程施工招标公告\n公告编号 WF-2026-${1000 + n}\n招标人：潍坊市${n}区住房和城乡建设局\n代理机构：山东某招标代理有限公司\n预算金额：3860万元\n投标截止：2026-08-15 09:30\n开标时间：2026-08-15 09:30\n资质要求：市政公用工程施工总承包二级及以上，项目经理市政专业二级建造师。\n`;
  const boiler = Array.from(
    { length: 260 },
    (_, i) =>
      `第${i + 1}条 投标人须知：投标文件的组成、编制、递交、开标、评标、定标、合同授予等程序均按《中华人民共和国招标投标法》及其实施条例、评分办法附表执行，评标采用综合评估法，技术标30分商务标20分报价50分，未尽事宜以答疑澄清为准。`
  ).join("\n");
  return head + boiler;
}

const sdCalls = Array.from({ length: 6 }, (_, i) => ({
  model: "deepseek-chat",
  messages: [
    { role: "system", content: SD_SYSTEM },
    { role: "user", content: fakeNoticePage(i + 1) },
  ],
  usage: { prompt_tokens: 0, completion_tokens: 180 },
}));

writeFileSync(join(here, "sd-tender-radar.json"), JSON.stringify(sdCalls, null, 2));

// ---- 2) Claude coding-agent loop: tools (some unused), growing history, no cache ----
const CLAUDE_SYSTEM = `You are a senior software engineer agent operating in a user's repository.
${Array.from({ length: 60 }, (_, i) => `Guideline ${i + 1}: prefer minimal diffs, match surrounding style, never fabricate file paths, run tests before claiming done, explain reasoning succinctly, use the provided tools rather than guessing, and keep the working tree clean.`).join("\n")}`;

function tool(name, desc, props) {
  return {
    name,
    description: desc + " " + "x".repeat(200),
    input_schema: { type: "object", properties: props, required: Object.keys(props) },
  };
}
const TOOLS = [
  tool("read_file", "Read a file from disk.", { path: { type: "string" } }),
  tool("edit_file", "Edit a file.", { path: { type: "string" }, patch: { type: "string" } }),
  tool("run_bash", "Run a shell command.", { cmd: { type: "string" } }),
  tool("grep", "Search the repo.", { query: { type: "string" } }),
  // --- the following are never called in this trace (kitchen-sink MCP) ---
  tool("jira_create_issue", "Create a Jira issue.", { title: { type: "string" }, body: { type: "string" } }),
  tool("slack_post", "Post to Slack.", { channel: { type: "string" }, text: { type: "string" } }),
  tool("figma_export", "Export a Figma frame.", { frameId: { type: "string" } }),
  tool("datadog_query", "Query Datadog metrics.", { query: { type: "string" } }),
  tool("stripe_refund", "Issue a Stripe refund.", { chargeId: { type: "string" } }),
];

const history = [
  { role: "user", content: "The build is failing on CI. Fix it." },
];
const claudeCalls = [];
const steps = [
  { asst: [{ type: "text", text: "Let me look at the CI logs." }, { type: "tool_use", name: "run_bash", input: { cmd: "cat ci.log" } }], toolResult: "TypeError: cannot read 'map' of undefined at build.js:42" },
  { asst: [{ type: "text", text: "Let me read build.js." }, { type: "tool_use", name: "read_file", input: { path: "build.js" } }], toolResult: "x".repeat(6000) },
  { asst: [{ type: "text", text: "Searching for the caller." }, { type: "tool_use", name: "grep", input: { query: "buildManifest" } }], toolResult: "x".repeat(5000) },
  { asst: [{ type: "text", text: "I'll patch the guard." }, { type: "tool_use", name: "edit_file", input: { path: "build.js", patch: "..." } }], toolResult: "ok" },
  { asst: [{ type: "text", text: "Re-running the build." }, { type: "tool_use", name: "run_bash", input: { cmd: "npm run build" } }], toolResult: "build passed" },
];
for (const step of steps) {
  claudeCalls.push({
    model: "claude-sonnet-4-6",
    system: CLAUDE_SYSTEM,
    tools: TOOLS,
    messages: [...history],
    usage: { input_tokens: 0, output_tokens: 120 },
  });
  history.push({ role: "assistant", content: step.asst });
  history.push({ role: "user", content: [{ type: "tool_result", content: step.toolResult }] });
}

writeFileSync(join(here, "coding-agent.json"), JSON.stringify(claudeCalls, null, 2));

console.log("Wrote sd-tender-radar.json and coding-agent.json");
