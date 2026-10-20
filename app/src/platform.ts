/** File open/save that works in the browser and inside the Tauri desktop shell. */

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function saveText(suggested: string, text: string): Promise<string | null> {
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: suggested, filters: [{ name: 'NetLab topology', extensions: ['nlab'] }] });
    if (!path) return null;
    await writeTextFile(path, text);
    return path.split(/[\\/]/).pop() ?? suggested;
  }
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<any> };
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'NetLab topology', accept: { 'application/json': ['.nlab'] } }],
      });
      const s = await h.createWritable();
      await s.write(text);
      await s.close();
      return h.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return suggested;
}

export function openText(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.nlab,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await f.text() });
    };
    input.click();
  });
}
