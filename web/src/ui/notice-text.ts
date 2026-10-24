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

const PAST: Record<ActKind, string> = {
  create: 'created',
  edit: 'edited',
  delete: 'deleted',
  move: 'moved',
  search: 'searched for',
  read: 'read',
  other: 'used',
};

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
    const t = shortTarget(c.label || '');
    if (k === 'other') return `${actor} used ${c.action.replace(/[_.]+/g, ' ').trim() || 'Memora'}`;
    if (!t) return `${actor} ${k === 'search' ? 'searched your notes' : PAST[k] + ' a note'}`;
    return k === 'search' ? `${actor} searched for “${t}”` : `${actor} ${PAST[k]} ${t}`;
  }
  const notes = new Set(calls.map((c) => c.label)).size;
  if (kinds.size === 1) {
    const k = [...kinds][0];
    if (k === 'search') return `${actor} searched your notes ${calls.length} times`;
    if (k === 'other') return `${actor} used Memora ${calls.length} times`;
    if (notes === 1) return agentNotice(actor, [calls[0]]);
    return `${actor} ${PAST[k]} ${notes} note${notes === 1 ? '' : 's'}`;
  }
  const writes = calls.filter((c) => !['search', 'read', 'other'].includes(actKind(c.action)));
  if (writes.length) {
    const n = new Set(writes.map((c) => c.label)).size;
    return `${actor} changed ${n} note${n === 1 ? '' : 's'}`;
  }
  return `${actor} looked through your notes (${calls.length} times)`;
}
