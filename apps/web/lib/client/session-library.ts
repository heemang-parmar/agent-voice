import { LIMITS } from '@agent-voice/protocol';
import { z } from 'zod';

import { MAX_TRANSCRIPT_ENTRIES, type TranscriptEntry } from './session-state';

/**
 * A bounded, device-local record of past conversations.
 *
 * This is the browser's own `localStorage` and nothing else: there is no
 * account, no server table and no sync. A different browser, a different
 * device, or a cleared site setting is a different (empty) library, and the
 * drawer says so in as many words.
 *
 * Everything here is pure and total. `localStorage` can be absent, blocked by
 * a privacy setting, full, or hold data some older or hostile writer left
 * behind, so every read is validated and every write is allowed to fail.
 */

export const LIBRARY_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'agent-voice.session-library';

export const MAX_CONVERSATIONS = 100;
export const MAX_GROUPS = 50;
export const MAX_TITLE_CHARS = 80;
export const MAX_GROUP_NAME_CHARS = 60;
export const DEFAULT_TITLE = 'New conversation';

/** Ids we mint are short; this only has to stop an absurd stored value. */
const MAX_ID_CHARS = 200;
const MAX_TIMESTAMP_CHARS = 64;

export interface LibraryConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  groupId: string | null;
  transcript: TranscriptEntry[];
}

export interface LibraryGroup {
  id: string;
  name: string;
  createdAt: string;
}

export interface SessionLibrary {
  version: number;
  conversations: LibraryConversation[];
  groups: LibraryGroup[];
}

export interface LibrarySections {
  pinned: LibraryConversation[];
  groups: { group: LibraryGroup; conversations: LibraryConversation[] }[];
  recent: LibraryConversation[];
}

export function emptyLibrary(): SessionLibrary {
  return { version: LIBRARY_SCHEMA_VERSION, conversations: [], groups: [] };
}

/* -------------------------------------------------------------- Validation */

const idSchema = z.string().min(1).max(MAX_ID_CHARS);
const timestampSchema = z.string().min(1).max(MAX_TIMESTAMP_CHARS);

const transcriptEntrySchema = z.object({
  id: idSchema,
  role: z.enum(['user', 'agent']),
  text: z.string().max(LIMITS.maxTextChars),
  final: z.boolean(),
  ts: timestampSchema,
});

const conversationSchema = z.object({
  id: idSchema,
  title: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  pinned: z.boolean(),
  groupId: idSchema.nullable(),
  transcript: z.array(z.unknown()),
});

const groupSchema = z.object({
  id: idSchema,
  name: z.string(),
  createdAt: timestampSchema,
});

const librarySchema = z.object({
  version: z.number(),
  conversations: z.array(z.unknown()),
  groups: z.array(z.unknown()),
});

function boundedText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trimEnd();
}

function boundTitle(value: string): string {
  const bounded = boundedText(value, MAX_TITLE_CHARS);
  return bounded.length === 0 ? DEFAULT_TITLE : bounded;
}

function lastEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.length > MAX_TRANSCRIPT_ENTRIES
    ? entries.slice(entries.length - MAX_TRANSCRIPT_ENTRIES)
    : entries;
}

/**
 * Drops the least useful records first when a library is over the ceiling:
 * unpinned before pinned, oldest before newest. Ties fall to the later array
 * slot, so the caller's newest-first order decides.
 */
function boundConversations(list: LibraryConversation[]): LibraryConversation[] {
  if (list.length <= MAX_CONVERSATIONS) return list;
  const ordered = list
    .map((record, index) => ({ record, index }))
    .sort(
      (a, b) =>
        Number(a.record.pinned) - Number(b.record.pinned) ||
        a.record.updatedAt.localeCompare(b.record.updatedAt) ||
        b.index - a.index,
    );
  const dropped = new Set(
    ordered.slice(0, list.length - MAX_CONVERSATIONS).map((item) => item.record.id),
  );
  return list.filter((record) => !dropped.has(record.id));
}

