import { useEffect, useMemo, useState } from "react";
import type { IngestionPreview, RetrievalPolicy, RunEvent, RunMetrics, Trail } from "@trail/contracts";
import { api, eventStream } from "./api";

type Tab = "proof" | "corpus" | "ingest" | "policy";
type Health = {
  status: string;
  corpusCount: number;
  ready: boolean;
  liveAi: boolean;
  agentModel: string;
  extractorModel: string;
  missing: string[];
  deterministicHarness: boolean;
  sourceRoots: { codex: boolean; claude: boolean };
  sourceIndex: { total: number; providers: Array<{ provider: string; count: number; bytes: number }>; signals: Record<string, number> };
};
type IngestionRecord = {
  id: string;
  format: IngestionPreview["format"];
  sourceName: string;
  status: "previewed" | "drafted" | "approved";
  trailId: string | null;
  redactionCount: number;
  candidateSignals: string[];
  requiresReview: boolean;
  createdAt: string;
};
type SourceCandidate = {
  pathHash: string;
  provider: string;
  sourceName: string;
  sizeBytes: number;
  modifiedAt: string;
  signals: string[];
  score: number;
};
type SourceInventory = {
  total: number;
  providers: Array<{ provider: string; count: number; bytes: number }>;
  signals: Record<string, number>;
  shortlist: SourceCandidate[];
  roots: { codex: boolean; claude: boolean };
};
type ResearchCorpus = {
  status: "ready" | "not-indexed";
  source: { id: string; dataset: string; expectedRows: number; compilationLicense: string; itemLicensePolicy: string; trustTier: string };
  stats: null | { rowsSeen?: number; uniqueSkills?: number; quarantined?: number; rowsRejected?: number };
  safety: { executable: false; promotable: false; rawBodiesReturnedByApi: false; automaticPromotion: false };
};
type RunRecord = { id: string; status: string; executor: string; metrics: Record<string, RunMetrics> };
type Benchmark = {
  executor: string;
  disclaimer: string;
  endToEndRuns: number;
  metrics: {
    baselineVerified: { numerator: number; denominator: number };
    guidedVerified: { numerator: number; denominator: number };
    unsafeApprovals: { baseline: number; guided: number };
    recallAt1: number;
    recallAt3: number;
    mrr: number;
  };
};

const navigation: Array<{ id: Tab; label: string }> = [
  { id: "proof", label: "Live proof" },
  { id: "corpus", label: "Trail corpus" },
  { id: "ingest", label: "Data intake" },
  { id: "policy", label: "RSI policy" },
];

