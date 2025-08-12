<script setup>
const props = defineProps({
  speed: {
    type: Number,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['speedChange']);

const handleSpeedChange = (event) => {
  emit('speedChange', parseFloat(event.target.value));
};
</script>

<template>
  <div class="flex items-center w-full">
    <label for="speed-control" class="text-sm font-medium text-foreground mr-2">Speed:</label>
    <div class="w-full flex items-center">
      <input
        id="speed-control"
        type="range"
        :value="speed"
        @input="handleSpeedChange"
        :disabled="disabled"
        min="0.5"
        max="2"
        step="0.1"
        class="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground hover:[&::-webkit-slider-thumb]:bg-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div class="ml-2 text-sm bg-muted text-foreground px-2 py-1 rounded">
        {{ speed }}x
      </div>
    </div>
  </div>
</template>
