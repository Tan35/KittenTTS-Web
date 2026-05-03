<template>
  <button
    @click="toggleTheme"
    class="p-2 rounded-full transition-all duration-150 ease-out bg-secondary hover:bg-accent text-secondary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
  >
    <transition name="icon-fade" mode="out-in">
      <SunIcon v-if="isDark" key="sun" class="w-5 h-5" />
      <MoonIcon v-else key="moon" class="w-5 h-5" />
    </transition>
  </button>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { SunIcon, MoonIcon } from 'lucide-vue-next';

const isDark = ref(false);

const toggleTheme = () => {
  isDark.value = !isDark.value;
};

const applyTheme = (dark) => {
  // 直接切换，不添加额外的过渡延迟
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('theme', dark ? 'dark' : 'light');
};

watch(isDark, (newValue) => {
  applyTheme(newValue);
});

onMounted(() => {
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme) {
    isDark.value = savedTheme === 'dark';
  } else {
    isDark.value = systemPrefersDark;
  }
  
  applyTheme(isDark.value);
});
</script>

<style scoped>
.icon-fade-enter-active,
.icon-fade-leave-active {
  transition: all 0.15s ease-out;
}

.icon-fade-enter-from {
  opacity: 0;
  transform: rotate(-30deg) scale(0.9);
}

.icon-fade-leave-to {
  opacity: 0;
  transform: rotate(30deg) scale(0.9);
}
</style>