/**
 * Rebuilds a library from whatever the browser handed back. Anything that
 * does not validate is dropped rather than repaired, so a single corrupt row
 * can never take the rest of the history with it.
 */
export function parseLibrary(raw: string | null): SessionLibrary {
  if (raw === null || raw.length === 0) return emptyLibrary();

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return emptyLibrary();
  }

  const outer = librarySchema.safeParse(decoded);
  if (!outer.success || outer.data.version !== LIBRARY_SCHEMA_VERSION) return emptyLibrary();

  const groups: LibraryGroup[] = [];
  const groupIds = new Set<string>();
  for (const candidate of outer.data.groups) {
    if (groups.length >= MAX_GROUPS) break;
    const parsed = groupSchema.safeParse(candidate);
    if (!parsed.success || groupIds.has(parsed.data.id)) continue;
    const name = boundedText(parsed.data.name, MAX_GROUP_NAME_CHARS);
    if (name.length === 0) continue;
    groupIds.add(parsed.data.id);
    groups.push({ id: parsed.data.id, name, createdAt: parsed.data.createdAt });
  }

  const conversations: LibraryConversation[] = [];
  const seen = new Set<string>();
  for (const candidate of outer.data.conversations) {
    const parsed = conversationSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    const transcript: TranscriptEntry[] = [];
    for (const turn of parsed.data.transcript) {
      const entry = transcriptEntrySchema.safeParse(turn);
      if (entry.success) transcript.push(entry.data);
    }
    conversations.push({
      id: parsed.data.id,
      title: boundTitle(parsed.data.title),
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
      pinned: parsed.data.pinned,
      // A group the file no longer contains is a dangling reference, not a
      // reason to hide the conversation.
      groupId:
        parsed.data.groupId !== null && groupIds.has(parsed.data.groupId)
          ? parsed.data.groupId
          : null,
      transcript: lastEntries(transcript),
    });
  }

  return {
    version: LIBRARY_SCHEMA_VERSION,
    conversations: boundConversations(conversations),
    groups,
  };
}

/** The exact serialised shape, with no incidental fields riding along. */
export function libraryReadyForStorage(library: SessionLibrary): SessionLibrary {
  return {
    version: LIBRARY_SCHEMA_VERSION,
    conversations: library.conversations.map((record) => ({
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      pinned: record.pinned,
      groupId: record.groupId,
      transcript: record.transcript.map((entry) => ({
        id: entry.id,
        role: entry.role,
        text: entry.text,
        final: entry.final,
        ts: entry.ts,
      })),
    })),
    groups: library.groups.map((group) => ({
      id: group.id,
      name: group.name,
      createdAt: group.createdAt,
    })),
  };
}

/* ------------------------------------------------------------- Pure edits */

/** The first thing the user actually finished saying, or an honest default. */
export function deriveTitle(transcript: TranscriptEntry[]): string {
  for (const entry of transcript) {
    if (entry.role !== 'user' || !entry.final) continue;
    const title = boundedText(entry.text, MAX_TITLE_CHARS);
    if (title.length > 0) return title;
  }
  return DEFAULT_TITLE;
}

export interface UpsertInput {
  id: string;
  transcript: TranscriptEntry[];
  now: string;
}

/**
 * Archives the live session under one stable ui-side id. The transport's
 * `conversationId` starts as null and becomes a room id once the first event
 * binds it, so it can never be the key here without splitting one session
 * across two records.
 */
