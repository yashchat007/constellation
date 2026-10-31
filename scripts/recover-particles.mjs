import fs from "fs";
const p =
  "C:/Users/Yash/.cursor/projects/c-Users-Yash-Desktop-Constellation/agent-transcripts/a48e8b40-9633-47a1-baf2-5bd0dd16b02f/a48e8b40-9633-47a1-baf2-5bd0dd16b02f.jsonl";
const lines = fs.readFileSync(p, "utf8").split("\n");
let best = null;
for (const line of lines) {
  if (!line.includes("constellation\\\\particles.ts")) continue;
  try {
    const j = JSON.parse(line);
    for (const part of j.message?.content ?? []) {
      if (part.type !== "tool_use") continue;
      const path = part.input?.path ?? "";
      if (!path.replace(/\\/g, "/").endsWith("src/constellation/particles.ts")) continue;
      if ((part.input.contents ?? "").includes("createStarField")) {
        best = part.input.contents;
      }
    }
  } catch {
    /* skip */
  }
}
if (!best) {
  console.error("not found");
  process.exit(1);
}
fs.writeFileSync("src/constellation/particles.ts", best);
console.log("restored", best.length, "chars");
