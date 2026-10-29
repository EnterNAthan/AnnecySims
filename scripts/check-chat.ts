import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { Intelligence } from "../src/sim/intelligence";
import { chat } from "../server/chat";
import { DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";
import type { ResidentChat } from "../src/shared/chat";

const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), {
  residents: 100, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29"),
});
const intelligence = new Intelligence(engine);
const requests: any[] = [];
let fail = false;
globalThis.fetch = async (_url, options) => {
  const input = JSON.parse(String(options?.body)); requests.push(input);
  if (fail) return Response.json({ error: "Arkane indisponible" }, { status: 502 });
  return Response.json({ biography: "J'ai grandi près du lac.", reply: "Bonjour, j'aime mon quartier." });
};
let state: ResidentChat | undefined;
const publish = (value: ResidentChat) => { state = value; };
await intelligence.converse(0, "Raconte ton histoire", publish);
assert.equal(state?.messages.length, 2);
await intelligence.converse(0, "Et ton quartier ?", publish);
assert.equal(requests[1].biography, "J'ai grandi près du lac.");
assert.equal(requests[1].messages.length, 3);
await intelligence.converse(2, "Bonjour", publish);
assert.equal(requests[2].biography, "");
assert.equal(requests[2].messages.length, 1);
assert.ok(intelligence.inspect(0).memories.some((m) => m.includes("visiteur")));
await intelligence.converse(1, "Bonjour", publish);
assert.match(state!.error!, /habitant IA/);
fail = true;
await intelligence.converse(0, "Réessaie", publish);
assert.equal(state!.busy, false);
assert.equal(state!.messages.length, 4);
assert.match(state!.error!, /indisponible/);

let provider: any;
globalThis.fetch = async (_url, options) => {
  provider = JSON.parse(String(options?.body));
  return Response.json({ choices: [{ message: { content: JSON.stringify({ biography: "Histoire stable", reply: "Bonjour !" }) } }] });
};
const result = await chat(requests[0], { ARKANE_API_KEY: "test-only" }, DEFAULT_AI_CONFIG);
assert.equal(result.reply, "Bonjour !");
assert.equal(provider.model, DEFAULT_AI_CONFIG.model);
assert.equal(provider.reasoning_effort, "none");
assert.equal(provider.messages.at(-1).content, "Raconte ton histoire");
await assert.rejects(chat({ ...requests[0], messages: [] }, { ARKANE_API_KEY: "test-only" }, DEFAULT_AI_CONFIG));
console.log("Chat : identité, historique isolé, biographie stable, mémoire, erreurs et adaptateur Arkane : OK");
