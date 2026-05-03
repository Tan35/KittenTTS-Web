<script setup>
import { ref, onMounted } from 'vue'
import { detectWebGPU } from '../utils/utils.js'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

const webGPUSupported = ref(false)

onMounted(async () => {
  webGPUSupported.value = await detectWebGPU()
})

const onToggle = (event) => {
  emit('update:modelValue', event.target.checked)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      id="webgpu-toggle"
      type="checkbox"
      :checked="modelValue"
      :disabled="!webGPUSupported || disabled"
      class="w-4 h-4 text-primary bg-secondary border-border rounded focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed"
      @change="onToggle"
    />
    <label
      for="webgpu-toggle"
      class="text-sm font-medium text-foreground"
      :class="{ 'opacity-50': !webGPUSupported || disabled }"
    >
      Try WebGPU (experimental)
      <span v-if="!webGPUSupported" class="text-xs text-muted-foreground">
        (not supported)
      </span>
    </label>
  </div>
</template>
