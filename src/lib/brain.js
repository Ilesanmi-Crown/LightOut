// Offline Brain: self-test and device-vs-cloud benchmark. All calls go through Firebase AI Logic.
import { runPrompt, getOnDeviceStatus, InferenceMode, InferenceSource } from "../ai.js";
import { SAMPLE_NOTES } from "../sampleNotes.js";

/** Tiny ONLY_ON_DEVICE prompt. Returns { pass, ms, text } or { pass: false, error }. */
export async function testOfflineBrain() {
  const status = await getOnDeviceStatus();
  if (status !== "available") {
    return {
      pass: false,
      status,
      reason:
        status === "downloadable" || status === "downloading"
          ? "The offline brain isn't downloaded yet."
          : "This browser can't run the offline brain.",
    };
  }
  try {
    const { text, ms, source } = await runPrompt({
      taskKey: "ask",
      parts: [{ text: "Reply with the word READY" }],
      mode: InferenceMode.ONLY_ON_DEVICE,
      label: "self-test",
      countSavings: false,
    });
    return { pass: /\bready\b/i.test(text) && source === InferenceSource.ON_DEVICE, ms, text: text.trim().slice(0, 120) };
  } catch (error) {
    return { pass: false, error };
  }
}

// A short, fixed prompt so both sides do identical work.
const BENCH_NOTES = SAMPLE_NOTES.split("\n").slice(0, 14).join("\n");
const benchParts = () => [
  {
    text: `Summarize these lecture notes in 3 short bullet points.\n\nNOTES:\n"""\n${BENCH_NOTES}\n"""`,
  },
];

/**
 * Runs the same short summarize prompt once ONLY_ON_DEVICE, then once ONLY_IN_CLOUD.
 * Returns { device: { ms, bytes } | { error }, cloud: { ms, bytes } | { error } }.
 */
export async function runBenchmark() {
  const out = {};
  for (const [key, mode] of [
    ["device", InferenceMode.ONLY_ON_DEVICE],
    ["cloud", InferenceMode.ONLY_IN_CLOUD],
  ]) {
    try {
      const r = await runPrompt({ taskKey: "summarize", parts: benchParts(), mode, label: "benchmark", countSavings: false });
      out[key] = { ms: r.ms, bytes: r.requestBytes + r.responseBytes, chars: r.text.length };
    } catch (error) {
      out[key] = { error };
    }
  }
  return out;
}
