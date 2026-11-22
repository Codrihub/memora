// Messages the server sends (API errors, Mnemo's notices, tool results) in the interface
// language. The server writes them in English: a fixed message is its own key (`t`), and a
// message with a changing part (a path, a model, a number) is matched against the shapes
// below, whose named groups fill the `{placeholders}` of the English key. Groups listed in
// `sub` are server words themselves ("too busy") and are translated in turn. A message no
// shape knows is shown as it came.

import { lang, t } from './index';

interface Shape {
  re: RegExp;
  key: string;
  sub?: readonly string[];
}

// The first shape that matches wins: specific ones come before general ones.
const SHAPES: readonly Shape[] = [
  { re: /^password must be at most (?<n>\d+) bytes$/, key: 'password must be at most {n} bytes' },
  { re: /^too many wrong passwords for showing keys; try again in (?<n>\d+) min$/, key: 'too many wrong passwords for showing keys; try again in {n} min' },
  { re: /^Too many failed attempts\. Try again in (?<n>\d+) minutes\.$/, key: 'Too many failed attempts. Try again in {n} minutes.' },
  { re: /^the new password must be at least (?<n>\d+) characters$/, key: 'the new password must be at least {n} characters' },
  { re: /^password must be at least (?<n>\d+) characters$/, key: 'password must be at least {n} characters' },
  { re: /^(?<path>.+) does not exist; tick "create folder if missing" to create it$/, key: '{path} does not exist; tick "create folder if missing" to create it' },
  { re: /^the parent folder (?<path>.+) does not exist$/, key: 'the parent folder {path} does not exist' },
  { re: /^cannot create (?<path>.+?): (?<error>.+)$/, key: 'cannot create {path}: {error}' },
  { re: /^(?<path>.+) is not writable by the server$/, key: '{path} is not writable by the server' },
  { re: /^at most (?<n>\d+) pins$/, key: 'at most {n} pins' },
  { re: /^GitHub answered HTTP (?<code>\d+)$/, key: 'GitHub answered HTTP {code}' },
  { re: /^cannot reach GitHub: (?<error>.+)$/, key: 'cannot reach GitHub: {error}' },
  { re: /^cannot read the answer: (?<error>.+)$/, key: 'cannot read the answer: {error}' },
  { re: /^(?<kind>Notes|Images|Chats) storage is full \((?<pct>[\d.]+)% of (?<room>its limit|the space left for it on the disk)\)\. (?<advice>.+)$/, key: '{kind} storage is full ({pct}% of {room}). {advice}', sub: ['kind', 'room', 'advice'] },
  { re: /^(?<kind>Notes|Images|Chats) storage is almost full \((?<pct>[\d.]+)% of (?<room>its limit|the space left for it on the disk)\)\. (?<advice>.+)$/, key: '{kind} storage is almost full ({pct}% of {room}). {advice}', sub: ['kind', 'room', 'advice'] },
  { re: /^(?<key>\w+) is 1 to 10000000 MB, or 0 for none$/, key: '{key} is 1 to 10000000 MB, or 0 for none' },
  { re: /^could not open the assistant store: (?<error>.+)$/, key: 'could not open the assistant store: {error}' },
  { re: /^Mnemo keeps at most (?<n>\d+) providers; delete one first$/, key: 'Mnemo keeps at most {n} providers; delete one first' },
  { re: /^no provider (?<id>.+); set it up in Settings, Mnemo$/, key: 'no provider {id}; set it up in Settings, Mnemo' },
  { re: /^(?<name>.+) has no API key yet$/, key: '{name} has no API key yet' },
  { re: /^(?<name>\w+) is out of range$/, key: '{name} is out of range' },
  { re: /^the provider answered (?<code>\d+): (?<msg>[\s\S]*)$/, key: 'the provider answered {code}: {msg}' },
  { re: /^could not reach the provider: (?<error>[\s\S]+)$/, key: 'could not reach the provider: {error}' },
  { re: /^this provider has no (?<what>\w+) API; pick a model from an OpenAI or OpenAI-compatible provider$/, key: 'this provider has no {what} API; pick a model from an OpenAI or OpenAI-compatible provider' },
  { re: /^the provider's answer broke off: (?<error>.+)$/, key: 'the provider\'s answer broke off: {error}' },
  { re: /^the model list is not JSON: (?<error>.+)$/, key: 'the model list is not JSON: {error}' },
  { re: /^the stream broke off: (?<error>.+)$/, key: 'the stream broke off: {error}' },
  { re: /^(?<key>\S+) is not a model$/, key: '{key} is not a model' },
  { re: /^no model is set to (?<what>.+) \(Settings, Mnemo, Models for each job\)$/, key: 'no model is set to {what} (Settings, Mnemo, Models for each job)', sub: ['what'] },
  { re: /^could not compact the chat: (?<error>.+)$/, key: 'could not compact the chat: {error}' },
  { re: /^attach at most (?<n>\d+) notes or folders$/, key: 'attach at most {n} notes or folders' },
  { re: /^(?<folder>.+): no such folder, or it has no notes$/, key: '{folder}: no such folder, or it has no notes' },
  { re: /^Could not compact the chat \((?<error>.+)\); older messages are left out instead\.$/, key: 'Could not compact the chat ({error}); older messages are left out instead.' },
  { re: /^(?<model>.+) cannot read pictures, so the image model looks at them for it\.$/, key: '{model} cannot read pictures, so the image model looks at them for it.' },
  { re: /^(?<model>.+) cannot read pictures, so it only gets their names\. Set a model that reads images, or switch this chat's model\.$/, key: '{model} cannot read pictures, so it only gets their names. Set a model that reads images, or switch this chat\'s model.' },
  { re: /^(?<model>.+) cannot read pictures, so the image model looked at them for it\.$/, key: '{model} cannot read pictures, so the image model looked at them for it.' },
  { re: /^(?<model>.+) cannot read pictures, so it only got their names\. Set a model that reads images, or switch this chat's model\.$/, key: '{model} cannot read pictures, so it only got their names. Set a model that reads images, or switch this chat\'s model.' },
  { re: /^(?<model>.+) did not answer \((?<why>.+)\); trying again in (?<wait>\d+) s \((?<n>\d+)\/(?<total>\d+)\)…$/, key: '{model} did not answer ({why}); trying again in {wait} s ({n}/{total})…', sub: ['why'] },
  { re: /^(?<model>.+) cannot look at images; the image model described them for it\.$/, key: '{model} cannot look at images; the image model described them for it.' },
  { re: /^(?<model>.+) cannot look at images; it got their names instead\. Set a model that reads images in Settings to have them seen\.$/, key: '{model} cannot look at images; it got their names instead. Set a model that reads images in Settings to have them seen.' },
  { re: /^Mnemo stopped after (?<n>\d+) steps; say "continue" to go on\.$/, key: 'Mnemo stopped after {n} steps; say "continue" to go on.' },
  { re: /^could not compact its work: (?<error>.+)$/, key: 'could not compact its work: {error}' },
  { re: /^Run (?<count>1 sub-agent|\d+ sub-agents at once)\? Each works on its own and uses its own tokens, roughly (?<low>\S+) to (?<high>\S+) in total\.\n(?<list>[\s\S]*)$/, key: 'Run {count}? Each works on its own and uses its own tokens, roughly {low} to {high} in total.\n{list}', sub: ['count'] },
  { re: /^(?<n>\d+) sub-agents at once$/, key: '{n} sub-agents at once' },
  { re: /^Not done: the owner switched (?<tool>\S+) off for Mnemo \(Settings, Mnemo\)\.$/, key: 'Not done: the owner switched {tool} off for Mnemo (Settings, Mnemo).' },
  { re: /^Not done: the owner switched (?<tool>\S+) off for sub-agents \(Settings, Mnemo\)\.$/, key: 'Not done: the owner switched {tool} off for sub-agents (Settings, Mnemo).' },
  { re: /^(?<tool>\S+) is not one of Mnemo's tools$/, key: '{tool} is not one of Mnemo\'s tools' },
  { re: /^Not started: there is no model \"(?<name>.+)\" here\. Tell the owner, or leave model out to use their default model\.$/, key: 'Not started: there is no model "{name}" here. Tell the owner, or leave model out to use their default model.' },
  { re: /^Not started: \"(?<name>.+)\" fits more than one model or none exactly\. Close ones: (?<list>.*)\. Ask the owner which, or give the exact id\.$/, key: 'Not started: "{name}" fits more than one model or none exactly. Close ones: {list}. Ask the owner which, or give the exact id.' },
  { re: /^no picture at (?<path>.+) in the vault \(list_images shows the pictures there\)$/, key: 'no picture at {path} in the vault (list_images shows the pictures there)' },
  { re: /^none of these exist: (?<list>.+)$/, key: 'none of these exist: {list}' },
  { re: /^give 1 to (?<n>\d+) steps$/, key: 'give 1 to {n} steps' },
  { re: /^no chat with id (?<id>.+)$/, key: 'no chat with id {id}' },
  { re: /^no page titled (?<title>.+) in that chat \(list_artifacts shows them\)$/, key: 'no page titled {title} in that chat (list_artifacts shows them)' },
  { re: /^no docs page (?<page>.+?); pages: (?<list>.*)$/, key: 'no docs page {page}; pages: {list}' },
  { re: /^no heading \"(?<h>.+)\" in (?<page>.+); call read_docs without a heading for the list$/, key: 'no heading "{h}" in {page}; call read_docs without a heading for the list' },
  { re: /^keep it under (?<n>\d+) characters$/, key: 'keep it under {n} characters' },
  { re: /^(?<n>\d+) notes is the most: merge or forget older ones first$/, key: '{n} notes is the most: merge or forget older ones first' },
  { re: /^no note (?<id>\S+) about the owner$/, key: 'no note {id} about the owner' },
  { re: /^(?<name>\S+) is not a memory tool$/, key: '{name} is not a memory tool' },
  { re: /^the image is (?<size>[\d.]+) MB; the largest allowed is (?<max>[\d.]+) MB \(Settings, Images\)$/, key: 'the image is {size} MB; the largest allowed is {max} MB (Settings, Images)' },
  { re: /^could not keep the image: (?<error>.+)$/, key: 'could not keep the image: {error}' },
  { re: /^(?<id>\S+) is not an image from this chat$/, key: '{id} is not an image from this chat' },
  { re: /^the image (?<id>\S+) is gone \(images wait a week\); ask the owner to attach it again$/, key: 'the image {id} is gone (images wait a week); ask the owner to attach it again' },
  { re: /^the image (?<id>\S+) is gone$/, key: 'the image {id} is gone' },
  { re: /^(?<n>\d+) results$/, key: '{n} results' },
  { re: /^restored: (?<value>.+)$/, key: 'restored: {value}' },
  { re: /^trashed: (?<value>.+)$/, key: 'trashed: {value}' },
  { re: /^to: (?<value>.+)$/, key: 'to: {value}' },
  { re: /^name: (?<value>.+)$/, key: 'name: {value}' },
  { re: /^count: (?<value>.+)$/, key: 'count: {value}' },
  { re: /^total: (?<value>.+)$/, key: 'total: {value}' },
  { re: /^(?<tool>[\w-]+): missing required arguments? (?<list>.+?)\. (?<usage>.*)$/, key: '{tool}: missing required argument {list}. {usage}' },
  { re: /^(?<tool>[\w-]+): unknown arguments? (?<list>.+?)\. (?<usage>.*)$/, key: '{tool}: unknown argument {list}. {usage}' },
  { re: /^(?<tool>[\w-]+): `(?<k>\w+)` must be one of (?<list>.+) \(got '(?<got>.*)'\)\.$/, key: '{tool}: `{k}` must be one of {list} (got \'{got}\').' },
  { re: /^(?<tool>[\w-]+): `(?<k>\w+)` must be at least (?<min>-?\d+) \(got (?<n>-?\d+)\)\.$/, key: '{tool}: `{k}` must be at least {min} (got {n}).' },
  { re: /^(?<name>.+) already exists in the exchange folder; pass overwrite: true to replace it, or choose another out_path$/, key: '{name} already exists in the exchange folder; pass overwrite: true to replace it, or choose another out_path' },
  { re: /^(?<name>.+) not found in the exchange folder$/, key: '{name} not found in the exchange folder' },
  { re: /^unknown tool: (?<name>[\w-]+)/, key: 'unknown tool: {name}' },
  { re: /^destination folder not found: (?<folder>.+)$/, key: 'destination folder not found: {folder}' },
  { re: /^folder not found: (?<folder>.+)$/, key: 'folder not found: {folder}' },
  { re: /^image not found: (?<path>.+)$/, key: 'image not found: {path}' },
  { re: /^not found: (?<path>.+)$/, key: 'not found: {path}' },
  { re: /^already in the trash: (?<path>.+)$/, key: 'already in the trash: {path}' },
  { re: /^already exists: (?<path>.+)$/, key: 'already exists: {path}' },
  { re: /^permission denied: (?<path>.+)$/, key: 'permission denied: {path}' },
  { re: /^(?<path>.+) is a folder, not a note: give a note path$/, key: '{path} is a folder, not a note: give a note path' },
  { re: /^`(?<path>.+)` is a folder, not a note$/, key: '`{path}` is a folder, not a note' },
  { re: /^destination (?<path>.+) is a note, not a folder$/, key: 'destination {path} is a note, not a folder' },
  { re: /^folder `(?<path>.+)` is a note, not a folder$/, key: 'folder `{path}` is a note, not a folder' },
  { re: /^(?<path>.+) is a note, not a folder$/, key: '{path} is a note, not a folder' },
  { re: /^(?<path>.+) is a folder; restore one note at a time$/, key: '{path} is a folder; restore one note at a time' },
  { re: /^(?<path>.+) is a folder; locks are taken on single notes$/, key: '{path} is a folder; locks are taken on single notes' },
  { re: /^(?<path>.+) is not a folder$/, key: '{path} is not a folder' },
  { re: /^could not create folder (?<path>.+?): (?<error>.+)$/, key: 'could not create folder {path}: {error}' },
  { re: /^invalid folder name: (?<name>.+)$/, key: 'invalid folder name: {name}' },
  { re: /^invalid folder path: (?<path>.+)$/, key: 'invalid folder path: {path}' },
  { re: /^path not allowed: (?<path>.+)$/, key: 'path not allowed: {path}' },
  { re: /^path escapes the vault: (?<path>.+)$/, key: 'path escapes the vault: {path}' },
  { re: /^`(?<path>.+)` is listed more than once$/, key: '`{path}` is listed more than once' },
  { re: /^tag '(?<tag>.+)' is not on any note$/, key: 'tag \'{tag}\' is not on any note' },
  { re: /^the old and the new tag are the same: '(?<tag>.+)'$/, key: 'the old and the new tag are the same: \'{tag}\'' },
  { re: /^no revision at or before that date: (?<rev>.+)$/, key: 'no revision at or before that date: {rev}' },
  { re: /^give one revision, not a range: (?<rev>.+)$/, key: 'give one revision, not a range: {rev}' },
  { re: /^(?<n>\d+) minutes$/, key: '{n} minutes' },
  { re: /^(?<n>\d+) session\(s\) signed out from settings$/, key: '{n} session(s) signed out from settings' },
  { re: /^(?<mb>[\d.]+) MB, (?<days>\d+) days$/, key: '{mb} MB, {days} days' },
];

function tr(msg: string, depth: number): string {
  const s = msg.trim();
  const exact = t(s);
  if (exact !== s) return exact;
  for (const p of SHAPES) {
    const m = p.re.exec(s);
    if (!m) continue;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.groups || {})) {
      vars[k] = v && depth < 2 && p.sub?.includes(k) ? tr(v, depth + 1) : v ?? '';
    }
    return t(p.key, vars);
  }
  return msg;
}

/** A message from the server in the interface language (unchanged when it is not known). */
export function ts(msg: string): string {
  if (!msg || typeof msg !== 'string' || lang() === 'en') return msg;
  return tr(msg, 0);
}
