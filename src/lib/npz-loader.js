// NPZ file loader for browser
// NPZ is a ZIP file containing .npy files (NumPy compressed format)
// Based on mualat/kittentts-web implementation

import { inflate } from 'pako';

// Parse .npy file format - handles float32 arrays
function parseNpy(data) {
  // Check magic number: \x93NUMPY
  const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic[i]) {
      throw new Error('Invalid .npy file magic number');
    }
  }

  const major = data[6];
  const minor = data[7];

  let headerLen;
  let headerOffset;

  if (major === 1 && minor === 0) {
    headerLen = data[8] | (data[9] << 8);
    headerOffset = 10;
  } else if (major === 2 && minor === 0) {
    headerLen = data[8] | (data[9] << 8) | (data[10] << 16) | (data[11] << 24);
    headerOffset = 12;
  } else {
    throw new Error(`Unsupported .npy version: ${major}.${minor}`);
  }

  // Parse header as ASCII
  const headerBytes = data.slice(headerOffset, headerOffset + headerLen);
  const header = new TextDecoder('ascii').decode(headerBytes);

  // Extract dtype and shape
  const dtypeMatch = header.match(/'descr':\s*'<(\w+)'/);
  const dtype = dtypeMatch ? dtypeMatch[1] : 'f4';

  const shapeMatch = header.match(/'shape':\s*\(([^)]+)\)/);
  const shape = shapeMatch
    ? shapeMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : [];

  // Get data offset
  const dataOffset = headerOffset + headerLen;
  const dataArray = data.slice(dataOffset);

  // Parse based on dtype
  if (dtype === 'f4') {
    // float32 - each voice embedding is typically 256-dim
    const floatArray = new Float32Array(dataArray.buffer, dataArray.byteOffset, dataArray.byteLength / 4);

    // Split into individual embeddings based on shape
    if (shape.length === 2) {
      const numEmbeddings = shape[0];
      const embeddingDim = shape[1];
      const embeddings = [];

      for (let i = 0; i < numEmbeddings; i++) {
        const start = i * embeddingDim;
        embeddings.push(floatArray.slice(start, start + embeddingDim));
      }

      return embeddings;
    }

    return [floatArray];
  }

  throw new Error(`Unsupported dtype: ${dtype}`);
}

// Parse ZIP file manually (NPZ is a ZIP archive)
async function parseZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const files = new Map();

  // Find End of Central Directory Record (EOCD)
  let eocdOffset = arrayBuffer.byteLength - 22;

  while (eocdOffset >= 0) {
    if (view.getUint32(eocdOffset, true) === 0x06054b50) {
      break;
    }
    eocdOffset--;
  }

  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP file: EOCD not found');
  }

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const numEntries = view.getUint16(eocdOffset + 10, true);

  // Parse central directory
  let offset = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid central directory signature at offset ${offset}`);
    }

    const compressedSize = view.getUint32(offset + 20, true);
    const filenameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const filenameBytes = new Uint8Array(arrayBuffer, offset + 46, filenameLen);
    const filename = new TextDecoder('utf-8').decode(filenameBytes);

    // Read local file header
    const localHeader = new DataView(arrayBuffer, localHeaderOffset);
    const compressionMethod = localHeader.getUint16(8, true);
    const dataOffsetLocal = localHeaderOffset + 30 +
      localHeader.getUint16(26, true) +
      localHeader.getUint16(28, true);

    const compressedData = new Uint8Array(arrayBuffer, dataOffsetLocal, compressedSize);

    let fileData;
    if (compressionMethod === 8) {
      // DEFLATE compression
      fileData = inflate(compressedData);
    } else if (compressionMethod === 0) {
      // Store (no compression)
      fileData = compressedData;
    } else {
      throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }

    files.set(filename, fileData);

    offset += 46 + filenameLen + extraLen + commentLen;
  }

  return files;
}

// Load NPZ file and extract voice embeddings
// Returns: Map<voiceName, Float32Array[]> where each value is an array of embeddings
export async function loadVoicesNpz(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch NPZ: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const zipFiles = await parseZip(arrayBuffer);

  const voices = new Map();

  for (const [filename, data] of zipFiles) {
    if (filename.endsWith('.npy')) {
      const voiceName = filename.replace('.npy', '');
      try {
        const embeddings = parseNpy(data);
        voices.set(voiceName, embeddings);
        console.log(`[NPZ] Loaded voice "${voiceName}": ${embeddings.length} embeddings, ${embeddings[0]?.length ?? 0} dims`);
      } catch (e) {
        console.warn(`[NPZ] Failed to parse ${filename}:`, e);
      }
    }
  }

  return voices;
}

export { parseNpy, parseZip };
