<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import {
  PauseIcon,
  PlayIcon,
  CopyIcon,
  CheckIcon,
  Heart,
  DownloadIcon
} from 'lucide-vue-next';
import TextStatistics from './components/TextStatistics.vue';
import VoiceSelector from './components/VoiceSelector.vue';
import SpeedControl from './components/SpeedControl.vue';
import SampleRateSelector from './components/SampleRateSelector.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import WebGPUToggle from './components/WebGPUToggle.vue';
import AudioChunk from './components/AudioChunk.vue';
import ModelManager from './components/ModelManager.vue';
import { cacheModel, clearModelCache, isModelCached } from './utils/model-cache.js';

// State variables
const text = ref(
    "Artificial intelligence is transforming the way we live and work. From self-driving cars to personalized medicine, AI applications are expanding rapidly. However, with great power comes great responsibility. It's important to ensure that technology benefits everyone, without creating new inequalities."
);
const lastGeneration = ref(null);
const isPlaying = ref(false);
const currentChunkIndex = ref(-1);
const speed = ref(1);
const copied = ref(false);
const status = ref("idle"); // idle, downloading, loading, ready, generating, error
const error = ref(null);
const worker = ref(null);
const voices = ref(null);
const selectedVoice = ref("expr-voice-2-m");
const selectedSampleRate = ref(24000);
const useWebGPU = ref(false);
const actualDevice = ref("wasm");
const chunks = ref([]);
const result = ref(null);
const currentModelUrl = ref('https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx');
const downloadProgress = ref(0);
const generationProgress = ref(0);
const generationStartTime = ref(null);
const lastInferenceTime = ref(null);

// Computed properties
const processed = computed(() => {
  return lastGeneration.value &&
      lastGeneration.value.text === text.value &&
      lastGeneration.value.speed === speed.value &&
      lastGeneration.value.voice === selectedVoice.value &&
      lastGeneration.value.sampleRate === selectedSampleRate.value;
});

const audioUrl = computed(() => {
  if (!result.value) return '';
  try {
    return URL.createObjectURL(result.value);
  } catch (error) {
    console.error('Failed to create object URL:', error);
    return '';
  }
});

// Keep track of previous URL for cleanup
let previousAudioUrl = null;

// Watch for result changes to clean up old URLs
watch(result, (newResult, oldResult) => {
  if (previousAudioUrl) {
    try {
      URL.revokeObjectURL(previousAudioUrl);
    } catch (error) {
      console.error('Failed to revoke previous object URL:', error);
    }
  }
  if (newResult && audioUrl.value) {
    previousAudioUrl = audioUrl.value;
  }
});

// Methods
const setSelectedVoice = (voice) => {
  selectedVoice.value = voice;
};

const setSpeed = (newSpeed) => {
  speed.value = newSpeed;
};

const setSampleRate = (sampleRate) => {
  selectedSampleRate.value = sampleRate;
};

const handleWebGPUToggle = (enabled) => {
  // Only restart if the value actually changed and it's different from current device
  if (enabled !== (actualDevice.value === "webgpu")) {
    // Restart the worker with new device preference
    restartWorker(enabled);
  }
};

const handleDownloadModel = async (modelUrl) => {
  try {
    status.value = "downloading";
    downloadProgress.value = 0;
    error.value = null;
    
    await cacheModel(modelUrl, (progress) => {
      downloadProgress.value = progress;
    });
    
    currentModelUrl.value = modelUrl;
    
    // Initialize the worker with the new model
    restartWorker(useWebGPU.value, modelUrl);
    
    downloadProgress.value = 100;
  } catch (err) {
    console.error('Failed to download model:', err);
    status.value = "error";
    error.value = err.message;
  }
};

const handleClearCache = async () => {
  try {
    await clearModelCache();
    status.value = "idle";
    voices.value = null;
    result.value = null;
    chunks.value = [];
    lastGeneration.value = null;
    
    if (worker.value) {
      worker.value.terminate();
      worker.value = null;
    }
  } catch (err) {
    console.error('Failed to clear cache:', err);
    error.value = err.message;
  }
};

