import { apiGet } from './api';
import { $, esc } from './dom';
import { folderOf, noteName } from './format';
import { state } from './state';
import type { NoteDoc } from './types';
import { hooks } from './hooks';

export async function openPeek(path: string): Promise<void> {
  // Phones open the full node page instead of the side panel.
  if (window.matchMedia('(max-width: 760px)').matches) {
    hooks.openNote(path);
    return;
  }
  state.peekPath = path;
  $('#peek').classList.remove('hidden');
  $('#peekFolder').textContent = folderOf(path) + ' / ' + noteName(path);
  $('#peekBody').innerHTML = '<div class="empty">Loading...</div>';
  try {
    const d = await apiGet<NoteDoc>('/api/note?path=' + encodeURIComponent(path));
    if (state.peekPath !== path) return;
    // `html` is the server's sanitized render of the note.
    $('#peekBody').innerHTML = d.html || `<pre>${esc(d.content || '')}</pre>`;
  } catch (e) {
    if (state.peekPath !== path) return;
    $('#peekBody').innerHTML = `<div class="empty">Could not load: ${esc((e as Error).message)}</div>`;
  }
}

export function clearPeek(): void {
  state.peekPath = null;
  $('#peek').classList.add('hidden');
}
