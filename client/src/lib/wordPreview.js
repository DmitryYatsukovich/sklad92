/** Предпросмотр Word (.docx) в браузере через HTML */

export function isWordLaborContract(mime, filename = '') {
  const m = (mime || '').toLowerCase();
  const n = (filename || '').toLowerCase();
  return (
    m.includes('word')
    || m === 'application/msword'
    || m.includes('wordprocessingml')
    || /\.docx?$/i.test(n)
  );
}

export function isLegacyDocFile(filename = '') {
  const n = (filename || '').toLowerCase();
  return n.endsWith('.doc') && !n.endsWith('.docx');
}

export async function parseWordBlobForPreview(blob, filename = '') {
  if (isLegacyDocFile(filename)) {
    throw new Error(
      'Просмотр файлов .doc (старый формат) в браузере недоступен. Скачайте файл или сохраните в Word как .docx',
    );
  }
  const mod = await import('mammoth');
  const mammoth = mod.default ?? mod;
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { includeDefaultStyleMap: true },
  );
  const html = (result.value || '').trim();
  if (!html) {
    throw new Error('Документ пустой или не удалось извлечь содержимое');
  }
  return { html };
}
