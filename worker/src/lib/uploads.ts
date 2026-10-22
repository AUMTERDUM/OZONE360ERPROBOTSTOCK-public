export const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i) : '';
}

// Generates a unique storage key matching the original multer scheme: `<timestamp>-<random><ext>`.
export function uniqueKey(originalName: string): string {
  const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
  return unique + extOf(originalName);
}

export async function putUpload(bucket: R2Bucket, file: File): Promise<{ key: string; error?: string }> {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { key: '', error: `File type not allowed: ${file.type}` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { key: '', error: 'File too large (max 20MB)' };
  }
  const key = uniqueKey(file.name);
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return { key };
}
