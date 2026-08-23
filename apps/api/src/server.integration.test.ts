import { afterAll, describe, expect, it } from "vitest";
import { app, db } from "./server.js";

afterAll(async () => { await app.close(); db.close(); });

describe("TRAIL API", () => {
  it("reports explicit missing-key state and the approved corpus", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.liveAi).toBe(false);
    expect(body.missing).toContain("OPENAI_API_KEY");
    expect(body.corpusCount).toBeGreaterThanOrEqual(20);
  });

  it("redacts an uploaded transcript and refuses fake extraction", async () => {
    const previewResponse = await app.inject({ method: "POST", url: "/api/ingestions/preview", payload: { sourceName: "private-user@example.com.jsonl", text: JSON.stringify({ type: "user", message: { content: "token=supersecretvalue user@example.com" } }) } });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json();
    expect(preview.redactedText).not.toContain("supersecretvalue");
    const ingestionList = await app.inject({ method: "GET", url: "/api/ingestions" });
    expect(ingestionList.json().ingestions.some((item: { id: string; status: string }) => item.id === preview.id && item.status === "previewed")).toBe(true);
    const extraction = await app.inject({ method: "POST", url: `/api/ingestions/${preview.id}/extract`, payload: {} });
    expect(extraction.statusCode).toBe(503);
    expect(extraction.json().liveAi).toBe(false);
    const manualDraft = await app.inject({ method: "POST", url: `/api/ingestions/${preview.id}/draft-template`, payload: {} });
    expect(manualDraft.statusCode).toBe(200);
    expect(manualDraft.json().trail.reviewStatus).toBe("draft");
    expect(JSON.stringify(manualDraft.json())).not.toContain("supersecretvalue");
    expect(JSON.stringify(manualDraft.json())).not.toContain("private-user@example.com");
    const prematureApproval = await app.inject({ method: "POST", url: `/api/trails/${manualDraft.json().trail.id}/approve`, payload: manualDraft.json().trail });
    expect(prematureApproval.statusCode).toBe(422);
    const liveRun = await app.inject({ method: "POST", url: "/api/runs", payload: { executor: "openai-responses" } });
    expect(liveRun.statusCode).toBe(503);
    expect(liveRun.json().liveAi).toBe(false);
  });

  it("retrieves an applicable route and completes a real deterministic harness run", async () => {
    const retrieval = await app.inject({ method: "POST", url: "/api/retrieve", payload: { intent: "fix production route in visible checkout", environment: { client: "codex", workspace: "service-live" }, trigger: "start", evidenceState: {}, limit: 3 } });
    expect(retrieval.statusCode).toBe(200);
    expect(retrieval.json().matches[0].trail.id).toBe("trail-visible-checkout");
    const created = await app.inject({ method: "POST", url: "/api/runs", payload: { executor: "deterministic-fixture", speedMs: 0 } });
    const runId = created.json().runId;
    let completed = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && completed.json().run.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      completed = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    }
    expect(completed.json().run.status).toBe("completed");
    expect(completed.json().run.metrics.guided.verified).toBe(true);
    expect(completed.json().run.metrics.baseline.verified).toBe(false);
  });
});
