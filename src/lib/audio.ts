import Dexie, { type EntityTable } from 'dexie';
import * as lamejs from '@breezystack/lamejs';

export interface AudioItem {
  id?: number;
  title: string;
  type: 'recent' | 'merged';
  createdAt: number;
  audioData: string; // base64 representation of 16-bit PCM
}

export const db = new Dexie('MutuAudioDB') as Dexie & {
  audios: EntityTable<AudioItem, 'id'>;
};

db.version(1).stores({
  audios: '++id, type, createdAt'
});

export function base64ToInt16Array(base64: string): Int16Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function pcmToMp3Blob(pcmData: Int16Array, sampleRate: number = 24000): Blob {
  // @ts-ignore - lamejs typings aren't perfectly standard
  const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 320); // 1 channel, SR, 320kbps
  const mp3Data: Int8Array[] = [];

  const sampleBlockSize = 1152; 
  for (let i = 0; i < pcmData.length; i += sampleBlockSize) {
    const sampleChunk = pcmData.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Int8Array(mp3buf));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Int8Array(mp3buf));
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function mergeBase64Audios(base64List: string[]): Promise<string> {
  const arrays = base64List.map(base64ToInt16Array);
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  
  const mergedArray = new Int16Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    mergedArray.set(arr, offset);
    offset += arr.length;
  }
  
  // Convert back to base64
  const bytes = new Uint8Array(mergedArray.buffer);
  let binaryString = "";
  // We process in chunks to avoid blowing up the call stack with String.fromCharCode.apply
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binaryString += String.fromCharCode(...chunk);
  }
  
  return window.btoa(binaryString);
}
