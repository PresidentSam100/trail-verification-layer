import { mkdirSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { RetrievalRequestSchema, TrailSchema } from "@trail/contracts";
import { config, preflight } from "./config.js";
import { TrailDatabase } from "./database.js";
import { previewTranscript } from "./adapters.js";
import { extractTrail, OpenAiUnavailableError, rerankTrails } from "./openai.js";
import { loadCorpus, publishTrail } from "./corpus.js";
import { retrieveTrails } from "./retrieval.js";
import { HarnessService } from "./harness.js";
import { ensureActivePolicy, evaluatePolicy, proposePolicy } from "./policy.js";
import { indexLocalSources } from "./source-index.js";
import { runBenchmark } from "./benchmark.js";

mkdirSync(config.corpusPath, { recursive: true });
export const db = new TrailDatabase(config.databasePath);
const corpusCount = loadCorpus(db);
ensureActivePolicy(db);
const harness = new HarnessService(db);

export const app = Fastify({ logger: true, bodyLimit: 16 * 1024 * 1024 });
await app.register(cors, { origin: [config.allowedOrigin, "http://localhost:4173"] });

app.get("/api/health", async () => ({ status: "ok", corpusCount: db.getTrails().length || corpusCount, ...preflight(), sourceIndex: db.sourceSummary() }));
app.get("/api/trails", async () => ({ trails: db.getTrails() }));
app.get("/api/policies", async () => ({ policies: db.getPolicies(), active: db.getActivePolicy() }));
app.get("/api/runs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = db.getRun(id);
  return run ? { run, events: db.getRunEvents(id) } : reply.code(404).send({ error: "Run not found" });
});

app.post("/api/sources/index", async () => indexLocalSources(db));

app.post("/api/ingestions/preview", async (request, reply) => {
  const body = request.body as { sourceName?: string; text?: string };
  if (!body?.sourceName || !body?.text) return reply.code(400).send({ error: "sourceName and text are required" });
  const preview = previewTranscript(body.sourceName, body.text);
  db.saveIngestion(preview);
  return preview;
});

app.post("/api/ingestions/:id/extract", async (request, reply) => {
  const { id } = request.params as { id: string };
  const ingestion = db.getIngestion(id);
  if (!ingestion) return reply.code(404).send({ error: "Ingestion not found" });
  try {
    const trail = await extractTrail(ingestion);
    db.upsertTrail(trail);
    return { trail, liveAi: true };
  } catch (error) {
    if (error instanceof OpenAiUnavailableError) return reply.code(503).send({ error: error.message, missing: ["OPENAI_API_KEY"], liveAi: false });
    throw error;
  }
});

app.post("/api/trails/:id/approve", async (request, reply) => {
  const { id } = request.params as { id: string };
  const draft = TrailSchema.parse(request.body);
  if (draft.id !== id) return reply.code(400).send({ error: "Trail id does not match route" });
  return publishTrail(db, draft);
});

app.post("/api/retrieve", async (request) => {
  const parsed = RetrievalRequestSchema.parse(request.body);
  const result = retrieveTrails(db, parsed, db.getActivePolicy());
  if (!config.openAiKey || result.matches.length < 2) {
    return { ...result, policy: db.getActivePolicy(), rerankedByOpenAi: false };
  }
  try {
    const matches = await rerankTrails(parsed, result.matches);
    return { ...result, matches, policy: db.getActivePolicy(), rerankedByOpenAi: true };
  } catch (error) {
    return {
      ...result,
      policy: db.getActivePolicy(),
      rerankedByOpenAi: false,
      rerankerError: error instanceof Error ? error.message : "OpenAI reranker failed.",
    };
  }
});

app.post("/api/runs", async (request, reply) => {
  const body = (request.body ?? {}) as { executor?: string; speedMs?: number };
  if (body.executor === "openai-responses") {
    const readiness = preflight();
    if (!readiness.liveAi) return reply.code(503).send({ error: `Live AI is unavailable: ${readiness.missing.join(", ")}.`, liveAi: false, missing: readiness.missing });
    return reply.code(202).send(harness.startOpenAiPairedRun());
  }
  return reply.code(202).send(harness.startPairedRun(body.speedMs ?? 170));
});

app.get("/api/runs/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db.getRun(id)) return reply.code(404).send({ error: "Run not found" });
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": config.allowedOrigin });
  let sequence = -1;
  const interval = setInterval(() => {
    const events = db.getRunEvents(id, sequence);
    for (const event of events) {
      sequence = event.sequence;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const run = db.getRun(id);
    if (run && run.status !== "running") {
      reply.raw.write(`event: complete\ndata: ${JSON.stringify(run)}\n\n`);
      clearInterval(interval);
      reply.raw.end();
    }
  }, 120);
  request.raw.on("close", () => clearInterval(interval));
});

app.post("/api/policies/propose", async (request) => {
  const body = (request.body ?? {}) as { reason?: string; weights?: Record<string, number> };
  return { policy: proposePolicy(db, body.reason ?? "Increase environment fidelity after a wrong-checkout failure", body.weights) };
});

app.post("/api/policies/:id/evaluate", async (request, reply) => {
  const { id } = request.params as { id: string };
  const policy = db.getPolicies().find((item) => item.id === id);
  if (!policy) return reply.code(404).send({ error: "Policy not found" });
  return evaluatePolicy(db, policy, request.body as never);
});

app.post("/api/benchmarks/run", async () => runBenchmark(db));

app.setErrorHandler((error, _request, reply) => {
  const typed = error as Error & { issues?: unknown };
  const status = typed.issues ? 400 : 500;
  reply.code(status).send({ error: typed.message, issues: typed.issues });
});

if (process.env.NODE_ENV !== "test") {
  await app.listen({ port: config.port, host: "127.0.0.1" });
}
