<script setup>
import { ref, computed } from 'vue';
import { Download, Trash2, Check, AlertCircle } from 'lucide-vue-next';

const props = defineProps({
  status: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['download-model', 'clear-cache']);

const modelUrl = ref('https://huggingface.co/KittenML/kitten-tts-nano-0.1/resolve/main/kitten_tts_nano_v0_1.onnx');
const isEditing = ref(false);
const downloadProgress = ref(0);
const isModelCached = ref(false);

// Check if model is cached on component mount
const checkModelCache = async () => {
  try {
    const cache = await caches.open('kitten-tts-models');
    const cachedResponse = await cache.match(modelUrl.value);
    isModelCached.value = !!cachedResponse;
  } catch (error) {
    console.error('Error checking model cache:', error);
  }
};

// Initialize cache check
checkModelCache();

const handleDownloadModel = () => {
  if (modelUrl.value.trim()) {
    emit('download-model', modelUrl.value.trim());
  }
};

const handleClearCache = () => {
  emit('clear-cache');
  isModelCached.value = false;
};

const handleUrlEdit = () => {
  isEditing.value = true;
};

const handleUrlSave = () => {
  isEditing.value = false;
  checkModelCache(); // Re-check cache with new URL
};

const isDownloading = computed(() => props.status === 'downloading');
const isReady = computed(() => ['ready', 'generating'].includes(props.status));
const isLoading = computed(() => props.status === 'loading');
</script>

<template>
  <div class="p-6 bg-card border border-border rounded-xl">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-foreground">Model Management</h3>
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
          class="flex items-center gap-1 text-gray-600 dark:text-gray-400"
        >
          <div class="animate-spin w-4 h-4 border-2 border-gray-600 dark:border-gray-400 border-t-transparent rounded-full"></div>
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
      <div class="flex gap-2">
        <input
          v-if="isEditing"
          v-model="modelUrl"
          @keyup.enter="handleUrlSave"
          @blur="handleUrlSave"
          type="url"
          class="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary text-sm"
          placeholder="Enter model URL..."
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
    <div class="flex gap-3">
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
        class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 class="w-4 h-4" />
        Clear Cache
      </button>
    </div>

    <!-- Model Info -->
    <div class="mt-4 p-3 bg-muted/50 rounded-lg">
      <p class="text-xs text-muted-foreground">
        <strong>Note:</strong> The model will be cached in your browser for faster loading. 
        You can change the model URL to load different versions or models.
      </p>
    </div>
  </div>
</template>
