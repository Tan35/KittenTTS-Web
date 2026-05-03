/* eslint-disable no-undef */

// KittenTTS v0.8 Engine — based on mualat/kittentts-web implementation
// Supports: Nano v0.8 (15M), Micro v0.8 (40M), Mini v0.8 (80M)
// Backend: ONNX Runtime Web (WASM primary, WebGPU optional)

import { loadVoicesNpz } from './npz-loader.js';

// ── TextCleaner vocabulary from KittenTTS (identical to official onnx_model.py) ──
const _pad = '$';
// Exact copy from mualat phonemizer.ts line 10 — must match character-for-character
// (Previous version had \xC2\xA1 which produced stray "Â" chars, shifting ALL token IDs)
const _punctuation = ';:,.!?\u00A1\u00BF\u2014\u2026\"\u00AB\u00BB\"\" ';
const _letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// mualat official _letters_ipa from phonemizer.ts line 12 — 109 IPA characters
const _letters_ipa = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

// NOTE: mualat does NOT use _ipa_ext — only these 4 parts:
//   _pad + _punctuation + _letters + _letters_ipa
// Adding _ipa_ext would shift all token IDs and break model output.

const SYMBOLS = [_pad, ...Array.from(_punctuation), ...Array.from(_letters), ...Array.from(_letters_ipa)];

const WORD_INDEX_DICT = {};
SYMBOLS.forEach((sym, i) => { WORD_INDEX_DICT[sym] = i; });

// Fallback voice mapping (used if config.json is not available)
const DEFAULT_VOICE_MAP = {
  'Bella': 'expr-voice-2-f',
  'Jasper': 'expr-voice-2-m',
  'Luna': 'expr-voice-3-f',
  'Bruno': 'expr-voice-3-m',
  'Rosie': 'expr-voice-4-f',
  'Hugo': 'expr-voice-4-m',
  'Kiki': 'expr-voice-5-f',
  'Leo': 'expr-voice-5-m',
};

// Default speed priors per voice (from KittenTTS Python)
const DEFAULT_SPEED_PRIORS = {
  'expr-voice-2-f': 0.8,
  'expr-voice-2-m': 0.8,
  'expr-voice-3-m': 0.8,
  'expr-voice-3-f': 0.8,
  'expr-voice-4-m': 0.9,
  'expr-voice-4-f': 0.8,
  'expr-voice-5-m': 0.8,
  'expr-voice-5-f': 0.8,
};


// ── Text Splitter Stream ──
export class TextSplitterStream {
  constructor() {
    this.chunks = [];
    this.closed = false;
  }

  chunkText(text) {
    const lines = text.split('\n');
    const chunks = [];
    for (const line of lines) {
      if (line.trim() === '') continue;
      const endsWithPunctuation = /[.!?]$/.test(line.trim());
      const processedLine = endsWithPunctuation ? line : line.trim() + '.';
      const sentences = processedLine.split(/(?<=[.!?])(?=\s+|$)/);
      for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        if (trimmedSentence) chunks.push(trimmedSentence);
      }
    }
    return chunks;
  }

  push(text) {
    const sentences = this.chunkText(text) || [text];
    this.chunks.push(...sentences);
  }

  close() {
    this.closed = true;
  }

  async *[Symbol.asyncIterator]() {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}


// ── RawAudio: WAV encoding ──
export class RawAudio {
  constructor(audio, sampling_rate) {
    this.audio = audio;
    this.sampling_rate = sampling_rate;
  }

  get length() {
    return this.audio.length;
  }

  toBlob() {
    const buffer = this.encodeWAV(this.audio, this.sampling_rate);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    this.floatTo16BitPCM(view, 44, samples);
    return buffer;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  }
}


