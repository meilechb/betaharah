/** The text-message conversation engine. See engine.ts and docs/TEXTING.md. */
export { begin, CHAT_TTL_MS, converse, greet, INVITE_DAYS, joinWord, normalize, validChat } from './engine';
export { parseDated, recordDated, resolveDate } from './dated';
export { SMS_CUSTOMS } from './customs';
export { isGsmBasic, segments, MAX_TEXT_CHARS, SEGMENT_CHARS } from './gsm';
export { WEB_LINK_TEXT } from './texts';
export type * from './types';