export function upsertConversation(
  library: SessionLibrary,
  { id, transcript, now }: UpsertInput,
): SessionLibrary {
  if (transcript.length === 0) return library;
  const bounded = lastEntries(transcript);
  const existing = library.conversations.find((record) => record.id === id);

  if (!existing) {
    const created: LibraryConversation = {
      id,
      title: deriveTitle(bounded),
      createdAt: now,
      updatedAt: now,
      pinned: false,
      groupId: null,
      transcript: bounded,
    };
    return {
      ...library,
      conversations: boundConversations([created, ...library.conversations]),
    };
  }

  const updated: LibraryConversation = {
    ...existing,
    // A title the user chose is theirs. Only one that is still the fallback
    // may be filled in later, once the conversation has a first user turn.
    title: existing.title === DEFAULT_TITLE ? deriveTitle(bounded) : existing.title,
    updatedAt: now,
    transcript: bounded,
  };
  return {
    ...library,
    conversations: [updated, ...library.conversations.filter((record) => record.id !== id)],
  };
}

function mapConversation(
  library: SessionLibrary,
  id: string,
  update: (record: LibraryConversation) => LibraryConversation,
): SessionLibrary | null {
  const index = library.conversations.findIndex((record) => record.id === id);
  if (index === -1) return null;
  return {
    ...library,
    conversations: library.conversations.map((record, i) =>
      i === index ? update(record) : record,
    ),
  };
}

export function renameConversation(
  library: SessionLibrary,
  id: string,
  title: string,
): SessionLibrary {
  const bounded = boundedText(title, MAX_TITLE_CHARS);
  if (bounded.length === 0) return library;
  return mapConversation(library, id, (record) => ({ ...record, title: bounded })) ?? library;
}

export function setConversationPinned(
  library: SessionLibrary,
  id: string,
  pinned: boolean,
): SessionLibrary {
  return mapConversation(library, id, (record) => ({ ...record, pinned })) ?? library;
}

export interface AddGroupInput {
  id: string;
  name: string;
  now: string;
}

export function addGroup(
  library: SessionLibrary,
  { id, name, now }: AddGroupInput,
): SessionLibrary {
  const bounded = boundedText(name, MAX_GROUP_NAME_CHARS);
  if (bounded.length === 0 || library.groups.length >= MAX_GROUPS) return library;
  if (library.groups.some((group) => group.id === id)) return library;
  return { ...library, groups: [...library.groups, { id, name: bounded, createdAt: now }] };
}

export function moveConversation(
  library: SessionLibrary,
  id: string,
  groupId: string | null,
): SessionLibrary {
  if (groupId !== null && !library.groups.some((group) => group.id === groupId)) return library;
  return mapConversation(library, id, (record) => ({ ...record, groupId })) ?? library;
}

/**
 * Files every conversation into exactly one drawer section. Pinned wins over
 * a group, a group wins over Recent, and a group nobody is filed under is
 * left out entirely rather than rendered as a bare heading.
 */
export function librarySections(library: SessionLibrary): LibrarySections {
  const pinned = library.conversations.filter((record) => record.pinned);
  const groups = library.groups
    .map((group) => ({
      group,
      conversations: library.conversations.filter(
        (record) => !record.pinned && record.groupId === group.id,
      ),
    }))
    .filter((section) => section.conversations.length > 0);
  const recent = library.conversations.filter(
    (record) => !record.pinned && record.groupId === null,
  );
  return { pinned, groups, recent };
}

/* --------------------------------------------------------------- Storage */

/**
 * Reading `window.localStorage` can itself throw when a privacy setting
 * blocks storage for the origin, so even the lookup is guarded.
 */
export function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    // Some embedded webviews expose the property but resolve it to nothing.
    const storage: Storage | undefined = window.localStorage;
    return typeof storage?.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

export function readLibrary(storage: Storage | null = getLocalStorage()): SessionLibrary {
  if (!storage) return emptyLibrary();
  try {
    return parseLibrary(storage.getItem(STORAGE_KEY));
  } catch {
    return emptyLibrary();
  }
}

/** Returns whether the write landed; a full or blocked store is not an error. */
export function writeLibrary(
  library: SessionLibrary,
  storage: Storage | null = getLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(libraryReadyForStorage(library)));
    return true;
  } catch {
    return false;
  }
}
