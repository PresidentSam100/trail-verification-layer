import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TrailSchema, type Trail } from "@trail/contracts";
import { config } from "./config.js";
import { TrailDatabase } from "./database.js";

export function loadCorpus(db: TrailDatabase) {
  mkdirSync(config.corpusPath, { recursive: true });
  let count = 0;
  for (const name of readdirSync(config.corpusPath).filter((file) => file.endsWith(".json"))) {
    const body = JSON.parse(readFileSync(join(config.corpusPath, name), "utf8")) as unknown;
    const entries = Array.isArray(body) ? body : [body];
    for (const entry of entries) {
      const trail = TrailSchema.parse(entry);
      db.upsertTrail(trail);
      count += 1;
    }
  }
  return count;
}

export function publishTrail(db: TrailDatabase, draft: Trail) {
  const approved = TrailSchema.parse({ ...draft, reviewStatus: "approved", reviewedAt: new Date().toISOString() });
  db.upsertTrail(approved);
  mkdirSync(config.corpusPath, { recursive: true });
  const path = join(config.corpusPath, `${approved.id}.trail.json`);
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify(approved, null, 2)}\n`, { flag: "wx" });
  return { trail: approved, path };
}
