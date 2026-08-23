import { execFileSync } from "node:child_process";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const shaPattern = /^[a-f0-9]{7,40}$/i;

export function publishVerificationStatus(input: { repo: string; sha: string; state: "pending" | "success" | "failure"; description: string; targetUrl?: string }) {
  if (!repoPattern.test(input.repo)) throw new Error("Repository must be owner/name.");
  if (!shaPattern.test(input.sha)) throw new Error("Commit SHA must be 7-40 hexadecimal characters.");
  const args = ["api", `repos/${input.repo}/statuses/${input.sha}`, "--method", "POST", "-f", `state=${input.state}`, "-f", "context=trail/verification", "-f", `description=${input.description.slice(0, 140)}`];
  if (input.targetUrl) args.push("-f", `target_url=${input.targetUrl}`);
  const output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output) as { state: string; context: string; target_url: string | null };
}