// ── Brotli decompression helper for .onnx.br files ──
function copyU8ForWasm(bytes) {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

function looksLikeOnnxModelProto(u8) {
  return u8.length >= 8 && u8[0] === 0x08;
}

async function decompressBrotli(bytes) {
  const blob = new Blob([new Uint8Array(bytes)]);
  // @ts-expect-error CompressionFormat 'br' is valid at runtime in Chromium
  const stream = blob.stream().pipeThrough(new DecompressionStream('br'));
  const ab = await new Response(stream).arrayBuffer();
  return copyU8ForWasm(new Uint8Array(ab));
}

async function loadModelBytes(modelPath) {
  if (!modelPath.endsWith('.br')) {
    // Plain .onnx — return URL string for ORT to fetch directly (best for caching)
    return modelPath;
  }

  // .onnx.br — fetch and decompress
  const response = await fetch(modelPath);
  if (!response.ok) throw new Error(`Failed to fetch model: ${response.statusText}`);
  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // If server already applied Content-Encoding: br, body is plain ONNX
  if (looksLikeOnnxModelProto(bytes)) {
    return copyU8ForWasm(bytes);
  }

  try {
    const out = await decompressBrotli(bytes);
    if (!looksLikeOnnxModelProto(out)) {
      throw new Error('Brotli output does not look like ONNX ModelProto');
    }
    return out;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not Brotli-decompress .onnx.br. Use a Chromium-based browser, ` +
      `or point to a plain .onnx file instead. (${detail})`
    );
  }
}


// ── Basic English Tokenizer (mirrors mualat's basicEnglishTokenize.ts) ──
// JS \w omits many IPA letters; use explicit Unicode categories like Python re \w+|[^\w\s]
const BASIC_ENGLISH_TOKEN = /[\p{L}\p{M}\p{N}\p{Pc}]+|[^\p{L}\p{M}\p{N}\p{Pc}\s]/gu;

function basicEnglishTokenize(text) {
  return text.match(BASIC_ENGLISH_TOKEN) || [];
}

// ── Text preprocessing helpers (from mualat's preprocess.ts) ──
function ensurePunctuation(text) {
  text = text.trim();
  if (!text) return text;
  const lastChar = text[text.length - 1];
  if (!'.!?,;:'.includes(lastChar)) {
    text = text + ',';
  }
  return text;
}

// ── TextPreprocessor (full port from mualat/preprocess.ts) ──
// Handles: lowercase, contraction expansion, number→words, URL/email/HTML removal
const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALE = ["", "thousand", "million", "billion", "trillion"];

function threeDigitsToWords(n) {
  if (n === 0) return "";
  const parts = [];
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
  if (remainder < 20) {
    if (remainder) parts.push(ONES[remainder]);
  } else {
    const tensWord = TENS[Math.floor(remainder / 10)];
    const onesWord = ONES[remainder % 10];
    parts.push(onesWord ? `${tensWord}-${onesWord}` : tensWord);
  }
  return parts.join(" ");
}

function numberToWords(n) {
  if (n === 0) return "zero";
  if (n < 0) return `negative ${numberToWords(-n)}`;
  if (n >= 100 && n <= 9999 && n % 100 === 0 && n % 1000 !== 0) {
    const hundreds = n / 100;
    if (hundreds < 20) return `${ONES[hundreds]} hundred`;
  }
  const parts = [];
  for (let i = 0; i < SCALE.length && n > 0; i++) {
    const chunk = n % 1000;
    if (chunk) {
      const chunkWords = threeDigitsToWords(chunk);
      parts.push(SCALE[i] ? `${chunkWords} ${SCALE[i]}`.trim() : chunkWords);
    }
    n = Math.floor(n / 1000);
  }
  return parts.reverse().join(" ");
}

function floatToWords(value) {
  const text = typeof value === 'string' ? value : value.toString();
  const negative = text.startsWith("-");
  const absText = negative ? text.slice(1) : text;
  if (absText.includes(".")) {
    const [intPart, decPart] = absText.split(".");
    const intWords = intPart ? numberToWords(parseInt(intPart)) : "zero";
    const digitMap = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const decWords = decPart.split("").map(d => digitMap[parseInt(d)]).join(" ");
    return negative ? `negative ${intWords} point ${decWords}` : `${intWords} point ${decWords}`;
  }
  const result = numberToWords(parseInt(absText));
  return negative ? `negative ${result}` : result;
}

class TextPreprocessor {
  constructor() {
    this.config = {
      lowercase: true,
      replaceNumbers: true,
      expandContractions: true,
      removeUrls: true,
      removeEmails: true,
      removeHtml: true,
      removeExtraWhitespace: true,
    };
  }

  process(text) {
    let result = text;
    if (this.config.removeHtml) result = result.replace(/<[^>]+>/g, " ");
    if (this.config.removeUrls) result = result.replace(/https?:\/\/\S+|www\.\S+/g, "");
    if (this.config.removeEmails) result = result.replace(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, "");
    if (this.config.expandContractions) result = this.expandContractions(result);
    if (this.config.replaceNumbers) result = this.replaceNumbers(result);
    if (this.config.lowercase) result = result.toLowerCase();
    if (this.config.removeExtraWhitespace) result = result.replace(/\s+/g, " ").trim();
    return result;
  }

  expandContractions(input) {
    let result = input;
    const contractions = [
      [/\bcan't\b/gi, "cannot"], [/\bwon't\b/gi, "will not"],
      [/\bshan't\b/gi, "shall not"], [/\bain't\b/gi, "is not"],
      [/\blet's\b/gi, "let us"], [/\bit's\b/gi, "it is"],
      [/\b(\w+)n't\b/gi, "$1 not"], [/\b(\w+)'re\b/gi, "$1 are"],
      [/\b(\w+)'ve\b/gi, "$1 have"], [/\b(\w+)'ll\b/gi, "$1 will"],
      [/\b(\w+)'d\b/gi, "$1 would"], [/\b(\w+)'m\b/gi, "$1 am"],
    ];
    for (const [pattern, replacement] of contractions) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  replaceNumbers(input) {
    let text = input;
    text = text.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n) => ordinalToWords(parseInt(n)));
    text = text.replace(/(-?[\d,]+(?:\.\d+)?)\s*%/g, (_, num) => {
      const raw = num.replace(/,/g, "");
      return raw.includes(".") ? `${floatToWords(raw)} percent` : `${numberToWords(parseInt(raw))} percent`;
    });
    text = text.replace(/([$€£¥])\s*([\d,]+(?:\.\d+)?)/g, (_, symbol, num) => {
      const currencyMap = { "$": "dollar", "€": "euro", "£": "pound", "¥": "yen" };
      const unit = currencyMap[symbol] || "";
      const raw = num.replace(/,/g, "");
      const val = parseInt(raw);
      if (raw.includes(".")) { /* currency with decimals */ }
      return `${numberToWords(val)} ${unit}${val !== 1 ? 's' : ''}`;
    });
    text = text.replace(/(?<![a-zA-Z])-?[\d,]+(?:\.\d+)?/g, (m) => {
      const raw = m.replace(/,/g, "");
      try {
        return raw.includes(".") ? floatToWords(raw) : numberToWords(parseInt(raw));
      } catch { return m; }
    });
    return text;
  }
}

function ordinalToWords(n) {
  const word = numberToWords(n);
  const exceptions = {
    "one": "first", "two": "second", "three": "third", "fourth": "fourth",
    "five": "fifth", "six": "sixth", "seven": "seventh", "eight": "eighth",
    "nine": "ninth", "twelfth": "twelfth",
  };
  if (word.includes("-")) {
    const [prefix, last] = word.split("-");
    const ex = exceptions[last] || (last.endsWith("e") ? last.slice(0, -1) + "th" : last + "th");
    return `${prefix}-${ex}`;
  }
  for (const [base, ord] of Object.entries(exceptions)) { if (word === base) return ord; }
  if (word.endsWith("t")) return word + "h";
  if (word.endsWith("e")) return word.slice(0, -1) + "th";
  return word + "th";
}

// Global preprocessor instance
const preprocessor = new TextPreprocessor();


// ── TextCleaner: phoneme characters → token IDs (KittenTTS vocabulary) ──
function textCleaner(phonemes) {
  const indexes = [];
  for (const char of phonemes) {
    const idx = WORD_INDEX_DICT[char];
    if (idx !== undefined) {
      indexes.push(idx);
    } else {
      // Skip unknown characters silently
    }
  }
  return indexes;
}


// ── KittenTTS Main Class ──
export class KittenTTS {
  constructor(voices, session, voiceEmbeddings, tokenizerData) {
    this.voices = voices || [];
    this.session = session;
    this.voiceEmbeddings = voiceEmbeddings || {};   // Map<name, Float32Array[]>
    this.tokenizerData = tokenizerData;
    this.wasmSession = null;
    // v0.8: voice map for display name → internal ID resolution
    this.voiceMap = { ...DEFAULT_VOICE_MAP };
    this.speedPriors = { ...DEFAULT_SPEED_PRIORS };
  }

  static async from_pretrained(model_path, options = {}) {
    try {
      const ort = await import('onnxruntime-web');

      // Configure WASM paths
      ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}onnx-runtime/`;

      // ── Step 1: Load model bytes (supports .onnx and .onnx.br) ──
      console.log('[KittenTTS] Loading model from:', model_path);
      let modelData;
      try {
        modelData = await loadModelBytes(model_path);
      } catch (e) {
        console.error('[KittenTTS] Failed to load model bytes:', e);
        throw e;
      }

      // ── Step 2: Create ONNX session (mualat-style config) ──
      let session;
      try {
        // Try WebGPU first if requested
        if (options.device === 'webgpu') {
          session = await ort.InferenceSession.create(modelData, {
            executionProviders: [
              {
                name: 'webgpu',
                deviceType: 'gpu',
                powerPreference: 'high-performance',
              },
              'wasm'
            ],
            optimizationLevel: 'all',
            enableProfiling: false
          });
        } else {
          throw new Error('Using WASM');
        }
      } catch (webgpuError) {
        // WASM backend — follows mualat's proven config
        session = await ort.InferenceSession.create(modelData, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',     // mualat uses 'all'
        });
      }

      console.log('[KittenTTS] ONNX session created. Inputs:', session.inputNames, 'Outputs:', session.outputNames);

      // ── Step 3: Load voices (support both JSON and NPZ formats) ──
      let voiceEmbeddings = {};
      let displayVoices = [];
      const voicesUrl = options.voicesUrl || 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz';

      if (voicesUrl.endsWith('.npz')) {
        // v0.8 format: NPZ file → Map<string, Float32Array[]>
        console.log('[KittenTTS] Loading voices from NPZ:', voicesUrl);
        try {
          const npzMap = await loadVoicesNpz(voicesUrl);
          // Convert Map to plain object so bracket notation works everywhere
          voiceEmbeddings = Object.fromEntries(npzMap.entries());
          // Build display voice list from DEFAULT_VOICE_MAP display names (like mualat)
          // Note: use DEFAULT_VOICE_MAP here because local 'voiceMap' isn't declared until Step 4
          displayVoices = Object.keys(DEFAULT_VOICE_MAP).map(name => ({
            id: name,
            name: name  // Display names: Bella, Jasper, Luna, etc.
          }));
          console.log(`[KittenTTS] NPZ loaded: ${npzMap.size} voices, keys:`, [...npzMap.keys()]);
        } catch (npzError) {
          console.warn('[KittenTTS] Failed to load NPZ voices, using fallback:', npzError);
        }
      } else {
        // Legacy format: JSON file
        console.log('[KittenTTS] Loading voices from JSON:', voicesUrl);
        try {
          const voicesResponse = await fetch(voicesUrl);
          if (voicesResponse.ok) {
            const voicesData = await voicesResponse.json();

            // Handle different JSON structures
            if (voicesData.voices) voicesData = voicesData.voices;

            const firstKey = Object.keys(voicesData)[0];
            const firstValue = voicesData[firstKey];

            if (Array.isArray(firstValue)) {
              // Raw embedding arrays
              voiceEmbeddings = voicesData;
              displayVoices = Object.keys(voicesData).map(key => ({
                id: key,
                name: key
              }));
            } else {
              // Structured voice objects with names
              Object.keys(voicesData).forEach(key => {
                const entry = voicesData[key];
                const name = (entry && typeof entry === 'object' && entry.name)
                  ? entry.name : key;
                displayVoices.push({ id: key, name });
              });
              voiceEmbeddings = voicesData;
            }
          }
        } catch (jsonError) {
          console.warn('[KittenTTS] Failed to load JSON voices:', jsonError);
        }
      }

      // ── Step 4: Load v0.8 config (voice aliases & speed priors) ──
      let speedPriors = { ...DEFAULT_SPEED_PRIORS };
      let voiceMap = { ...DEFAULT_VOICE_MAP };

      try {
        const configUrl = options.configUrl || 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/config.json';
        const configResp = await fetch(configUrl);
        if (configResp.ok) {
          const config = await configResp.json();
          if (config.voice_aliases) voiceMap = { ...DEFAULT_VOICE_MAP, ...config.voice_aliases };
          if (config.speed_priors) speedPriors = { ...DEFAULT_SPEED_PRIORS, ...config.speed_priors };
          console.log('[KittenTTS] Loaded config:', config.name, 'v' + config.version);
        }
      } catch (cfgErr) {
        console.log('[KittenTTS] No config found, using defaults');
      }

      // Fallback: ensure we have some voices even if loading failed
      if (displayVoices.length === 0) {
        displayVoices = Object.keys(DEFAULT_VOICE_MAP).map(name => ({
          id: DEFAULT_VOICE_MAP[name],
          name: name
        }));
      }

      const tts = new KittenTTS(displayVoices, session, voiceEmbeddings, null);
      tts.voiceMap = voiceMap;
      tts.speedPriors = speedPriors;

      console.log(`[KittenTTS] Ready. Voices: ${displayVoices.map(v => v.name).join(', ')}`);
      return tts;

    } catch (error) {
      console.error('[KittenTTS] Error loading model:', error);
      return new KittenTTS();
    }
  }

  // Resolve display name (e.g., "Bella") to internal ID (e.g., "expr-voice-2-f")
  resolveVoiceName(voice) {
    return this.voiceMap[voice] || voice;
  }

  // Get voice embedding — selects embedding index based on text length (mualat pattern)
  getVoiceEmbedding(voice, textLength) {
    const internalVoice = this.resolveVoiceName(voice);
    const embeddings = this.voiceEmbeddings[internalVoice];

    if (!embeddings || embeddings.length === 0) {
      console.warn(`[KittenTTS] Voice "${internalVoice}" not found, using zeros`);
      return new Float32Array(256);
    }

    // Select embedding by text length (mualat's approach)
    const refId = Math.min(textLength, embeddings.length - 1);
    const embedding = embeddings[refId];

    if (!embedding || embedding.length !== 256) {
      console.warn(`[KittenTTS] Invalid embedding at index ${refId}, using zeros`);
      return new Float32Array(256);
    }

    return embedding;
  }

  // Tokenize text: preprocess → ensurePunct → phonemize → tokenize → clean → add start/end tokens
  // This mirrors mualat's synthesizeChunk() pipeline EXACTLY (preprocess + phonemizeText)
  async tokenizeText(text) {
    // Step 1: Full text preprocessing (mualat's TextPreprocessor.process)
    // - lowercase, expand contractions (It's → it is), numbers → words, remove URLs/HTML
    let cleaned = preprocessor.process(text);
    console.log('[KittenTTS] Preprocessed:', cleaned);

    if (!cleaned) {
      return [0, 10, 0]; // start, end tokens for empty text
    }

    // Step 2: Ensure punctuation at end (mualat's ensurePunctuation)
    cleaned = ensurePunctuation(cleaned);

    // Step 3: Phonemize using eSpeak NG (mualat's espeakPhonemize)
    const { phonemize } = await import('phonemizer');
    const results = await phonemize(cleaned, 'en-us');

    // eSpeak returns one string per clause. Join ALL clauses with space (mualat pattern).
    // Using only results[0] drops the rest → cropped/incomplete speech.
    const ipa = results
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
      .trim();

    console.log('[KittenTTS] IPA:', ipa);

    // Step 4: Tokenize the IPA (mualat's basicEnglishTokenize)
    // Splits into word-like tokens and individual punctuation — critical for correct encoding!
    const tokens = basicEnglishTokenize(ipa);
    const phonemes = tokens.join(' ');

    console.log('[KittenTTS] Tokens:', tokens);
    console.log('[KittenTTS] Phonemes:', phonemes);

    // Step 5: Convert phoneme characters to token IDs using TextCleaner vocabulary
    let ids = textCleaner(phonemes);

    // Step 6: Add start/end tokens: [0] at start, [10, 0] at end (mualat pattern)
    ids.unshift(0);    // Start token ($)
    ids.push(10);      // End token 1 (,)
    ids.push(0);       // End token 2 ($)

    console.log('[KittenTTS] Token IDs:', ids, '(length:', ids.length + ')');
    return ids;
  }

  // Main streaming inference method
  async *stream(textStreamer, options = {}) {
    const { voice = "Bella", speed = 1.0 } = options;

    for await (const text of textStreamer) {
      if (text.trim()) {
        try {
          if (this.session && Object.keys(this.voiceEmbeddings).length > 0) {
            // ── Prepare inputs (mualat-style) ──
            const tokenIds = await this.tokenizeText(text);

            // Get voice embedding (indexed by text length)
            const speakerEmbedding = this.getVoiceEmbedding(voice, text.length);

            // Apply speed prior from config
            const internalVoice = this.resolveVoiceName(voice);
            const speedPrior = this.speedPriors[internalVoice] ?? 1.0;
            const effectiveSpeed = speed * speedPrior;

            const ort = await import('onnxruntime-web');

            const inputs = {
              'input_ids': new ort.Tensor('int64', new BigInt64Array(tokenIds.map(id => BigInt(id))), [1, tokenIds.length]),
              'style': new ort.Tensor('float32', speakerEmbedding, [1, 256]),
              'speed': new ort.Tensor('float32', new Float32Array([effectiveSpeed]), [1])
            };

            // ── Run inference ──
            // Note: mualat does NOT use a timeout — v0.8 models work correctly on WASM.
            // We keep a generous safety timeout (60s) only as a last resort.
            const INFERENCE_TIMEOUT = 60000;
            let results = await Promise.race([
              this.session.run(inputs),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(
                    `Inference timed out after ${INFERENCE_TIMEOUT / 1000}s. ` +
                    `Try a smaller model or enable WebGPU.`
                  )),
                  INFERENCE_TIMEOUT
                )
              )
            ]);

            // ── Extract audio output (use first output name, like mualat) ──
            const outputName = this.session.outputNames[0];
            let audioOutput = results[outputName];
            if (!audioOutput) {
              // Fallback: find largest tensor
              for (const [name, tensor] of Object.entries(results)) {
                if (!audioOutput || tensor.size > audioOutput.size) audioOutput = tensor;
              }
            }
            if (!audioOutput) {
              throw new Error('No audio output found in model results');
            }

            let audioData = audioOutput.data;

            // Copy data to avoid detached buffer issues (mualat pattern)
            if (audioData instanceof Float32Array) {
              const copy = new Float32Array(audioData.length);
              copy.set(audioData);
              audioData = copy;
            }

            // ── Post-processing (following mualat) ──
            const sampleRate = 24000;

            // Trim last ~5000 samples (trailing silence, like Python pipeline)
            const TRIM_END = 5000;
            if (audioData.length > TRIM_END) {
              audioData = audioData.slice(0, audioData.length - TRIM_END);
            }

            // Normalize to [-1, 1] range (only if out of range)
            let maxAbs = 0;
            for (let i = 0; i < audioData.length; i++) {
              const abs = Math.abs(audioData[i]);
              if (abs > maxAbs) maxAbs = abs;
            }

            if (maxAbs > 1.0 || maxAbs < 0.01) {
              const factor = maxAbs > 0 ? 0.9 / maxAbs : 1.0;
              for (let i = 0; i < audioData.length; i++) {
                audioData[i] *= factor;
              }
            }

            // Clean NaN values
            for (let i = 0; i < audioData.length; i++) {
              if (isNaN(audioData[i])) audioData[i] = 0;
            }

            yield {
              text,
              audio: new RawAudio(audioData, sampleRate)
            };
          }
        } catch (modelError) {
          console.error('[KittenTTS] Model inference error:', modelError);
          // Yield silence on error so stream doesn't break
          yield {
            text,
            audio: new RawAudio(new Float32Array(22050), 22050)
          };
        }
      }
    }
  }
}