const restartWorker = (webGPUPreference = false, modelUrl = null) => {
  if (worker.value) {
    worker.value.terminate();
  }
  
  // Reset all audio and UI state
  status.value = "loading";
  voices.value = null;
  chunks.value = [];
  result.value = null;
  lastGeneration.value = null; // Reset so button shows "Generate"
  isPlaying.value = false;
  currentChunkIndex.value = -1;
  
  worker.value = new Worker(new URL("./workers/tts-worker.js", import.meta.url), {
    type: "module",
  });
  
  worker.value.addEventListener("message", onMessageReceived);
  worker.value.addEventListener("error", onErrorReceived);
  
  // Always send init message with device preference and model URL
  worker.value.postMessage({ 
    type: 'init', 
    useWebGPU: webGPUPreference,
    modelUrl: modelUrl || currentModelUrl.value
  });
};

const setCurrentChunkIndex = (index) => {
  currentChunkIndex.value = index;
};

const setIsPlaying = (playing) => {
  isPlaying.value = playing;
};

const handleChunkEnd = () => {
  if (status.value !== "generating" && currentChunkIndex.value === chunks.value.length - 1) {
    isPlaying.value = false;
    currentChunkIndex.value = -1;
  } else {
    currentChunkIndex.value = currentChunkIndex.value + 1;
  }
};

const handlePlayPause = () => {
  // Don't do anything if model is not ready
  if (status.value !== "ready") {
    return;
  }

  // If we need to generate first
  if (!processed.value && status.value === "ready") {
    status.value = "generating";
    chunks.value = [];
    currentChunkIndex.value = -1;  // Don't auto-play
    generationProgress.value = 0;
    generationStartTime.value = Date.now();
    const params = { 
      text: text.value, 
      voice: selectedVoice.value, 
      speed: speed.value,
      sampleRate: selectedSampleRate.value
    };
    lastGeneration.value = params;
    worker.value?.postMessage(params);
    return;
  }

  // If audio is already generated, handle play/pause
  if (processed.value && status.value === "ready") {
    if (currentChunkIndex.value === -1) {
      currentChunkIndex.value = 0;
    }
    isPlaying.value = !isPlaying.value;
  }
};

const handleCopy = async () => {
  await navigator.clipboard.writeText(text.value);
  copied.value = true;
  setTimeout(() => { copied.value = false }, 2000);
}

const handleDownload = () => {
  if (!result.value) return;
  
  try {
    const url = URL.createObjectURL(result.value);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kitten-tts-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download audio:', error);
  }
}

// Worker message handlers
const onMessageReceived = ({ data }) => {
  switch (data.status) {
    case "device":
      actualDevice.value = data.device;
      // Update checkbox to reflect actual device
      useWebGPU.value = data.device === "webgpu";
      break;
    case "ready":
      status.value = "ready";
      voices.value = data.voices;
      actualDevice.value = data.device;
      // Update checkbox to reflect actual device
      useWebGPU.value = data.device === "webgpu";
      break;
    case "error":
      status.value = "error";
      error.value = data.data;
      break;
    case "stream":
      chunks.value = [...chunks.value, data.chunk];
      // Update generation progress based on chunks received
      if (lastGeneration.value && text.value) {
        const estimatedChunks = Math.max(1, Math.ceil(text.value.length / 50)); // Rough estimate
        generationProgress.value = Math.min(90, (chunks.value.length / estimatedChunks) * 100);
      }
      break;
    case "complete":
      status.value = "ready";
      result.value = data.audio;
      generationProgress.value = 100;
      if (generationStartTime.value) {
        lastInferenceTime.value = Date.now() - generationStartTime.value;
      }
      break;
  }
};

const onErrorReceived = (e) => {
  console.error("Worker error:", e);
  error.value = e.message;
};

// Worker setup
onMounted(async () => {
  // Initialize Vercel Analytics (safe way)
  try {
    const { inject } = await import('@vercel/analytics');
    inject();
  } catch (error) {
    console.log('Analytics not loaded:', error);
  }
  
  // Check if model is already cached
  const isCached = await isModelCached(currentModelUrl.value);
  if (isCached) {
    restartWorker(useWebGPU.value, currentModelUrl.value);
  } else {
    status.value = "idle";
  }
});

