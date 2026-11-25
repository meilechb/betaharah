/**
 * The operator's changes to the texts, and how a text is made from a
 * message of the registry (messages.ts):
 *
 *   - per message, a changed body and changed option labels;
 *   - the general words, one list per action;
 *   - the prefix of the options line (default "Reply:").
 *
 * They are stored as one row of the `site` table (readable JSON: nothing
 * in it is secret) and loaded with the rest of the site's settings in its
 * one query (store.loadSite), so that no text costs an extra query.
 *
 * A text is its body with the placeholders filled, then, on a line of its
 * own, the prefix and the labels of its options: "Reply: DONE, STATUS". By
 * RCS the same options are buttons, each sending exactly its label.
 *
 * Replies are matched to options and words plainly: trim, ignore case and
 * punctuation; a reply matches an option when it equals its label, or
 * contains one of the option's own words as a whole word, and exactly one
 * option matches. No guessing.
 */
import { DEFAULT_WORDS, GENERAL_ACTIONS, MAIN, MESSAGE_BY_KEY, MESSAGES, messageDef, OPTION_FAMILY, type MessageDef } from './messages';
import { foldToGsm, isGsmBasic, MAX_TEXT_CHARS, repairs, segments } from './gsm';
import { CATEGORIES, TEXT_SETS, textMeta } from './messages-meta';
import { ValidationError } from '../settings';

export interface MessageChange {
  body?: string;
  labels?: Record<string, string>;
}

export interface SiteTexts {
  messages: Record<string, MessageChange>;
  /** Only the lists the operator changed; the others are the defaults. */
  words: Record<string, string[]>;
  prefix: string;
}

export const DEFAULT_PREFIX = 'Reply:';
export const NO_TEXTS: SiteTexts = Object.freeze({ messages: {}, words: {}, prefix: DEFAULT_PREFIX }) as SiteTexts;

/** Most options offered with one message. */
export const MAX_OPTIONS = 6;
export const MAX_LABEL = 20;

/** The words Telnyx and the carriers act on (service.ts): never a label or a general word. */
export const CARRIER_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT', 'START', 'UNSTOP', 'HELP', 'INFO']);

/** Small words that never by themselves pick an option. */
const STOP_WORDS = new Set(['A', 'AN', 'THE', 'AND', 'OR', 'OF', 'TO', 'ON', 'IN', 'BY', 'AT', 'FOR', 'IS', 'IT', 'MY', 'I']);

// ---------- reading what was stored ----------

const PLACEHOLDER = /\{(\w+)\}/g;
const LABEL = /^[A-Za-z0-9 ]{1,20}$/;
const WORD = /^[a-z0-9]{1,20}$/;

/**
 * The stored changes, checked. Anything that does not fit (a message no
 * longer in the registry, a label for an option it no longer has, a value
 * that is not valid now) is left out, so that a change of the registry can
 * never stop the site from loading; the defaults stand in for it.
 */
export function parseSiteTexts(input: unknown): SiteTexts {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return NO_TEXTS;
  const o = input as Record<string, unknown>;
  const out: SiteTexts = { messages: {}, words: {}, prefix: DEFAULT_PREFIX };
  if (typeof o.prefix === 'string' && prefixProblem(o.prefix) === null) out.prefix = o.prefix.trim();
  if (typeof o.words === 'object' && o.words !== null && !Array.isArray(o.words)) {
    for (const [action, list] of Object.entries(o.words as Record<string, unknown>)) {
      if (!Object.hasOwn(DEFAULT_WORDS, action) || !Array.isArray(list)) continue;
      const words = list.filter((w): w is string => typeof w === 'string' && WORD.test(w));
      if (words.length > 0) out.words[action] = [...new Set(words)];
    }
  }
  if (typeof o.messages === 'object' && o.messages !== null && !Array.isArray(o.messages)) {
    for (const [key, raw] of Object.entries(o.messages as Record<string, unknown>)) {
      const def = MESSAGE_BY_KEY.get(key);
      if (!def || typeof raw !== 'object' || raw === null) continue;
      const change: MessageChange = {};
      const r = raw as { body?: unknown; labels?: unknown };
      if (typeof r.body === 'string' && bodyProblem(def, r.body) === null) change.body = r.body;
      if (typeof r.labels === 'object' && r.labels !== null && !def.filed) {
        const labels: Record<string, string> = {};
        for (const opt of def.options) {
          const v = (r.labels as Record<string, unknown>)[opt.id];
          if (typeof v === 'string' && LABEL.test(v.trim())) labels[opt.id] = v.trim().replace(/ +/g, ' ');
        }
        if (Object.keys(labels).length > 0) change.labels = labels;
      }
      if (change.body !== undefined || change.labels) out.messages[key] = change;
    }
  }
  return out;
}

