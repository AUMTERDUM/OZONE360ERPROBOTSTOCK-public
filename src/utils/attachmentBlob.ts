import api from '../api';

// The API returns urls like /api/attachments/file/<id>, but the axios client already has /api as its
// baseURL, so the prefix has to be dropped or the request goes to /api/api/... and 404s.
export async function fetchAttachmentBlob(url: string): Promise<Blob> {
  try {
    return (await api.get(url.replace(/^\/api(?=\/)/, ''), { responseType: 'blob' })).data;
  } catch {
    return (await api.get(url, { responseType: 'blob' })).data;
  }
}
