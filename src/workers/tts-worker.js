import { KittenTTS, TextSplitterStream } from "../lib/kitten-tts.js";
import { detectWebGPU } from "../utils/utils.js";
import { getCachedModel } from "../utils/model-cache.js";

let tts = null;
let device = "wasm";

// Initialize the model
async function initializeModel(useWebGPU = false, modelUrl = null, voicesUrl = 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz', configUrl = null) {
  try {
    // Device detection
    const webGPUSupported = await detectWebGPU();
    device = (useWebGPU && webGPUSupported) ? "webgpu" : "wasm";

    self.postMessage({ status: "device", device });

    if (!modelUrl) {
      self.postMessage({ status: "error", data: "No model URL provided" });
      return;
    }

    // Try to get cached model first
    const cachedModelUrl = await getCachedModel(modelUrl);
    if (!cachedModelUrl) {
      self.postMessage({ status: "error", data: "Model not found in cache. Please download the model first." });
      return;
    }

    console.log('Loading model from cached URL:', cachedModelUrl);
    console.log('Using voices URL:', voicesUrl);
    console.log('Using config URL:', configUrl);

    // Load the model from cache with dynamic voices URL
    tts = await KittenTTS.from_pretrained(cachedModelUrl, {
      device,
      voicesUrl: voicesUrl,
      configUrl: configUrl
    });

    console.log('Model loaded successfully, voices:', tts.voices);

    self.postMessage({ status: "ready", voices: tts.voices, device });
  } catch (e) {
    console.error("Error loading model:", e);
    self.postMessage({ status: "error", data: e.message });
  }
}

// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  const { type, useWebGPU, modelUrl, voicesUrl, configUrl, text, voice, speed, sampleRate = 24000 } = e.data;

  // Handle initialization
  if (type === 'init') {
    await initializeModel(useWebGPU, modelUrl, voicesUrl, configUrl);
    return;
  }

  // Handle TTS generation
  if (!tts) {
    self.postMessage({ status: "error", data: "Model not initialized" });
    return;
  }

  const streamer = new TextSplitterStream();

  streamer.push(text);
  streamer.close(); // Indicate we won't add more text

  const stream = tts.stream(streamer, { voice, speed });
  console.log('Worker: Created stream, starting generation for voice:', voice);
  const chunks = [];

  try {
    console.log('Worker: Starting stream iteration...');
    for await (const { text, audio } of stream) {
      console.log('Worker: Received chunk for text:', text, 'audio length:', audio.audio.length);
      self.postMessage({
        status: "stream",
        chunk: {
          audio: audio.toBlob(),
          text,
        },
      });
      chunks.push(audio);
    }
    console.log('Worker: Stream iteration completed, total chunks:', chunks.length);
  } catch (error) {
    console.error("Error during streaming:", error);
    console.error("Error stack:", error.stack);
    self.postMessage({ status: "error", data: error.message });
    return;
  }

  // Merge chunks
  let audio;
  if (chunks.length > 0) {
    try {
      const originalSamplingRate = chunks[0].sampling_rate;
      const length = chunks.reduce((sum, chunk) => sum + chunk.audio.length, 0);
      let waveform = new Float32Array(length);
      let offset = 0;
      for (const { audio } of chunks) {
        waveform.set(audio, offset);
        offset += audio.length;
      }

      // Normalize peaks & trim silence
      normalizePeak(waveform, 0.9);
      waveform = trimSilence(waveform, 0.002, Math.floor(originalSamplingRate * 0.02)); // 20ms padding

      // Resample if needed
      if (sampleRate !== originalSamplingRate) {
        // Apply anti-aliasing filter for downsampling
        if (sampleRate < originalSamplingRate) {
          waveform = antiAliasFilter(waveform, originalSamplingRate, sampleRate);
        }

        waveform = resampleLinear(waveform, originalSamplingRate, sampleRate);
      }

      // Create a new merged RawAudio with the target sample rate
      audio = new chunks[0].constructor(waveform, sampleRate);
    } catch (error) {
      console.error("Error processing audio chunks:", error);
      self.postMessage({ status: "error", data: error.message });
      return;
    }
  }

  self.postMessage({ status: "complete", audio: audio?.toBlob() });
});

function normalizePeak(f32, target = 0.9) {
  if (!f32?.length) return;
  let max = 1e-9;
  for (let i = 0; i < f32.length; i++) max = Math.max(max, Math.abs(f32[i]));
  const g = Math.min(4, target / max);
  if (g < 1) {
    for (let i = 0; i < f32.length; i++) f32[i] *= g;
  }
}

function trimSilence(f32, thresh = 0.002, minSamples = 480) {
  let s = 0,
      e = f32.length - 1;
  while (s < e && Math.abs(f32[s]) < thresh) s++;
  while (e > s && Math.abs(f32[e]) < thresh) e--;
  s = Math.max(0, s - minSamples);
  e = Math.min(f32.length, e + minSamples);
  return f32.slice(s, e);
}

function antiAliasFilter(input, inRate, outRate) {
  const cutoff = Math.min(outRate / 2, inRate / 2) * 0.9;
  const nyquist = inRate / 2;
  const normalizedCutoff = cutoff / nyquist;

  const a = Math.exp(-2 * Math.PI * normalizedCutoff);
  const output = new Float32Array(input.length);

  output[0] = input[0] * (1 - a);
  for (let i = 1; i < input.length; i++) {
    output[i] = input[i] * (1 - a) + output[i - 1] * a;
  }

  return output;
}

function resampleLinear(input, inRate, outRate) {
  if (inRate === outRate) return input;
  const ratio = outRate / inRate;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}