function Mark() {
  return (
    <div className="mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return <span className={`status-pill ${live ? "live" : "offline"}`}><i />{live ? "OpenAI ready" : "AI key missing"}</span>;
}

function AppShell({ tab, setTab, health, children }: { tab: Tab; setTab: (tab: Tab) => void; health: Health | null; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" aria-label="TRAIL live proof" onClick={() => setTab("proof")}><Mark /><span>TRAIL</span><small>Trajectory Retrieval & Intent Alignment Layer</small></button>
        <nav aria-label="Primary navigation">
          {navigation.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>
        <StatusPill live={Boolean(health?.liveAi)} />
      </header>
      <main>{children}</main>
    </div>
  );
}

function EventCard({ event }: { event: RunEvent }) {
  const label: Record<RunEvent["type"], string> = {
    run_started: "Start", observation: "Observe", retrieval: "Retrieve", action: "Act", gate_blocked: "Blocked",
    gate_passed: "Verified", reroute: "Reroute", run_finished: "Finish", error: "Error",
  };
  return (
    <article className={`event-card event-${event.type}`}>
      <span>{label[event.type]}</span>
      <p>{event.message}</p>
      {event.type === "retrieval" && Array.isArray(event.detail.reasons) && <ul>{(event.detail.reasons as string[]).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    </article>
  );
}

function AgentLane({ side, events, metrics, running }: { side: "baseline" | "guided"; events: RunEvent[]; metrics: RunMetrics | undefined; running: boolean }) {
  const guided = side === "guided";
  return (
    <section className={`agent-lane ${guided ? "guided" : "baseline"}`}>
      <div className="lane-heading">
        <div><small>{guided ? "WITH TRAIL" : "WITHOUT TRAIL"}</small><h2>{guided ? "Evidence-routed agent" : "Baseline agent"}</h2></div>
        <span className={`lane-state ${running ? "running" : metrics?.verified ? "passed" : events.length ? "blocked" : "idle"}`}>
          {running ? "Running" : metrics?.verified ? "Release eligible" : events.length ? "Release blocked" : "Waiting"}
        </span>
      </div>
      <div className="event-stream">
        {events.length === 0 && <div className="empty-stream"><span>{guided ? "The trail appears here." : "Raw decisions appear here."}</span></div>}
        {events.map((event) => <EventCard key={`${event.runId}-${event.sequence}`} event={event} />)}
      </div>
      <div className="lane-metrics">
        <div><strong>{metrics?.toolCalls ?? "—"}</strong><span>tool calls</span></div>
        <div><strong>{metrics?.retries ?? "—"}</strong><span>retries</span></div>
        <div><strong>{metrics ? `${metrics.elapsedMs}ms` : "—"}</strong><span>elapsed</span></div>
        <div><strong>{metrics ? `$${metrics.estimatedCostUsd.toFixed(4)}` : "—"}</strong><span>API cost</span></div>
      </div>
    </section>
  );
}

function ProofView({ health }: { health: Health | null }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);

  useEffect(() => { void api<Benchmark>("/api/benchmarks/run", { method: "POST", body: "{}" }).then(setBenchmark).catch(() => undefined); }, []);

  const start = async (executor: "deterministic-fixture" | "openai-responses") => {
    setEvents([]); setRun(null); setError(""); setRunning(true);
    try {
      const created = await api<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ executor }) });
      const stream = eventStream(`/api/runs/${created.runId}/events`);
      stream.onmessage = (message) => setEvents((current) => [...current, JSON.parse(message.data) as RunEvent]);
      stream.addEventListener("complete", (message) => {
        const completed = JSON.parse((message as MessageEvent).data) as RunRecord;
        setRun(completed); setRunning(false); stream.close();
      });
      stream.onerror = () => { if (stream.readyState === EventSource.CLOSED) setRunning(false); };
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Run failed"); setRunning(false); }
  };

  const baselineEvents = events.filter((event) => event.side === "baseline");
  const guidedEvents = events.filter((event) => event.side === "guided");
  const selected = guidedEvents.find((event) => event.type === "retrieval");
  const baselineRate = benchmark ? Math.round(benchmark.metrics.baselineVerified.numerator / benchmark.metrics.baselineVerified.denominator * 100) : 0;
  const guidedRate = benchmark ? Math.round(benchmark.metrics.guidedVerified.numerator / benchmark.metrics.guidedVerified.denominator * 100) : 0;

  return (
    <div className="view proof-view">
      <section className="hero">
        <div>
          <p className="eyebrow">RUNTIME VERIFICATION FOR CODING AGENTS</p>
          <h1>Give the agent a trail.<br /><em>Require proof at every turn.</em></h1>
          <p className="hero-copy">TRAIL converts prior agent failures into machine-readable routes, retrieves only the routes that fit the current environment, and blocks release until the expected evidence exists.</p>
        </div>
        <div className="hero-actions">
          <button className="primary" disabled={running} onClick={() => void start("deterministic-fixture")}>{running ? "Proof running…" : "Run deterministic proof"}<span>→</span></button>
          <button className="secondary" disabled={running || !health?.liveAi} onClick={() => void start("openai-responses")}>Run live OpenAI pair</button>
          {!health?.liveAi && <p>Live run unavailable: <code>{health?.missing.join(", ") || "provider preflight"}</code>. Nothing is simulated as AI.</p>}
          {error && <p className="error-copy">{error}</p>}
        </div>
      </section>

      <section className="task-strip">
        <div><span>SHARED TASK</span><strong>Fix the production route, prove the visible result, and prepare the PR for release.</strong></div>
        <div><span>MODEL</span><strong>{health?.agentModel ?? "gpt-5.6-terra"}</strong></div>
        <div><span>START</span><strong>Same fixture / same budget</strong></div>
      </section>

      <div className="lane-grid">
        <AgentLane side="baseline" events={baselineEvents} metrics={run?.metrics.baseline} running={running} />
        <AgentLane side="guided" events={guidedEvents} metrics={run?.metrics.guided} running={running} />
      </div>

      <section className="proof-footer-grid">
        <div className="trail-match panel">
          <div className="panel-title"><span>RETRIEVED ROUTE</span><b>{selected ? "MATCHED" : "WAITING"}</b></div>
          <h3>{selected ? selected.message.replace(/^Retrieved | with environment-first routing\.$/g, "") : "No trail selected yet"}</h3>
          <p>{selected ? "The route was admitted after mandatory workspace and client checks, then ranked by intent and failure language." : "Start the paired proof to see environment-first retrieval and rejected near-matches."}</p>
        </div>
        <div className="pr-panel panel">
          <div className="panel-title"><span>PRE-MERGE STATUS</span><b className={run?.metrics.guided?.verified ? "green" : "amber"}>{run?.metrics.guided?.verified ? "PASS" : "NOT PUBLISHED"}</b></div>
          <h3><code>trail/verification</code></h3>
          <p>The local proof never impersonates GitHub. Use <code>trail verify-pr</code> with an exact repository and SHA to publish the real commit status.</p>
        </div>
      </section>

      <section className="benchmark panel">
        <div className="benchmark-heading">
          <div><p className="eyebrow">HACKATHON BENCHMARK · DETERMINISTIC FIXTURES</p><h2>The route layer changes the outcome.</h2></div>
          <p>{benchmark?.disclaimer ?? "Loading fixture benchmark…"}</p>
        </div>
        <div className="benchmark-metrics">
          <div><strong>{baselineRate}%</strong><span>Baseline verified</span><small>{benchmark ? `${benchmark.metrics.baselineVerified.numerator}/${benchmark.metrics.baselineVerified.denominator}` : "—"}</small></div>
          <div className="accent"><strong>{guidedRate}%</strong><span>Guided verified</span><small>{benchmark ? `${benchmark.metrics.guidedVerified.numerator}/${benchmark.metrics.guidedVerified.denominator}` : "—"}</small></div>
          <div><strong>{benchmark ? `${Math.round(benchmark.metrics.recallAt1 * 100)}%` : "—"}</strong><span>Recall@1</span><small>24 held-out prefixes</small></div>
          <div><strong>{benchmark?.metrics.mrr ?? "—"}</strong><span>MRR</span><small>Retrieval ranking</small></div>
          <div><strong>{benchmark?.metrics.unsafeApprovals.guided ?? "—"}</strong><span>Unsafe approvals</span><small>Guided condition</small></div>
        </div>
      </section>
    </div>
  );
}

