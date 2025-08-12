// Model cache management utilities using Cache API

const CACHE_NAME = 'kitten-tts-models';

/**
 * Download a file with progress tracking
 * @param {string} url - URL to download
 * @param {Function} onProgress - Progress callback (percent)
 * @returns {Promise<Response>} - Response object
 */
export async function downloadWithProgress(url, onProgress) {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (!contentLength) {
    return response;
  }

  const total = parseInt(contentLength, 10);
  let received = 0;

  const reader = response.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    
    if (done) break;
    
    chunks.push(value);
    received += value.length;
    
    if (onProgress) {
      onProgress((received / total) * 100);
    }
  }

  // Reconstruct the response
  const blob = new Blob(chunks);
  return new Response(blob, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

/**
 * Cache a model
 * @param {string} modelUrl - URL of the model to cache
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<void>}
 */
export async function cacheModel(modelUrl, onProgress) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Download and cache the main model with progress
    console.log('Downloading model...');
    const modelResponse = await downloadWithProgress(modelUrl, onProgress);
    await cache.put(modelUrl, modelResponse.clone());
    
    console.log('Model cached successfully');
  } catch (error) {
    console.error('Error caching model:', error);
    throw error;
  }
}

/**
 * Get a cached model URL
 * @param {string} modelUrl - URL of the model
 * @returns {Promise<string|null>} - Blob URL or null if not cached
 */
export async function getCachedModel(modelUrl) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(modelUrl);
    
    if (response) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
    
    return null;
  } catch (error) {
    console.error('Error getting cached model:', error);
    return null;
  }
}

/**
 * Check if model is cached
 * @param {string} modelUrl - URL of the model
 * @returns {Promise<boolean>} - True if cached
 */
export async function isModelCached(modelUrl) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(modelUrl);
    return !!response;
  } catch (error) {
    console.error('Error checking model cache:', error);
    return false;
  }
}

/**
 * Clear all cached models
 * @returns {Promise<void>}
 */
export async function clearModelCache() {
  try {
    await caches.delete(CACHE_NAME);
    console.log('Model cache cleared');
  } catch (error) {
    console.error('Error clearing model cache:', error);
    throw error;
  }
}

/**
 * Get cache size information
 * @returns {Promise<Object>} - Cache size info
 */
export async function getCacheInfo() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    let totalSize = 0;
    const files = [];
    
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        const size = blob.size;
        totalSize += size;
        
        files.push({
          url: request.url,
          size: size,
          sizeHuman: formatBytes(size)
        });
      }
    }
    
    return {
      totalSize,
      totalSizeHuman: formatBytes(totalSize),
      fileCount: files.length,
      files
    };
  } catch (error) {
    console.error('Error getting cache info:', error);
    return { totalSize: 0, totalSizeHuman: '0 B', fileCount: 0, files: [] };
  }
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} - Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}