import OpenAI from "openai";
import type { Trail } from "@trail/contracts";
import { config } from "./config.js";
import { FixtureSandbox } from "./sandbox.js";

type ToolCall = { type: "function_call"; call_id: string; name: string; arguments: string };
type AgentUsage = { inputTokens: number; outputTokens: number; toolCalls: number };

const tools = [
  { type: "function", name: "inspect_environment", description: "Inspect the disposable fixture, allowlisted files, named checks, and current changed-file scope.", strict: true, parameters: { type: "object", properties: {}, additionalProperties: false, required: [] } },
  { type: "function", name: "read_file", description: "Read one allowlisted relative fixture file.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false, required: ["path"] } },
  { type: "function", name: "write_file", description: "Write one allowlisted relative fixture file. Set route=healthy while preserving the surface line.", strict: true, parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, additionalProperties: false, required: ["path", "content"] } },
  { type: "function", name: "run_check", description: "Run one named allowlisted deterministic check.", strict: true, parameters: { type: "object", properties: { name: { type: "string", enum: ["unit", "visible-route"] } }, additionalProperties: false, required: ["name"] } },
] as const;

function executeTool(sandbox: FixtureSandbox, call: ToolCall) {
  const args = JSON.parse(call.arguments || "{}") as Record<string, string>;
  switch (call.name) {
    case "inspect_environment": return sandbox.inspect();
    case "read_file": return { path: args.path, content: sandbox.read(String(args.path)) };
    case "write_file": return sandbox.write(String(args.path), String(args.content));
    case "run_check": return sandbox.check(String(args.name));
    default: throw new Error(`Unknown tool: ${call.name}`);
  }
}

export async function runOpenAiFixture(input: {
  runId: string;
  side: "baseline" | "guided";
  trail?: Trail;
  emit: (type: "observation" | "action" | "gate_passed" | "gate_blocked" | "error", message: string, detail?: Record<string, unknown>) => Promise<void>;
}) {
  if (!config.openAiKey) throw new Error("Live AI is unavailable: OPENAI_API_KEY is not configured.");
  const client = new OpenAI({ apiKey: config.openAiKey, baseURL: config.openAiBaseUrl || undefined });
  const sandbox = new FixtureSandbox(input.runId, input.side);
  const trailContext = input.trail
    ? `\nVerified trail contract:\n${JSON.stringify({ title: input.trail.title, negativeConstraints: input.trail.negativeConstraints, steps: input.trail.steps }, null, 2)}`
    : "\nNo retrieved trail is available. Solve from the task and tool observations alone.";
  const toolBudget = 6;
  const instructions = `You are the ${input.side} coding agent in a controlled benchmark. Work only through the provided functions. Inspect before writing, run both named checks, and stop after the checks. Never claim evidence you did not observe. You have at most ${toolBudget} tool calls.${trailContext}`;
  const conversation: unknown[] = [{ role: "user", content: sandbox.manifest.task }];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
  await input.emit("observation", `${config.providerLabel} Responses executor started in a disposable allowlisted fixture.`, { model: config.agentModel, store: false });
  agentLoop: for (let turn = 0; turn < 8; turn += 1) {
    const response = await client.responses.create({
      model: config.agentModel,
      store: false,
      reasoning: { effort: config.reasoningEffort },
      instructions,
      input: conversation as never,
      tools: tools as never,
      tool_choice: "auto",
    });
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    conversation.push(...response.output);
    const calls = response.output.filter((item) => item.type === "function_call") as ToolCall[];
    if (calls.length === 0) break;
    for (const call of calls) {
      if (usage.toolCalls >= toolBudget) {
        await input.emit("error", "Tool budget exhausted before another recovery action could run.", { toolBudget });
        break agentLoop;
      }
      usage.toolCalls += 1;
      try {
        const result = executeTool(sandbox, call);
        await input.emit("action", `${call.name} completed.`, { arguments: JSON.parse(call.arguments || "{}"), result });
        conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool failed";
        await input.emit("error", message, { tool: call.name });
        conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: message }) });
      }
    }
  }
  return { state: sandbox.releaseState(), usage };
}
