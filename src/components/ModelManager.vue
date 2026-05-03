<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Download, Trash2, Check, AlertCircle, ChevronDown } from 'lucide-vue-next';

const props = defineProps({
  status: {
    type: String,
    required: true
  },
  loadedModelUrl: {
    type: String,
    default: ''
  },
  currentModelUrl: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['download-model', 'clear-cache', 'clear-all-cache']);

// Predefined models — KittenTTS v0.8 series, loaded from HuggingFace CDN
const HUGGINGFACE_BASE = 'https://huggingface.co';

const predefinedModels = [
  {
    name: 'Kitten TTS Nano 0.8',
    url: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-nano-0.8-int8/resolve/main/kitten_tts_nano_v0_8.onnx`,
    voicesUrl: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz`,
    configUrl: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-nano-0.8-int8/resolve/main/config.json`,
    version: 'nano-0.8',
    description: '15M params, ~24MB, fastest (Recommended)'
  },
  {
    name: 'Kitten TTS Micro 0.8',
    url: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-micro-0.8/resolve/main/kitten_tts_micro_v0_8.onnx`,
    voicesUrl: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-micro-0.8/resolve/main/voices.npz`,
    configUrl: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-micro-0.8/resolve/main/config.json`,
    version: 'micro-0.8',
    description: '40M params, ~41MB, balanced quality & speed'
  },
  {
    name: 'Kitten TTS Mini 0.8',
    url: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-mini-0.8/resolve/main/kitten_tts_mini_v0_8.onnx`,
    voicesUrl: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-mini-0.8/resolve/main/voices.npz`,
    configUrl: `${HUGGINGFACE_BASE}/KittenML/kitten-tts-mini-0.8/resolve/main/config.json`,
    version: 'mini-0.8',
    description: '80M params, ~78MB, highest quality — slower on WASM'
  }
];

const selectedModel = ref(predefinedModels[0]);
const modelUrl = ref(selectedModel.value.url);
const isEditing = ref(false);
const downloadProgress = ref(0);
const isModelCached = ref(false);
const showDropdown = ref(false);

// Check if a specific model is cached
const checkModelCache = async (url = null) => {
  try {
    const targetUrl = url || modelUrl.value;
    const cache = await caches.open('kitten-tts-models');
    const cachedResponse = await cache.match(targetUrl);
    const isCached = !!cachedResponse;
    
    // Only update isModelCached if checking current model
    if (!url || url === modelUrl.value) {
      isModelCached.value = isCached;
    }
    
    return isCached;
  } catch (error) {
    console.error('Error checking model cache:', error);
    return false;
  }
};

// Watch for model selection changes
watch(selectedModel, async (newModel) => {
  modelUrl.value = newModel.url;
  
  // Check if the new model is cached
  const isCached = await checkModelCache(newModel.url);
  
  // Emit model change event (always emit, let parent decide what to do)
  emit('model-changed', {
    modelUrl: newModel.url,
    voicesUrl: newModel.voicesUrl,
    configUrl: newModel.configUrl || null,
    version: newModel.version,
    isCached: isCached
  });
}, { immediate: true });

// Watch for changes in loaded model from parent (when model is actually loaded)
watch(() => props.loadedModelUrl, async (newLoadedUrl) => {
  if (newLoadedUrl && newLoadedUrl === modelUrl.value) {
    // Current model has been loaded, refresh cache status
    await checkModelCache();
  }
});

// Watch for status changes to refresh cache when download completes
watch(() => props.status, async (newStatus, oldStatus) => {
  if (oldStatus === 'downloading' && newStatus === 'loading') {
    // Download completed, check cache for current model
    await checkModelCache();
  }
  if (newStatus === 'ready') {
    // Model is ready, ensure cache status is up to date
    await checkModelCache();
  }
});

// Initialize cache check
checkModelCache();

// Computed properties
const currentLoadedModel = computed(() => {
  if (!props.loadedModelUrl) return null;
  return predefinedModels.find(model => model.url === props.loadedModelUrl);
});

const isCurrentModelLoaded = computed(() => {
  return props.loadedModelUrl === modelUrl.value;
});

const handleDownloadModel = () => {
  if (modelUrl.value.trim()) {
    // Emit full model info so App.vue can update voicesUrl/configUrl
    const matched = predefinedModels.find(m => m.url === modelUrl.value.trim());
    emit('download-model', {
      modelUrl: modelUrl.value.trim(),
      voicesUrl: matched?.voicesUrl || null,
      configUrl: matched?.configUrl || null
    });
  }
};

const handleClearCache = async () => {
  emit('clear-cache', modelUrl.value);
  // Re-check cache status after clearing
  await checkModelCache();
};

const handleClearAllCache = async () => {
  emit('clear-all-cache');
  // Re-check cache status after clearing all
  await checkModelCache();
};

const handleUrlEdit = () => {
  isEditing.value = true;
  showDropdown.value = false;
};

const handleUrlSave = async () => {
  isEditing.value = false;
  // Check if URL matches any predefined model
  const matchedModel = predefinedModels.find(model => model.url === modelUrl.value);
  if (matchedModel) {
    selectedModel.value = matchedModel;
    const isCached = await checkModelCache(matchedModel.url);
    emit('model-changed', {
      modelUrl: matchedModel.url,
      voicesUrl: matchedModel.voicesUrl,
      configUrl: matchedModel.configUrl || null,
      version: matchedModel.version,
      isCached: isCached
    });
  }
};

const selectPredefinedModel = (model) => {
  selectedModel.value = model;
  showDropdown.value = false;
  isEditing.value = false;
};

const toggleDropdown = () => {
  if (!isEditing.value) {
    showDropdown.value = !showDropdown.value;
  }
};

// Close dropdown when clicking outside
const handleClickOutside = (event) => {
  if (!event.target.closest('.model-dropdown')) {
    showDropdown.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

const isDownloading = computed(() => props.status === 'downloading');
const isReady = computed(() => ['ready', 'generating'].includes(props.status));
const isLoading = computed(() => props.status === 'loading');
</script>

<template>
  <div class="p-6 bg-card border border-border rounded-xl">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h3 class="text-lg font-semibold text-foreground">Model Management</h3>
        <div v-if="currentLoadedModel" class="text-xs text-muted-foreground mt-1">
          Currently loaded: {{ currentLoadedModel.name }}
          <span v-if="isCurrentModelLoaded" class="text-green-600 dark:text-green-400 ml-1">●</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div 
          v-if="isReady" 
          class="flex items-center gap-1 text-green-600 dark:text-green-400"
        >
          <Check class="w-4 h-4" />
          <span class="text-sm">Ready</span>
        </div>
        <div 
          v-else-if="isDownloading || isLoading" 
          class="flex items-center gap-1 text-muted-foreground"
        >
          <div class="animate-spin w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full"></div>
          <span class="text-sm">{{ isDownloading ? 'Downloading...' : 'Loading...' }}</span>
        </div>
        <div 
          v-else 
          class="flex items-center gap-1 text-orange-600 dark:text-orange-400"
        >
          <AlertCircle class="w-4 h-4" />
          <span class="text-sm">No Model</span>
        </div>
      </div>
    </div>

    <!-- Model URL Input -->
    <div class="mb-4">
      <label class="block text-sm font-medium text-foreground mb-2">
        Model URL:
      </label>
      
      <!-- Model Selection Dropdown -->
      <div class="mb-2">
        <div class="relative model-dropdown">
          <button
            @click="toggleDropdown"
            :disabled="isEditing"
            class="w-full flex items-center justify-between px-3 py-2 border border-border rounded-lg bg-background text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span class="text-sm">{{ selectedModel.name }}</span>
            <ChevronDown 
              class="w-4 h-4 transition-transform"
              :class="{ 'rotate-180': showDropdown }"
            />
          </button>
          
          <!-- Dropdown Menu -->
          <div 
            v-if="showDropdown && !isEditing"
            class="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-10"
          >
            <div
              v-for="model in predefinedModels"
              :key="model.url"
              @click="selectPredefinedModel(model)"
              class="px-3 py-2 hover:bg-muted cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg"
              :class="{ 'bg-muted': selectedModel.url === model.url }"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">{{ model.name }}</span>
                <span class="text-xs text-muted-foreground">{{ model.version }}</span>
              </div>
              <p v-if="model.description" class="text-xs text-muted-foreground mt-0.5">{{ model.description }}</p>
            </div>
          </div>
        </div>
      </div>
      
      <div class="flex gap-2">
        <input
          v-if="isEditing"
          v-model="modelUrl"
          @keyup.enter="handleUrlSave"
          @blur="handleUrlSave"
          type="url"
          class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary text-sm"
          placeholder="Enter custom model URL..."
          autofocus
        />
        <div 
          v-else
          @click="handleUrlEdit"
          class="flex-1 px-3 py-2 border border-border rounded-lg bg-muted text-foreground text-sm cursor-pointer hover:bg-muted/70 transition-colors truncate"
          :title="modelUrl"
        >
          {{ modelUrl }}
        </div>
        <button
          v-if="!isEditing"
          @click="handleUrlEdit"
          class="px-3 py-2 text-sm bg-secondary border border-border rounded-lg hover:bg-accent transition-colors"
        >
          Edit
        </button>
      </div>
    </div>

    <!-- Download Progress -->
    <div v-if="isDownloading && downloadProgress > 0" class="mb-4">
      <div class="flex justify-between items-center mb-1">
        <span class="text-sm text-foreground">Downloading...</span>
        <span class="text-sm text-muted-foreground">{{ Math.round(downloadProgress) }}%</span>
      </div>
      <div class="w-full bg-muted rounded-full h-2">
        <div 
          class="bg-primary h-2 rounded-full transition-all duration-300"
          :style="{ width: downloadProgress + '%' }"
        ></div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="flex gap-3 flex-wrap">
      <button
        @click="handleDownloadModel"
        :disabled="isDownloading || !modelUrl.trim()"
        class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download class="w-4 h-4" />
        {{ isModelCached ? 'Reload Model' : 'Download Model' }}
      </button>

      <button
        v-if="isModelCached"
        @click="handleClearCache"
        :disabled="isDownloading"
        class="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 class="w-4 h-4" />
        Clear This Model
      </button>
      
      <button
        @click="handleClearAllCache"
        :disabled="isDownloading"
        class="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        <Trash2 class="w-3 h-3" />
        Clear All Cache
      </button>
    </div>

    <!-- Model Info -->
    <div class="mt-4 p-3 bg-muted/50 rounded-lg">
      <p class="text-xs text-muted-foreground">
        <strong>Note:</strong> The model will be cached in your browser for faster loading.
        You can change the model URL to load different versions or models.
      </p>
    </div>

    <!-- Mini Model Warning -->
    <div v-if="selectedModel.version === 'mini-0.8'" class="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
      <p class="text-xs text-amber-700 dark:text-amber-300">
        <strong>⚠️ Performance Notice:</strong> The Mini model (80M params) is slower on WASM backend.<br/>
        Recommendations:<br/>
        1. Enable <strong>WebGPU</strong> toggle for GPU acceleration (if supported)<br/>
        2. Or use <strong>Nano 0.8</strong> or <strong>Micro 0.8</strong> for faster inference
      </p>
    </div>

    <!-- Online Model Note -->
    <div class="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <p class="text-xs text-blue-700 dark:text-blue-300">
        <strong>☁️ Online model:</strong> Models are loaded from HuggingFace CDN on first use. They will be cached in your browser for subsequent visits. Requires internet connection for the initial download.
      </p>
    </div>
  </div>
</template>