/** Each action's words: the operator's list, or the default. */
export function generalWords(texts: SiteTexts): Record<string, string[]> {
  return { ...DEFAULT_WORDS, ...texts.words };
}

// ---------- making a text ----------

export type Vars = Record<string, string>;

export function bodyOf(texts: SiteTexts, key: string): string {
  return texts.messages[key]?.body ?? messageDef(key).body;
}

export function fill(template: string, vars: Vars): string {
  return template.replace(PLACEHOLDER, (_, name: string) => vars[name] ?? '');
}

/** The body with its placeholders filled. */
export function renderBody(texts: SiteTexts, key: string, vars: Vars = {}): string {
  return fill(bodyOf(texts, key), vars);
}

/** The options offered, as [id, label]: all of the message's, or those of `offer`, in the message's order. */
export function optionsOf(texts: SiteTexts, key: string, offer?: readonly string[]): Array<[string, string]> {
  const def = messageDef(key);
  const labels = texts.messages[key]?.labels ?? {};
  return def.options.filter(opt => !offer || offer.includes(opt.id)).map(opt => [opt.id, labels[opt.id] ?? opt.label] as [string, string]);
}

/** "Reply: DONE, STATUS", or '' with no options. */
export function optionsLine(texts: SiteTexts, labels: readonly string[]): string {
  return labels.length === 0 ? '' : `${texts.prefix} ${labels.join(', ')}`;
}

/** The whole SMS: the body, and the options on the last line. */
export function smsText(texts: SiteTexts, body: string, labels: readonly string[]): string {
  const line = optionsLine(texts, labels);
  return line ? `${body}\n${line}` : body;
}

export interface Piece {
  key: string;
  vars?: Vars;
  /** The option ids offered; all of the message's when absent. */
  offer?: readonly string[];
}

/** One text to send: the SMS, the body alone (the RCS text), and the options as RCS buttons. */
export interface RenderedText {
  text: string;
  body: string;
  options: Array<[string, string]>;
}

/**
 * The texts for a reply made of one or more messages: their bodies joined,
 * with the options of the last. Normally one text; two when the bodies with
 * the options line do not fit two segments, each then ending with the same
 * options. GSM-7 and at most two segments each (the guard is a last resort
 * the tests keep unused).
 */
export function compose(texts: SiteTexts, pieces: readonly Piece[]): RenderedText[] {
  if (pieces.length === 0) return [];
  const last = pieces[pieces.length - 1] as Piece;
  const options = messageDef(last.key).filed ? [] : optionsOf(texts, last.key, last.offer);
  const labels = options.map(([, l]) => l);
  const line = optionsLine(texts, labels);
  const room = MAX_TEXT_CHARS - (line ? line.length + 1 : 0);
  const groups: string[] = [];
  for (const p of pieces) {
    const body = renderBody(texts, p.key, p.vars).trim();
    if (body === '') continue;
    const prev = groups[groups.length - 1];
    if (prev !== undefined && prev.length + 1 + body.length <= room) groups[groups.length - 1] = `${prev} ${body}`;
    else groups.push(body);
  }
  while (groups.length > 2) {
    const tail = groups.pop() as string;
    groups[groups.length - 1] = `${groups[groups.length - 1]} ${tail}`;
  }
  return groups.map(g => {
    const body = guardBody(g, room);
    return { text: line ? `${body}\n${line}` : body, body, options };
  });
}

