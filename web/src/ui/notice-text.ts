import { t, tn } from '../i18n';
type ActKind = 'create' | 'edit' | 'delete' | 'move' | 'search' | 'read' | 'other';

export interface ActCall {
  action: string;
  /** A note path, a title or a query. */
  label: string;
}

function actKind(action: string): ActKind {
  const a = action.toLowerCase();
  if (/^(search|query|find|suggest)/.test(a)) return 'search';
  if (/^(create|batch_create|template_create|duplicate|import|save)/.test(a)) return 'create';
  if (/^(delete|bulk_delete|soft_delete)/.test(a)) return 'delete';
  if (/^(move|rename)/.test(a)) return 'move';
  if (/^(patch|update|set_tags|add_tags|remove_tags|merge|restore|bulk_replace|pin|unpin)/.test(a)) return 'edit';
  if (/^(read|get|list|export|diff|digest|folder_stats|link_stats|broken_links|follow_ups|stale)/.test(a)) return 'read';
  return 'other';
}

/** "{actor} edited Roadmap" for one named note. */
function pastOne(k: ActKind, actor: string, target: string): string {
  const v = { actor, target };
  if (k === 'create') return t('{actor} created {target}', v);
  if (k === 'edit') return t('{actor} edited {target}', v);
  if (k === 'delete') return t('{actor} deleted {target}', v);
  if (k === 'move') return t('{actor} moved {target}', v);
  if (k === 'search') return t('{actor} searched for “{target}”', v);
  if (k === 'read') return t('{actor} read {target}', v);
  return t('{actor} used {target}', v);
}

/** "{actor} edited a note" when the note has no name. */
function pastAny(k: ActKind, actor: string): string {
  const v = { actor };
  if (k === 'create') return t('{actor} created a note', v);
  if (k === 'edit') return t('{actor} edited a note', v);
  if (k === 'delete') return t('{actor} deleted a note', v);
  if (k === 'move') return t('{actor} moved a note', v);
  if (k === 'search') return t('{actor} searched your notes', v);
  if (k === 'read') return t('{actor} read a note', v);
  return t('{actor} used a note', v);
}

/** "{actor} edited 3 notes". */
function pastMany(k: ActKind, actor: string, n: number): string {
  const v = { actor };
  if (k === 'create') return tn(n, '{actor} created {n} note', '{actor} created {n} notes', v);
  if (k === 'edit') return tn(n, '{actor} edited {n} note', '{actor} edited {n} notes', v);
  if (k === 'delete') return tn(n, '{actor} deleted {n} note', '{actor} deleted {n} notes', v);
  if (k === 'move') return tn(n, '{actor} moved {n} note', '{actor} moved {n} notes', v);
  if (k === 'read') return tn(n, '{actor} read {n} note', '{actor} read {n} notes', v);
  return tn(n, '{actor} used {n} note', '{actor} used {n} notes', v);
}

/** "Projects/Roadmap 2027.md" -> "Roadmap 2027". */
function shortTarget(label: string, max = 48): string {
  const leaf = (label.split('/').pop() || label).replace(/\.md$/i, '').trim();
  return leaf.length > max ? leaf.slice(0, max - 1) + '…' : leaf;
}

export function agentNotice(actor: string, calls: ActCall[]): string {
  if (!calls.length) return actor;
  const kinds = new Set(calls.map((c) => actKind(c.action)));
  if (calls.length === 1) {
    const c = calls[0];
    const k = actKind(c.action);
    const target = shortTarget(c.label || '');
    if (k === 'other') return t('{actor} used {target}', { actor, target: c.action.replace(/[_.]+/g, ' ').trim() || 'Memora' });
    if (!target) return pastAny(k, actor);
    return pastOne(k, actor, target);
  }
  const notes = new Set(calls.map((c) => c.label)).size;
  if (kinds.size === 1) {
    const k = [...kinds][0];
    if (k === 'search') return t('{actor} searched your notes {n} times', { actor, n: calls.length });
    if (k === 'other') return t('{actor} used Memora {n} times', { actor, n: calls.length });
    if (notes === 1) return agentNotice(actor, [calls[0]]);
    return pastMany(k, actor, notes);
  }
  const writes = calls.filter((c) => !['search', 'read', 'other'].includes(actKind(c.action)));
  if (writes.length) {
    const n = new Set(writes.map((c) => c.label)).size;
    return tn(n, '{actor} changed {n} note', '{actor} changed {n} notes', { actor });
  }
  return t('{actor} looked through your notes ({n} times)', { actor, n: calls.length });
}