function CorpusView({ trails }: { trails: Trail[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => trails.filter((trail) => [trail.title, trail.summary, trail.taskFamily, ...trail.tags].join(" ").toLowerCase().includes(query.toLowerCase())), [trails, query]);
  const families = new Set(trails.map((trail) => trail.taskFamily)).size;
  return (
    <div className="view content-view">
      <div className="page-heading"><div><p className="eyebrow">APPROVED, REDACTED, VERSIONED</p><h1>Trail corpus</h1><p>Not forum posts. Each entry is a route with applicability rules, hard evidence, invalidators, and provenance.</p></div><div className="heading-stats"><strong>{trails.length}</strong><span>reviewed trails</span><strong>{families}</strong><span>failure families</span></div></div>
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search intent, failure signature, or evidence…" /></label>
      <div className="corpus-grid">
        {visible.map((trail) => (
          <article className="trail-card" key={trail.id}>
            <div><span>{trail.taskFamily}</span><b>{Math.round(trail.confidence * 100)}% confidence</b></div>
            <h2>{trail.title}</h2><p>{trail.summary}</p>
            <ul>{trail.steps.slice(0, 2).flatMap((step) => step.evidence.slice(0, 1)).map((evidence) => <li key={evidence.id}>{evidence.description}</li>)}</ul>
            <footer><span>{trail.provenance.provider}</span><span>{trail.triggers.join(" · ")}</span></footer>
          </article>
        ))}
      </div>
    </div>
  );
}

function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function IngestView({ health, onApproved }: { health: Health | null; onApproved: (trail: Trail) => void }) {
  const [preview, setPreview] = useState<IngestionPreview | null>(null);
  const [draft, setDraft] = useState<Trail | null>(null);
  const [json, setJson] = useState("");
  const [records, setRecords] = useState<IngestionRecord[]>([]);
  const [sources, setSources] = useState<SourceInventory | null>(null);
  const [research, setResearch] = useState<ResearchCorpus | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const reloadIntake = async () => {
    const [ingestionResult, sourceResult, researchResult] = await Promise.all([
      api<{ ingestions: IngestionRecord[] }>("/api/ingestions"),
      api<SourceInventory>("/api/sources"),
      api<ResearchCorpus>("/api/research-corpus"),
    ]);
    setRecords(ingestionResult.ingestions);
    setSources(sourceResult);
    setResearch(researchResult);
  };

  useEffect(() => { void reloadIntake().catch(() => undefined); }, []);

  const select = async (id: string) => {
    setBusy(true); setMessage(null); setDraft(null); setJson("");
    try { setPreview(await api<IngestionPreview>(`/api/ingestions/${id}`)); }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load that ingestion." }); }
    finally { setBusy(false); }
  };

  const ingestFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setMessage(null); setDraft(null); setJson("");
    try {
      const bounded = files.slice(0, 8);
      const tooLarge = bounded.find((file) => file.size > 12 * 1024 * 1024);
      if (tooLarge) throw new Error(`${tooLarge.name} is larger than the 12 MB intake limit.`);
      const previews: IngestionPreview[] = [];
      for (const file of bounded) {
        const text = await file.text();
        previews.push(await api<IngestionPreview>("/api/ingestions/preview", {
          method: "POST",
          body: JSON.stringify({ sourceName: file.name, text }),
        }));
      }
      setPreview(previews[0] ?? null);
      setMessage({ tone: "success", text: `${previews.length} transcript${previews.length === 1 ? "" : "s"} redacted and added to review.` });
      await reloadIntake();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Intake failed." });
    } finally { setBusy(false); }
  };

  const loadSample = async () => {
    setBusy(true); setMessage(null); setDraft(null); setJson("");
    try {
      const result = await api<IngestionPreview>("/api/ingestions/sample", { method: "POST", body: "{}" });
      setPreview(result);
      setMessage({ tone: "info", text: "Sample Codex run loaded. Review the exact redacted payload below." });
      await reloadIntake();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Sample intake failed." }); }
    finally { setBusy(false); }
  };

  const scanSources = async () => {
    setScanning(true); setMessage(null);
    try {
      const result = await api<SourceInventory & { indexed: number }>("/api/sources/index", { method: "POST", body: "{}" });
      setSources(result);
      setMessage({ tone: "success", text: `Indexed metadata and route signals for ${result.indexed} local runs. Raw transcripts were not copied.` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Source scan failed." }); }
    finally { setScanning(false); }
  };

  const extract = async () => {
    if (!preview) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ trail: Trail }>(`/api/ingestions/${preview.id}/extract`, { method: "POST", body: "{}" });
      setDraft(result.trail); setJson(JSON.stringify(result.trail, null, 2));
      setMessage({ tone: "info", text: "Draft extracted. Nothing is trusted until you approve the contract." });
      await reloadIntake();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Extraction failed." }); }
    finally { setBusy(false); }
  };

  const startManualDraft = async () => {
    if (!preview) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ trail: Trail }>(`/api/ingestions/${preview.id}/draft-template`, { method: "POST", body: "{}" });
      setDraft(result.trail); setJson(JSON.stringify(result.trail, null, 2));
      setMessage({ tone: "info", text: "Manual template created. Replace every placeholder with evidence from the redacted payload before approval." });
      await reloadIntake();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not create a manual draft." }); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!draft) return;
    setBusy(true); setMessage(null);
    try {
      const parsed = JSON.parse(json) as Trail;
      const result = await api<{ trail: Trail; path: string }>(`/api/trails/${draft.id}/approve`, { method: "POST", body: JSON.stringify(parsed) });
      onApproved(result.trail);
      setMessage({ tone: "success", text: `Approved ${result.trail.id}. It is now eligible for retrieval.` });
      await reloadIntake();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "Approval failed." }); }
    finally { setBusy(false); }
  };

  const providers = new Map((sources?.providers ?? health?.sourceIndex.providers ?? []).map((item) => [item.provider, item]));
  const sourceTotal = sources?.total ?? health?.sourceIndex.total ?? 0;

  return (
    <div className="view content-view ingest-view">
      <div className="page-heading intake-heading">
        <div><p className="eyebrow">INGESTION CONTROL PLANE</p><h1>Make experience retrievable.</h1><p>Bring in real Codex and Claude runs, remove sensitive data locally, extract a strict route contract, and promote it only after human review.</p></div>
        <div className="heading-stats"><strong>{sourceTotal}</strong><span>runs indexed</span><strong>{records.length}</strong><span>review items</span></div>
      </div>

      <section className="pipeline-ribbon" aria-label="Ingestion lifecycle">
        <div className="complete"><span>01</span><b>Discover</b><small>Metadata + signals</small></div>
        <div className={preview ? "complete" : "active"}><span>02</span><b>Redact</b><small>Local privacy pass</small></div>
        <div className={draft ? "complete" : preview ? "active" : ""}><span>03</span><b>Structure</b><small>Draft route contract</small></div>
        <div className={records.some((record) => record.status === "approved") ? "complete" : draft ? "active" : ""}><span>04</span><b>Approve</b><small>Retrieval eligible</small></div>
      </section>

      <div className="source-grid">
        {["codex", "claude"].map((provider) => {
          const inventory = providers.get(provider);
          const detected = sources?.roots[provider as keyof SourceInventory["roots"]] ?? health?.sourceRoots?.[provider as keyof Health["sourceRoots"]];
          return <article className="source-card panel" key={provider}>
            <div className="source-card-top"><span className={`source-icon ${provider}`}>{provider === "codex" ? "C" : "A"}</span><span className={`connector-state ${detected ? "ready" : "missing"}`}><i />{detected ? "Detected" : "Not found"}</span></div>
            <h2>{provider === "codex" ? "Codex sessions" : "Claude projects"}</h2>
            <p>Index hashes, timestamps, size, and recovery signals. Transcript bodies stay at their original path.</p>
            <footer><strong>{inventory?.count ?? 0}</strong><span>runs</span><strong>{bytes(inventory?.bytes ?? 0)}</strong><span>observed</span></footer>
          </article>;
        })}
        <article className="source-card source-control panel">
          <div><span className="step-number">SOURCE DISCOVERY</span><h2>Refresh the local index</h2><p>Use the shortlist to find runs with corrections, tool failures, environment changes, and release evidence.</p></div>
          <button className="secondary" disabled={scanning} onClick={() => void scanSources()}>{scanning ? "Scanning…" : "Scan this device"}<span>↻</span></button>
        </article>
      </div>

      {message && <div className={`intake-message ${message.tone}`} role="status"><i />{message.text}</div>}

      <div className="intake-workspace">
        <section className="panel intake-queue">
          <div className="section-heading"><div><span className="step-number">01 · INTAKE</span><h2>Add trajectory data</h2></div><button className="text-button" disabled={busy} onClick={() => void loadSample()}>Try sample</button></div>
          <label className={`file-picker ${busy ? "busy" : ""}`}>
            <input type="file" multiple accept=".jsonl,.json,application/json" onChange={(event) => { void ingestFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
            <span className="upload-glyph">＋</span><b>{busy ? "Processing locally…" : "Drop or choose transcript files"}</b><small>Codex or Claude JSONL · up to 8 files · 12 MB each</small>
          </label>
          <div className="queue-heading"><span>Review queue</span><b>{records.length}</b></div>
          <div className="queue-list">
            {records.length === 0 && <p className="empty-queue">No intake records yet. Load the sample to test redaction without exposing private data.</p>}
            {records.slice(0, 8).map((record) => <button key={record.id} className={`queue-row ${preview?.id === record.id ? "selected" : ""}`} onClick={() => void select(record.id)}>
              <span className={`format-badge ${record.format}`}>{record.format.slice(0, 1).toUpperCase()}</span>
              <span className="queue-copy"><b>{record.sourceName}</b><small>{record.candidateSignals.length ? record.candidateSignals.join(" · ") : "No strong route signal"}</small></span>
              <span className={`review-status ${record.status}`}>{record.status}</span>
            </button>)}
          </div>
        </section>

        <section className="panel redaction-panel">
          <div className="section-heading"><div><span className="step-number">02 · PRIVACY REVIEW</span><h2>{preview ? preview.sourceName : "Redacted payload"}</h2></div>{preview && <span className={`format-label ${preview.format}`}>{preview.format}</span>}</div>
          {preview ? <>
            <div className="preview-meta"><b>{preview.redactionCount} REDACTIONS</b><span>{preview.candidateSignals.length} route signals</span><span>{preview.requiresReview ? "review required" : "clean pass"}</span></div>
            <pre>{preview.redactedText.slice(0, 12_000)}</pre>
          </> : <div className="redaction-empty"><span>⌁</span><h3>Select an intake record</h3><p>The exact text eligible for extraction will appear here. Secrets, personal paths, contact details, and repository URLs are removed first.</p></div>}
        </section>
      </div>

      <section className="panel approval-panel">
        <div className="approval-intro"><span className="step-number">03–04 · STRUCTURE + APPROVE</span><h2>Promote a reviewed contract</h2><p>Extraction uses <code>{health?.extractorModel ?? "gpt-5.6-luna"}</code> with <code>store: false</code>. A draft cannot enter retrieval until you validate and approve its evidence contract.</p></div>
        <div className="approval-actions">
          <span className={`ai-state ${health?.liveAi ? "ready" : "missing"}`}><i />{health?.liveAi ? "Extractor connected" : "Extractor needs OPENAI_API_KEY"}</span>
          <button className="text-button manual-draft" disabled={!preview || busy} onClick={() => void startManualDraft()}>Start manual draft</button>
          <button className="secondary" disabled={!preview || !health?.liveAi || busy} onClick={() => void extract()}>{busy ? "Working…" : "Extract draft trail"}<span>→</span></button>
        </div>
        {draft && <div className="contract-editor"><div><span>DRAFT CONTRACT</span><b>{draft.id}</b></div><textarea aria-label="Trail JSON" value={json} onChange={(event) => setJson(event.target.value)} /></div>}
        {draft && <div className="approval-submit"><p>Approval makes this redacted contract available to the runtime retriever. It does not publish raw transcript content.</p><button className="primary compact" disabled={busy} onClick={() => void approve()}>Approve into corpus <span>✓</span></button></div>}
      </section>

      <section className="trust-boundary panel">
        <div><span>RESEARCH DATA · {research?.status === "ready" ? "INDEXED" : "PINNED"}</span><h2>{research?.status === "ready" ? `${(research.stats?.uniqueSkills ?? research.source.expectedRows).toLocaleString()} unique skills, quarantined.` : `${(research?.source.expectedRows ?? 138_133).toLocaleString()} records pinned for import.`}</h2></div>
        <p>{research?.source.dataset ?? "External skill metadata"} can improve discovery, but it is never executable, trusted, or automatically promoted. Every route that reaches the runtime corpus still crosses the same redaction and human-review boundary.</p>
        <div className="trust-tags"><span>metadata only</span><span>license unresolved</span><span>risk scanned</span><span>no auto-install</span></div>
      </section>
    </div>
  );
}

function PolicyView({ policies, reload }: { policies: RetrievalPolicy[]; reload: () => Promise<void> }) {
  const active = policies.find((policy) => policy.status === "active");
  const [candidate, setCandidate] = useState<RetrievalPolicy | null>(policies.find((policy) => policy.status === "candidate") ?? null);
  const [evaluation, setEvaluation] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const propose = async () => {
    setBusy(true);
    try { const result = await api<{ policy: RetrievalPolicy }>("/api/policies/propose", { method: "POST", body: JSON.stringify({ reason: "Raise environment fidelity after wrong-checkout failures" }) }); setCandidate(result.policy); await reload(); } finally { setBusy(false); }
  };
  const evaluate = async () => {
    if (!candidate) return;
    setBusy(true);
    try { const result = await api<Record<string, unknown>>(`/api/policies/${candidate.id}/evaluate`, { method: "POST", body: "{}" }); setEvaluation(result); await reload(); } finally { setBusy(false); }
  };
  return (
    <div className="view content-view policy-view">
      <div className="page-heading"><div><p className="eyebrow">BOUNDED RECURSIVE SELF-IMPROVEMENT</p><h1>Change the route, not the agent’s authority.</h1><p>TRAIL may propose retrieval weights or an approved trail. The harness, system prompt, merge boundary, and tool permissions stay fixed.</p></div></div>
      <div className="policy-flow">
        <section className="policy-card active-policy"><span>ACTIVE POLICY · V{active?.version ?? 1}</span><h2>Environment-first retrieval</h2><WeightBars weights={active?.weights} /><p>{active?.reason}</p></section>
        <div className="flow-arrow">→</div>
        <section className="policy-card candidate-policy"><span>CANDIDATE</span><h2>{candidate ? `Policy v${candidate.version}` : "No pending proposal"}</h2>{candidate ? <WeightBars weights={candidate.weights} /> : <p>A proposal creates a new immutable version. The active policy is never edited in place.</p>}<button className="secondary" disabled={busy || Boolean(candidate)} onClick={() => void propose()}>Propose safer weights</button></section>
        <div className="flow-arrow">→</div>
        <section className="policy-card evaluation-policy"><span>HELD-OUT GATE</span><h2>{evaluation ? ((evaluation.accepted as boolean) ? "Adopted" : "Rolled back") : "Awaiting evaluation"}</h2><p>{evaluation ? String((evaluation.reasons as string[])[0]) : "Accept only if verified success improves, unsafe approvals remain zero, and no task family regresses."}</p><button className="primary compact" disabled={busy || !candidate || Boolean(evaluation)} onClick={() => void evaluate()}>Run policy gate <span>→</span></button></section>
      </div>
      <section className="boundary panel"><h2>Authority boundary</h2><div><span>Allowed</span><strong>Retrieval weights</strong><strong>Approved trail set</strong></div><div><span>Locked</span><strong>Harness source</strong><strong>System prompt</strong><strong>Merge action</strong><strong>Tool permissions</strong></div></section>
    </div>
  );
}

function WeightBars({ weights }: { weights: RetrievalPolicy["weights"] | undefined }) {
  if (!weights) return null;
  return <div className="weight-bars">{Object.entries(weights).map(([name, value]) => <div key={name}><span>{name}</span><i><b style={{ width: `${value * 100}%` }} /></i><strong>{Math.round(value * 100)}</strong></div>)}</div>;
}

export function App() {
  const [tab, setTab] = useState<Tab>("proof");
  const [health, setHealth] = useState<Health | null>(null);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [policies, setPolicies] = useState<RetrievalPolicy[]>([]);

  const load = async () => {
    const [healthResult, trailResult, policyResult] = await Promise.all([
      api<Health>("/api/health"), api<{ trails: Trail[] }>("/api/trails"), api<{ policies: RetrievalPolicy[] }>("/api/policies"),
    ]);
    setHealth(healthResult); setTrails(trailResult.trails); setPolicies(policyResult.policies);
  };
  useEffect(() => { void load(); }, []);

  return (
    <AppShell tab={tab} setTab={setTab} health={health}>
      {tab === "proof" && <ProofView health={health} />}
      {tab === "corpus" && <CorpusView trails={trails} />}
      {tab === "ingest" && <IngestView health={health} onApproved={(trail) => setTrails((current) => [trail, ...current.filter((item) => item.id !== trail.id)])} />}
      {tab === "policy" && <PolicyView policies={policies} reload={load} />}
    </AppShell>
  );
}