function guardBody(text: string, room: number): string {
  let t = text;
  if (!isGsmBasic(t)) {
    repairs.folded++;
    t = foldToGsm(t);
  }
  if (t.length > room) {
    repairs.shortened++;
    const cut = t.slice(0, room - 3);
    const end = cut.lastIndexOf('. ');
    t = end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}...`;
  }
  return t;
}

/** A filed text (no options), e.g. the sign-in code. */
export function filedText(texts: SiteTexts, key: string, vars: Vars = {}): string {
  return renderBody(texts, key, vars);
}

// ---------- reading a reply ----------

/**
 * Words whose spelling changed, read as the spelling shown now: a reply,
 * a label and a word list may each have either one ("SHABBAT" is read as
 * "SHABBOS", "BEDIKOT" as "BEDIKOS"), so both are always understood.
 */
const RESPELLED: Record<string, string> = {
  SHABBAT: 'SHABBOS',
  BEDIKOT: 'BEDIKOS',
  VESATOT: 'VESTOS',
  VESET: 'VEST',
  ONOT: 'ONOS',
  ONAT: 'ONAS',
  BEINONIT: 'BEINONIS',
  TEVET: 'TEVES',
  SHEVAT: 'SHVAT',
};

/** One word, in capitals, as it is compared: "shabbat" and "Shabbos" are both "SHABBOS". */
export function wordKey(word: string): string {
  const w = word.toUpperCase();
  return Object.hasOwn(RESPELLED, w) ? (RESPELLED[w] as string) : w;
}

/** The words of a text: capitals, letters and digits only, each as compared (wordKey). */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(w => w !== '')
    .map(wordKey);
}

export type Match = { id: string; rest: string[] } | 'ambiguous' | null;

/**
 * The tokens of `raw` that are not among `used` (as typed, lowercased, with
 * punctuation at their ends removed): what follows a word, such as a date.
 */
export function restOf(raw: string, used: ReadonlySet<string>): string[] {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(t => t !== '' && !(wordsOf(t).length > 0 && wordsOf(t).every(w => used.has(w))));
}

/**
 * Which of the options offered a reply chooses. `own` gives the general
 * words that also choose an option (the main option PERIOD is also chosen
 * by "flow"). Exact label first; then the option whose own words (the
 * words of its label that no other offered label has, and `own`) appear in
 * the reply, if exactly one does.
 */
export function matchOption(raw: string, options: ReadonlyArray<readonly [string, string]>, own: (id: string) => readonly string[] = () => []): Match {
  const words = wordsOf(raw);
  if (words.length === 0) return null;
  const joined = words.join(' ');
  const exact = options.filter(([, label]) => wordsOf(label).join(' ') === joined);
  if (exact.length === 1) return { id: exact[0]![0], rest: [] };
  if (exact.length > 1) return 'ambiguous';
  const counts = new Map<string, number>();
  for (const [, label] of options) for (const w of new Set(wordsOf(label))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const said = new Set(words);
  const hits: Array<{ id: string; mine: Set<string> }> = [];
  for (const [id, label] of options) {
    const mine = new Set<string>([...wordsOf(label).filter(w => counts.get(w) === 1 && !STOP_WORDS.has(w)), ...own(id).map(wordKey)]);
    if ([...mine].some(w => said.has(w))) hits.push({ id, mine: new Set([...mine, ...wordsOf(label)]) });
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) return 'ambiguous';
  const hit = hits[0]!;
  return { id: hit.id, rest: restOf(raw, hit.mine) };
}

/** Which general action a reply names, if exactly one. */
export function matchGeneral(raw: string, lists: Record<string, readonly string[]>): Match {
  const said = new Set(wordsOf(raw));
  const hits = Object.entries(lists).filter(([, words]) => words.some(w => said.has(wordKey(w))));
  if (hits.length === 0) return null;
  if (hits.length > 1) return 'ambiguous';
  const [action, words] = hits[0]!;
  return { id: action, rest: restOf(raw, new Set(words.map(wordKey))) };
}

/** The general actions a reply names (for telling whether a reply is about something else than the options). */
export function generalActionsIn(raw: string, lists: Record<string, readonly string[]>): string[] {
  const said = new Set(wordsOf(raw));
  return Object.entries(lists)
    .filter(([, words]) => words.some(w => said.has(wordKey(w))))
    .map(([a]) => a);
}

// ---------- checking the operator's changes ----------

/** An error about one field of the Texts page: "body", "label.<id>", "words.<action>" or "prefix". */
export class TextsError extends ValidationError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'TextsError';
  }
}

function notGsm(text: string): string | null {
  for (const ch of text) if (!isGsmBasic(ch)) return ch;
  return null;
}

function describeChar(ch: string): string {
  const names: Record<string, string> = { '‘': 'a curly quote', '’': 'a curly apostrophe', '“': 'a curly quote', '”': 'a curly quote', '–': 'a dash', '—': 'a long dash', '…': 'an ellipsis', '\t': 'a tab' };
  return names[ch] ?? `"${ch}"`;
}

function bodyProblem(def: MessageDef, body: string): string | null {
  if (body.trim() === '') return 'The text is empty.';
  const used = new Set([...body.matchAll(PLACEHOLDER)].map(m => m[1] as string));
  const known = new Set(def.vars.map(v => v.name));
  for (const name of used) if (!known.has(name)) return `{${name}} is not a placeholder of this text. It has: ${def.vars.map(v => `{${v.name}}`).join(', ') || 'none'}.`;
  for (const v of def.vars) if (v.required && !used.has(v.name)) return `{${v.name}} must stay in the text.`;
  const plain = body.replace(PLACEHOLDER, '');
  if (/[{}]/.test(plain)) return 'A { or } is not part of a placeholder. Placeholders are written like {day}.';
  const ch = notGsm(plain);
  if (ch !== null) return `${describeChar(ch)} is not in the basic SMS alphabet (GSM-7); it would make every text cost about twice as much. Use plain characters.`;
  return null;
}

function prefixProblem(prefix: string): string | null {
  const p = prefix.trim();
  if (p === '') return 'The prefix is empty.';
  if (p.length > 20) return 'The prefix has more than 20 characters.';
  const ch = notGsm(p);
  if (ch !== null) return `${describeChar(ch)} is not in the basic SMS alphabet (GSM-7).`;
  return null;
}

/** The words of general lists other than the option's own action (and its family). */
function foreignWords(id: string, lists: Record<string, readonly string[]>): Map<string, string> {
  const own = new Set([id, ...(OPTION_FAMILY[id] ?? [])]);
  const out = new Map<string, string>();
  for (const [action, words] of Object.entries(lists)) if (!own.has(action)) for (const w of words) out.set(wordKey(w), action);
  return out;
}

const actionName = (action: string): string => GENERAL_ACTIONS.find(a => a.action === action)?.name ?? action;

function labelProblem(id: string, label: string, lists: Record<string, readonly string[]>): string | null {
  const l = label.trim();
  if (l === '') return 'The label is empty.';
  if (l.length > MAX_LABEL) return `The label has more than ${MAX_LABEL} characters.`;
  if (!LABEL.test(l)) return 'A label has only letters, digits and spaces.';
  for (const w of wordsOf(l)) if (CARRIER_WORDS.has(w)) return `${w} is a word the carrier acts on (it stops or starts texts, or sends help); it cannot be a label.`;
  if (/^\d$/.test(l)) return 'A digit alone cannot be a label.';
  const foreign = foreignWords(id, lists);
  for (const w of wordsOf(l)) {
    const action = foreign.get(w);
    if (action) return `${w} is a general word for "${actionName(action)}"; this option does something else.`;
  }
  return null;
}

/**
 * Checks a message as the operator would save it: its body and labels, and
 * the whole text with the example values and the options line. Throws a
 * TextsError naming the field.
 */
export function checkMessage(texts: SiteTexts, key: string, body: string, labels: Record<string, string>): void {
  const def = MESSAGE_BY_KEY.get(key);
  if (!def) throw new TextsError('key', 'There is no such text.');
  const b = bodyProblem(def, body);
  if (b) throw new TextsError('body', b);
  if (def.filed && Object.keys(labels).length > 0) throw new TextsError('body', 'The texts filed with the carrier have no options.');
  const lists = generalWords(texts);
  const seen = new Map<string, string>();
  for (const opt of def.options) {
    const label = (labels[opt.id] ?? opt.label).trim().replace(/ +/g, ' ');
    const p = labelProblem(opt.id, label, lists);
    if (p) throw new TextsError(`label.${opt.id}`, p);
    const norm = wordsOf(label).join(' ');
    if (seen.has(norm)) throw new TextsError(`label.${opt.id}`, `Two options are labelled ${label}.`);
    seen.set(norm, opt.id);
  }
  for (const id of Object.keys(labels)) if (!def.options.some(opt => opt.id === id)) throw new TextsError(`label.${id}`, 'This text has no such option.');
  const length = exampleLength({ ...texts, messages: { ...texts.messages, [key]: { body, labels } } }, key);
  if (length > MAX_TEXT_CHARS) {
    throw new TextsError('body', `With the example values and the options line the text has ${length} characters; at most ${MAX_TEXT_CHARS} (two SMS segments).`);
  }
}

/** Checks the general words and the prefix. Throws a TextsError naming the field. */
export function checkWords(texts: SiteTexts, words: Record<string, string[]>, prefix: string): void {
  const p = prefixProblem(prefix);
  if (p) throw new TextsError('prefix', p);
  const owner = new Map<string, string>();
  for (const a of GENERAL_ACTIONS) {
    const list = words[a.action] ?? a.words;
    const field = `words.${a.action}`;
    if (list.length === 0) throw new TextsError(field, 'Each action needs at least one word.');
    for (const w of list) {
      if (!WORD.test(w)) throw new TextsError(field, `"${w}" is not one word of letters and digits (at most 20).`);
      if (/^\d+$/.test(w)) throw new TextsError(field, `"${w}" is only digits; digits are not words here.`);
      if (CARRIER_WORDS.has(w.toUpperCase())) throw new TextsError(field, `"${w}" is a word the carrier acts on.`);
      const key = wordKey(w).toLowerCase(); // "vesatot" and "vestos" are one word
      const other = owner.get(key);
      if (other && other !== a.action) throw new TextsError(field, `"${w}" is already a word for "${actionName(other)}".`);
      owner.set(key, a.action);
    }
  }
  const lists = generalWords({ ...texts, words });
  for (const def of MESSAGES) {
    for (const [id, label] of optionsOf(texts, def.key)) {
      const problem = labelProblem(id, label, lists);
      if (problem) {
        const w = wordsOf(label).find(x => owner.has(x.toLowerCase()) && foreignWords(id, lists).has(x));
        const action = w ? owner.get(w.toLowerCase()) : undefined;
        throw new TextsError(action ? `words.${action}` : 'prefix', `"${(w ?? label).toLowerCase()}" is a word of the option ${label} of "${def.key}", which does something else.`);
      }
    }
  }
  for (const def of MESSAGES) {
    const length = exampleLength({ ...texts, prefix: prefix.trim() }, def.key);
    if (length > MAX_TEXT_CHARS) throw new TextsError('prefix', `With this prefix "${def.key}" would have ${length} characters; at most ${MAX_TEXT_CHARS}.`);
  }
}

/** The values a message's preview uses. */
export function exampleVars(def: MessageDef): Vars {
  return Object.fromEntries(def.vars.map(v => [v.name, v.example]));
}

/** The length of a message with its example values and all its options. */
export function exampleLength(texts: SiteTexts, key: string): number {
  const def = messageDef(key);
  const body = renderBody(texts, key, exampleVars(def));
  return def.filed ? body.length : smsText(texts, body, optionsOf(texts, key).map(([, l]) => l)).length;
}

/** What the Texts page shows for each message. */
export function textsForConsole(texts: SiteTexts) {
  return {
    prefix: texts.prefix,
    defaultPrefix: DEFAULT_PREFIX,
    maxChars: MAX_TEXT_CHARS,
    maxLabel: MAX_LABEL,
    main: MAIN.map(([id]) => id),
    messages: MESSAGES.map(def => {
      const change = texts.messages[def.key];
      const options = optionsOf(texts, def.key);
      const body = bodyOf(texts, def.key);
      const example = renderBody(texts, def.key, exampleVars(def));
      const text = def.filed ? example : smsText(texts, example, options.map(([, l]) => l));
      return {
        key: def.key,
        group: def.group,
        when: def.when,
        filed: def.filed === true,
        body,
        defaultBody: def.body,
        vars: def.vars,
        options: def.options.map(opt => ({ id: opt.id, label: change?.labels?.[opt.id] ?? opt.label, defaultLabel: opt.label })),
        changed: change !== undefined,
        length: text.length,
        segments: segments(text),
        // how the Texts page lists it (messages-meta.ts)
        meta: textMeta(def.key, def.when),
      };
    }),
    categories: CATEGORIES,
    sets: TEXT_SETS,
    words: GENERAL_ACTIONS.map(a => ({ action: a.action, name: a.name, words: texts.words[a.action] ?? a.words, defaults: a.words })),
  };
}
