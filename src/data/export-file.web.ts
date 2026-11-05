/** Browser preview: downloads the file. Nothing is uploaded. */
export async function exportFile(
  name: string,
  raw: string,
  format: 'json' | 'csv',
): Promise<string> {
  const type = format === 'json' ? 'application/json' : 'text/csv';
  const url = URL.createObjectURL(new Blob([raw], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return 'Download started. Only you decide where the file goes next.';
}
