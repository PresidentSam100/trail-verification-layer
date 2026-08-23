import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { assertInside, assertRegularFile, ensureSafeDirectory } from "./paths.js";

export function acquireCorpusLock(root: string, name: "download" | "index"): () => void {
  const locks = ensureSafeDirectory(root, resolve(root, "locks"));
  const path = assertInside(root, resolve(locks, `${name}.lock`));

  if (existsSync(path)) {
    assertRegularFile(path, `${name} lock`);
    try {
      JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`Invalid ${name} lock; inspect before removing: ${path}`);
    }
    throw new Error(`A skill-corpus ${name} lock already exists. Fail closed and inspect it before manual recovery: ${path}`);
  }

  let handle: number;
  try {
    handle = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Another skill-corpus ${name} operation started concurrently`);
    throw error;
  }
  const nonce = randomUUID();
  const body = Buffer.from(`${JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() })}\n`, "utf8");
  try {
    const written = writeSync(handle, body, 0, body.length, 0);
    if (written !== body.length) throw new Error(`Short write while acquiring ${name} lock`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (existsSync(path)) {
      assertRegularFile(path, `${name} lock`);
      const current = JSON.parse(readFileSync(path, "utf8")) as { nonce?: unknown };
      if (current.nonce !== nonce) throw new Error(`Refusing to release a ${name} lock owned by another process`);
      unlinkSync(path);
    }
  };
}
