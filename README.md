# Kitten TTS Nano Demo

A fully in-browser text-to-speech playground for the [KittenML](https://github.com/KittenML/KittenTTS) family of models. Pick a voice, type some text, and generate speech locally using [ONNX Runtime Web](https://onnxruntime.ai/) with optional WebGPU acceleration. Models are downloaded once and cached by the browser for offline re-use.

**Live demo:** [kittentts.tanxy.club](https://kittentts.tanxy.club/)

This project is a Vue 3 rewrite and enhancement of [clowerweb/kitten-tts-web-demo](https://github.com/clowerweb/kitten-tts-web-demo). It adds multi-model switching across the v0.8 Nano, Micro, and Mini variants, a dedicated model cache manager, a WebGPU execution toggle, dark / light theming, text statistics, sample-rate selection, and a number of UX polish changes.

## Features

- Runs entirely client-side. No server, no API keys, no uploads.
- Three selectable KittenTTS v0.8 models (Nano, Micro, Mini) loaded directly from Hugging Face.
- Eight built-in voices (four female, four male) with speed control from 0.5x to 2.0x.
- WebGPU backend when available, automatic fallback to the WASM SIMD + threaded build.
- Output sample rate selectable from 8 kHz up to 48 kHz, with anti-aliased resampling.
- Web Worker inference keeps the UI responsive and streams audio chunk by chunk.
- Peak normalization and silence trimming applied to generated audio.
- Per-model and global cache management via the browser Cache Storage API, with download progress.
- Text preprocessing that expands contractions, spells out numbers, and strips URLs, emails, and HTML.
- Text statistics (character, word, sentence, estimated-duration counters) and one-click copy-to-clipboard.
- Dark / light theme with `prefers-color-scheme` detection and `localStorage` persistence.
- Download the rendered audio as a `.wav` file.

## Tech Stack

- [Vue 3](https://vuejs.org/) with [Vite 7](https://vitejs.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/) via `@tailwindcss/vite`
- [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) 1.22 (WASM + WebGPU)
- [phonemizer](https://www.npmjs.com/package/phonemizer) (espeak-ng phonemization)
- [pako](https://www.npmjs.com/package/pako) for parsing `voices.npz`
- [lucide-vue-next](https://lucide.dev/) icons
- ESLint 9, Prettier 3, Vercel Analytics

## Available Models

All models are fetched from Hugging Face on first use and then served from the browser cache.

| Model | Parameters | Size | Notes |
| --- | --- | --- | --- |
| [Kitten TTS Nano 0.8](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8) | 15M | ~24 MB | Fastest, recommended default. |
| [Kitten TTS Micro 0.8](https://huggingface.co/KittenML/kitten-tts-micro-0.8) | 40M | ~41 MB | Balanced quality and speed. |
| [Kitten TTS Mini 0.8](https://huggingface.co/KittenML/kitten-tts-mini-0.8) | 80M | ~78 MB | Highest quality. WebGPU strongly recommended, slow on WASM. |

Each model bundle consists of a `.onnx` graph, a `voices.npz` embedding file, and a `config.json`.

## Voices

| Voice | ID | Gender |
| --- | --- | --- |
| Bella (default) | `expr-voice-2-f` | Female |
| Luna | `expr-voice-3-f` | Female |
| Rosie | `expr-voice-4-f` | Female |
| Kiki | `expr-voice-5-f` | Female |
| Jasper | `expr-voice-2-m` | Male |
| Bruno | `expr-voice-3-m` | Male |
| Hugo | `expr-voice-4-m` | Male |
| Leo | `expr-voice-5-m` | Male |

## Sample Rates

Output can be resampled to any of the following rates. The model natively generates 24 kHz audio; other rates use an anti-aliased polyphase filter.

`8 kHz`, `16 kHz`, `22.05 kHz`, `24 kHz (native)`, `44.1 kHz`, `48 kHz`

## Getting Started

### Prerequisites

- Node.js 20 or newer (the deployment workflow uses Node 22).
- A modern browser. For WebGPU acceleration, use Chrome / Edge 113+ or any browser with WebGPU enabled.

### Install

```bash
git clone https://github.com/<your-fork>/KittenTTS-Web.git
cd KittenTTS-Web
npm install
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Produce a production build in `dist/`. |
| `npm run preview` | Preview the production build locally. |
| `npm run lint` | Run ESLint over the project. |
| `npm run format` | Run Prettier. |

Open the URL printed by `npm run dev`, pick a model, wait for the first download to finish, and start generating speech.

## Usage Notes

- The first run for each model downloads it from Hugging Face and stores it in the `kitten-tts-models` cache. Subsequent loads are instant and work offline.
- Use the cache controls in the Model Manager to reload a single model, clear a single model, or clear every cached model.
- Enabling WebGPU is optional but significantly improves latency on the Mini model. The toggle is disabled automatically when `navigator.gpu` is not available.
- Generated audio is assembled chunk by chunk. You can start listening before the full text has been synthesized.

## Project Structure

```
KittenTTS-Web/
├── .github/workflows/deploy.yml   # GitHub Pages deployment
├── public/
│   ├── favicon.ico
│   └── onnx-runtime/              # Local ONNX Runtime Web bundle and wasm
├── src/
│   ├── components/                # UI widgets (ModelManager, VoiceSelector, ...)
│   ├── lib/
│   │   ├── kitten-tts.js          # Tokenizer, phonemizer adapter, ONNX session, WAV encoder
│   │   └── npz-loader.js          # voices.npz parser
│   ├── utils/
│   │   ├── model-cache.js         # Cache Storage helpers with progress reporting
│   │   └── utils.js               # WebGPU detection
│   ├── workers/
│   │   └── tts-worker.js          # Off-main-thread inference, resampling, normalization
│   ├── App.vue                    # Main UI and state management
│   ├── main.js                    # App entry point
│   └── index.css                  # Tailwind entry
├── index.html
├── vite.config.js
├── vercel.json                    # SPA rewrites and long-cache headers for models / wasm
├── eslint.config.js
├── package.json
└── LICENSE
```

## Deployment

### GitHub Pages

A workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the project on every push to `main` with Node 22 and publishes `dist/` through `actions/deploy-pages@v4`. Enable GitHub Pages for the repository with the "GitHub Actions" source to use it.

### Vercel

[`vercel.json`](vercel.json) is already configured with SPA rewrites and aggressive cache headers for `.wasm`, `/tts-model/*`, and `/onnx-runtime/*`. Import the repository into Vercel and deploy with the default Vite preset.

### Any static host

`npm run build` produces a fully static `dist/` directory. Serve it from any static host, taking care to preserve SPA-style routing and to allow the browser to cache the model files.

## Acknowledgements

- [KittenML](https://github.com/KittenML/KittenTTS) for the underlying TTS models.
- [clowerweb/kitten-tts-web-demo](https://github.com/clowerweb/kitten-tts-web-demo), the upstream project that this fork builds on.
- [ONNX Runtime Web](https://onnxruntime.ai/) for in-browser inference.
- [espeak-ng](https://github.com/espeak-ng/espeak-ng) via the [phonemizer](https://www.npmjs.com/package/phonemizer) package.
- Modified and maintained by [SeanTan](https://tanxy.club).

## License

Released under the [Apache License 2.0](LICENSE).