// Cleanup
onUnmounted(() => {
  if (worker.value) {
    worker.value.terminate();
  }
  // Clean up audio URL
  if (previousAudioUrl) {
    try {
      URL.revokeObjectURL(previousAudioUrl);
    } catch (error) {
      console.error('Failed to revoke object URL on unmount:', error);
    }
  }
});
</script>

<template>
  <div class="min-h-screen bg-background transition-all duration-300 ease-in-out flex flex-col">
    <!-- Header -->
    <header class="sticky top-0 z-50 backdrop-blur-xl bg-card/80 border-b border-border">
      <div class="container mx-auto px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div>
            <h1 class="text-xl font-bold text-foreground">
              Kitten TTS Nano Demo
            </h1>
          </div>
        </div>
        
        <div class="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="container mx-auto px-4 pt-8 pb-4 max-w-4xl flex-1">
      <!-- Model Management Section -->
      <div class="mb-6">
        <ModelManager 
          :status="status"
          @download-model="handleDownloadModel"
          @clear-cache="handleClearCache"
        />
      </div>

      <!-- Main Card -->
      <div class="bg-card backdrop-blur-xl rounded-2xl shadow-lg border border-border overflow-hidden">
        <div class="p-6 pb-0 space-y-6">
          <!-- Text Input Section -->
          <div class="space-y-4">
            <div class="relative">
              <textarea
                v-model="text"
                placeholder="Type or paste your text here..."
                :disabled="status === 'loading' || status === 'generating'"
                class="w-full min-h-[180px] text-lg leading-relaxed resize-y p-4 pt-8 rounded-xl border-2 border-border bg-input focus:border-primary focus:ring-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :class="voices ? '' : 'text-muted-foreground'"
              ></textarea>
              <button
                class="absolute top-1 right-3 h-10 w-10 rounded-full hover:bg-accent flex items-center justify-center transition-colors"
                @click="handleCopy"
                :title="copied ? 'Copied!' : 'Copy text'"
              >
                <CheckIcon v-if="copied" class="h-4 w-4 text-primary" />
                <CopyIcon v-else class="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div class="flex justify-end">
              <TextStatistics :text="text" />
            </div>
          </div>

          <!-- Controls Section -->
          <div v-if="voices" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <!-- Voice Selection -->
              <div class="flex items-center">
                <label class="text-sm font-medium text-foreground mr-2">
                  Voice:
                </label>
                <VoiceSelector
                  :voices="voices"
                  :selected-voice="selectedVoice"
                  :disabled="status !== 'ready'"
                  @voice-change="setSelectedVoice"
                />
              </div>

              <!-- Speed Control -->
              <div class="flex items-center">
                <SpeedControl
                  :speed="speed"
                  :disabled="status !== 'ready'"
                  @speed-change="setSpeed"
                />
              </div>

              <!-- Sample Rate -->
              <div class="flex items-center">
                <SampleRateSelector
                  :disabled="status !== 'ready'"
                  @sample-rate-change="setSampleRate"
                />
              </div>
            </div>

            <!-- WebGPU Toggle -->
            <WebGPUToggle 
              v-model="useWebGPU" 
              :disabled="status !== 'ready'"
              @update:modelValue="handleWebGPUToggle" 
            />
          </div>

          <div v-else-if="error" class="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
            {{ error }}
          </div>
          <div v-else-if="status === 'downloading'" class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <div class="animate-spin w-4 h-4 border-2 border-gray-600 dark:border-gray-400 border-t-transparent rounded-full"></div>
            <span>Downloading model... {{ Math.round(downloadProgress) }}%</span>
          </div>
          <div v-else-if="status === 'loading'" class="flex items-center gap-2 text-muted-foreground">
            <div class="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>
            <span>Loading model...</span>
          </div>
          <div v-else-if="status === 'idle'" class="p-3 bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-lg text-sm">
            Please download a model first to use TTS functionality.
          </div>

          <!-- Generation Progress -->
          <div v-if="status === 'generating'" class="mb-4">
            <div class="flex justify-between items-center mb-2">
              <span class="text-sm text-foreground">Generating speech...</span>
              <span class="text-xs text-muted-foreground">{{ Math.round(generationProgress) }}%</span>
            </div>
            <div class="w-full bg-muted rounded-full h-2">
              <div 
                class="bg-primary h-2 rounded-full transition-all duration-300"
                :style="{ width: generationProgress + '%' }"
              ></div>
            </div>
          </div>

          <!-- Inference Time Display -->
          <div v-if="lastInferenceTime && status === 'ready'" class="mb-4 text-xs text-muted-foreground text-right">
            Last inference: {{ lastInferenceTime }}ms ({{ (lastInferenceTime / 1000).toFixed(2) }}s)
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-col sm:flex-row gap-3">
            <!-- Download Button -->
            <button
              v-if="result && status === 'ready'"
              class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 text-white transition-all transform hover:scale-[1.02] active:scale-[0.98]"
              @click="handleDownload"
              title="Download generated audio"
            >
              <DownloadIcon class="w-5 h-5" />
              <span>Download</span>
            </button>
            
            <!-- Play/Generate Button -->
            <button
              class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-primary-foreground transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
              :class="{
                'bg-primary hover:bg-primary/90 shadow-lg': !isPlaying && status === 'ready',
                'bg-red-500 hover:bg-red-600 shadow-lg': isPlaying && status === 'ready',
                'bg-muted/50': status !== 'ready',
                'animate-pulse': status === 'generating'
              }"
              @click="handlePlayPause"
              :disabled="!text || status !== 'ready'"
            >
              <!-- Loading spinner for generating state -->
              <svg v-if="status === 'generating'" class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <PauseIcon v-else-if="isPlaying" class="w-5 h-5" />
              <PlayIcon v-else class="w-5 h-5" />
              <span v-if="status === 'idle'" class="text-gray-500">Download Model First</span>
              <span v-else-if="status === 'downloading'" class="text-gray-500">Downloading...</span>
              <span v-else-if="status === 'loading'" class="text-gray-500">Loading...</span>
              <span v-else-if="status === 'generating'" class="text-gray-300">Generating...</span>
              <span v-else-if="isPlaying">Pause</span>
              <span v-else-if="processed">Play</span>
              <span v-else>Generate</span>
            </button>
          </div>

          <!-- Audio Player Section -->
          <div v-if="result && status === 'ready'" class="mt-6 p-4 bg-muted/50 rounded-xl border border-border">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-medium text-foreground">Generated Audio</h3>
              <span class="text-xs text-muted-foreground">{{ chunks.length }} chunks</span>
            </div>
            <audio
              controls
              class="w-full h-10 bg-background rounded-lg"
              :src="audioUrl"
              preload="metadata"
            >
              Your browser does not support the audio element.
            </audio>
            <div class="mt-2 text-xs text-muted-foreground">
              Click the play button above to listen to the generated audio
            </div>
          </div>

          <!-- Hidden Audio Chunks -->
          <div class="w-0 h-0 hidden">
            <AudioChunk
              v-if="chunks.length > 0"
              v-for="(chunk, index) in chunks"
              :key="index"
              :audio="chunk.audio"
              :active="currentChunkIndex === index"
              :playing="isPlaying"
              class="hidden"
              @start="() => setCurrentChunkIndex(index)"
              @pause="() => { if (currentChunkIndex === index) setIsPlaying(false) }"
              @end="handleChunkEnd"
            />
          </div>
          </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="container mx-auto px-4 py-8 text-center">
      <div class="text-sm text-muted-foreground">
        <p>
          Powered by 
          <a 
            href="https://github.com/KittenML/KittenTTS" 
            target="_blank" 
            class="text-foreground hover:underline transition-colors"
          >
            KittenTTS
          </a>
          , 
          <a 
            href="https://onnxruntime.ai/" 
            target="_blank" 
            class="text-foreground hover:underline transition-colors"
          >
            ONNX Runtime Web
          </a>
           and 
          <a 
            href="https://github.com/clowerweb/kitten-tts-web-demo" 
            target="_blank" 
            class="text-foreground hover:underline transition-colors"
          >
            Kitten-tts-web-demo.
          </a>
        </p>
        <p class="mt-2">
          Modified by 
          <a 
            href="https://tanxy.club" 
            target="_blank" 
            class="text-foreground hover:underline transition-colors"
          >
            SeanTan
          </a>
          <span class="text-red-500 ml-1">❤️</span>
        </p>
      </div>
    </footer>
  </div>
</template>
