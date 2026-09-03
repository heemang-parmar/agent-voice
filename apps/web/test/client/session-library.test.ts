import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TITLE,
  LIBRARY_SCHEMA_VERSION,
  MAX_CONVERSATIONS,
  MAX_GROUP_NAME_CHARS,
  MAX_TITLE_CHARS,
  addGroup,
  deriveTitle,
  emptyLibrary,
  libraryReadyForStorage,
  librarySections,
  moveConversation,
  parseLibrary,
  readLibrary,
  renameConversation,
  setConversationPinned,
  upsertConversation,
  writeLibrary,
  type LibraryConversation,
  type SessionLibrary,
} from '@/lib/client/session-library';
import { MAX_TRANSCRIPT_ENTRIES, type TranscriptEntry } from '@/lib/client/session-state';

function entry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 'user:1',
    role: 'user',
    text: 'hello',
    final: true,
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function conversation(overrides: Partial<LibraryConversation> = {}): LibraryConversation {
  return {
    id: 'conv_1',
    title: 'First',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    pinned: false,
    groupId: null,
    transcript: [entry()],
    ...overrides,
  };
}

function stored(library: Partial<SessionLibrary>): string {
  return JSON.stringify({
    version: LIBRARY_SCHEMA_VERSION,
    conversations: [],
    groups: [],
    ...library,
  });
}

describe('parseLibrary', () => {
  it('returns an empty library instead of throwing on absent, corrupt or foreign data', () => {
    for (const raw of [null, '', '{', 'null', '"a string"', '[]', '42', '{"version":1}']) {
      expect(parseLibrary(raw)).toEqual(emptyLibrary());
    }
  });

  it('discards a library written by a different schema version rather than guessing at it', () => {
    const raw = JSON.stringify({
      version: LIBRARY_SCHEMA_VERSION + 1,
      conversations: [conversation()],
      groups: [],
    });
    expect(parseLibrary(raw).conversations).toEqual([]);
  });

  it('drops individually invalid records but keeps their valid siblings', () => {
    const raw = stored({
      conversations: [
        conversation({ id: 'good' }),
        { id: 'no-timestamps' },
        null,
        'nope',
        conversation({ id: 'also-good', pinned: 'yes' as unknown as boolean }),
      ] as unknown as LibraryConversation[],
    });
    expect(parseLibrary(raw).conversations.map((record) => record.id)).toEqual(['good']);
  });

  it('keeps only the first record when a corrupt file repeats an id', () => {
    const raw = stored({
      conversations: [conversation({ title: 'Kept' }), conversation({ title: 'Dropped' })],
    });
    const parsed = parseLibrary(raw);
    expect(parsed.conversations).toHaveLength(1);
    expect(parsed.conversations[0]?.title).toBe('Kept');
  });

  it('bounds an oversized library to the documented ceilings', () => {
    const raw = stored({
      conversations: Array.from({ length: MAX_CONVERSATIONS + 40 }, (_, index) =>
        conversation({
          id: `conv_${index}`,
          title: 'T'.repeat(500),
          updatedAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
          transcript: Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 50 }, (__, i) =>
            entry({ id: `user:${i}` }),
          ),
        }),
      ),
      groups: [{ id: 'grp_1', name: 'G'.repeat(500), createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const parsed = parseLibrary(raw);
    expect(parsed.conversations).toHaveLength(MAX_CONVERSATIONS);
    for (const record of parsed.conversations) {
      expect(record.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
      expect(record.transcript).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    }
    expect(parsed.groups[0]?.name.length).toBeLessThanOrEqual(MAX_GROUP_NAME_CHARS);
  });

  it('keeps pinned conversations when trimming an oversized library', () => {
    const raw = stored({
      conversations: Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, index) =>
        conversation({
          id: `conv_${index}`,
          pinned: index === MAX_CONVERSATIONS + 4,
          updatedAt: `2026-01-0${index === MAX_CONVERSATIONS + 4 ? '1' : '2'}T00:00:00.000Z`,
        }),
      ),
    });
    const parsed = parseLibrary(raw);
    expect(parsed.conversations).toHaveLength(MAX_CONVERSATIONS);
    expect(parsed.conversations.some((record) => record.pinned)).toBe(true);
  });

  it('unassigns a conversation whose group no longer exists', () => {
    const raw = stored({ conversations: [conversation({ groupId: 'grp_missing' })] });
    expect(parseLibrary(raw).conversations[0]?.groupId).toBeNull();
  });

  it('replaces a blank stored title with the honest default', () => {
    const raw = stored({ conversations: [conversation({ title: '   ' })] });
    expect(parseLibrary(raw).conversations[0]?.title).toBe(DEFAULT_TITLE);
  });

  it('drops transcript entries that are not shaped like turns', () => {
    const raw = stored({
      conversations: [
        conversation({
          transcript: [
            entry({ id: 'user:1' }),
            { id: 'user:2' },
            7,
          ] as unknown as TranscriptEntry[],
        }),
      ],
    });
    expect(parseLibrary(raw).conversations[0]?.transcript).toHaveLength(1);
  });
});

describe('deriveTitle', () => {
  it('uses the first final user turn', () => {
    expect(
      deriveTitle([
        entry({ id: 'a', role: 'agent', text: 'Hi there' }),
        entry({ id: 'b', role: 'user', text: 'partial', final: false }),
        entry({ id: 'c', role: 'user', text: 'Book me a table' }),
        entry({ id: 'd', role: 'user', text: 'Later turn' }),
      ]),
    ).toBe('Book me a table');
  });

  it('collapses whitespace and bounds the derived title', () => {
    expect(deriveTitle([entry({ text: '  lots\n\n of   space  ' })])).toBe('lots of space');
    const long = deriveTitle([entry({ text: 'word '.repeat(200) })]);
    expect(long.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
  });

  it('falls back when there is no usable user turn', () => {
    expect(deriveTitle([])).toBe(DEFAULT_TITLE);
    expect(deriveTitle([entry({ role: 'agent' })])).toBe(DEFAULT_TITLE);
    expect(deriveTitle([entry({ text: '   ' })])).toBe(DEFAULT_TITLE);
  });
});

describe('upsertConversation', () => {
  const now = '2026-02-01T00:00:00.000Z';

  it('creates one record and then updates it in place as the transcript grows', () => {
    const first = upsertConversation(emptyLibrary(), {
      id: 'ui_1',
      transcript: [entry({ text: 'Book a table' })],
      now,
    });
    expect(first.conversations).toHaveLength(1);

    const second = upsertConversation(first, {
      id: 'ui_1',
      transcript: [
        entry({ text: 'Book a table' }),
        entry({ id: 'a', role: 'agent', text: 'Sure' }),
      ],
      now: '2026-02-01T00:05:00.000Z',
    });
    expect(second.conversations).toHaveLength(1);
    expect(second.conversations[0]?.transcript).toHaveLength(2);
    expect(second.conversations[0]?.createdAt).toBe(now);
    expect(second.conversations[0]?.updatedAt).toBe('2026-02-01T00:05:00.000Z');
  });

  it('does not archive a session that has said nothing yet', () => {
    expect(upsertConversation(emptyLibrary(), { id: 'ui_1', transcript: [], now })).toEqual(
      emptyLibrary(),
    );
  });

  it('fills in a still-default title later, but never overwrites a rename', () => {
    const blank = upsertConversation(emptyLibrary(), {
      id: 'ui_1',
      transcript: [entry({ role: 'agent', text: 'Hello' })],
      now,
    });
    expect(blank.conversations[0]?.title).toBe(DEFAULT_TITLE);

    const named = upsertConversation(blank, {
      id: 'ui_1',
      transcript: [entry({ role: 'agent', text: 'Hello' }), entry({ text: 'Book a table' })],
      now,
    });
    expect(named.conversations[0]?.title).toBe('Book a table');

    const renamed = renameConversation(named, 'ui_1', 'Dinner plans');
    const grown = upsertConversation(renamed, {
      id: 'ui_1',
      transcript: [entry({ text: 'Book a table' }), entry({ id: 'z', text: 'And a taxi' })],
      now,
    });
    expect(grown.conversations[0]?.title).toBe('Dinner plans');
  });

  it('keeps the newest conversation first and stays within the ceiling', () => {
    let library = emptyLibrary();
    for (let index = 0; index < MAX_CONVERSATIONS + 10; index += 1) {
      library = upsertConversation(library, {
        id: `ui_${index}`,
        transcript: [entry({ text: `turn ${index}` })],
        now: `2026-02-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      });
    }
    expect(library.conversations).toHaveLength(MAX_CONVERSATIONS);
    expect(library.conversations[0]?.id).toBe(`ui_${MAX_CONVERSATIONS + 9}`);
  });
});

describe('row actions', () => {
  const base = upsertConversation(emptyLibrary(), {
    id: 'ui_1',
    transcript: [entry({ text: 'Book a table' })],
    now: '2026-02-01T00:00:00.000Z',
  });

  it('renames within bounds and ignores a blank name', () => {
    expect(renameConversation(base, 'ui_1', '  Dinner  ').conversations[0]?.title).toBe('Dinner');
    expect(renameConversation(base, 'ui_1', '   ').conversations[0]?.title).toBe('Book a table');
    expect(
      renameConversation(base, 'ui_1', 'x'.repeat(400)).conversations[0]?.title.length,
    ).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(renameConversation(base, 'missing', 'Dinner')).toBe(base);
  });

  it('pins and unpins', () => {
    const pinned = setConversationPinned(base, 'ui_1', true);
    expect(pinned.conversations[0]?.pinned).toBe(true);
    expect(setConversationPinned(pinned, 'ui_1', false).conversations[0]?.pinned).toBe(false);
  });

  it('creates a bounded group and moves a conversation in and back out of it', () => {
    const withGroup = addGroup(base, {
      id: 'grp_1',
      name: '  Travel'.padEnd(300, '!'),
      now: '2026-02-01T00:00:00.000Z',
    });
    expect(withGroup.groups).toHaveLength(1);
    expect(withGroup.groups[0]?.name.length).toBeLessThanOrEqual(MAX_GROUP_NAME_CHARS);

    const moved = moveConversation(withGroup, 'ui_1', 'grp_1');
    expect(moved.conversations[0]?.groupId).toBe('grp_1');
    expect(moveConversation(moved, 'ui_1', null).conversations[0]?.groupId).toBeNull();
  });

  it('refuses to move a conversation into a group that does not exist', () => {
    expect(moveConversation(base, 'ui_1', 'grp_nope')).toBe(base);
  });

  it('ignores a group with a blank name', () => {
    expect(addGroup(base, { id: 'grp_1', name: '  ', now: '2026-02-01T00:00:00.000Z' })).toBe(base);
  });
});

describe('librarySections', () => {
  it('files each conversation once, hides empty groups, and never repeats a pin', () => {
    let library = emptyLibrary();
    for (const id of ['a', 'b', 'c']) {
      library = upsertConversation(library, {
        id,
        transcript: [entry({ text: `turn ${id}` })],
        now: '2026-02-01T00:00:00.000Z',
      });
    }
    library = addGroup(library, { id: 'grp_1', name: 'Travel', now: '2026-02-01T00:00:00.000Z' });
    library = addGroup(library, { id: 'grp_2', name: 'Empty', now: '2026-02-01T00:00:00.000Z' });
    library = moveConversation(library, 'b', 'grp_1');
    library = setConversationPinned(library, 'a', true);
    library = moveConversation(library, 'a', 'grp_1');

    const sections = librarySections(library);
    expect(sections.pinned.map((record) => record.id)).toEqual(['a']);
    expect(sections.groups).toHaveLength(1);
    expect(sections.groups[0]?.group.name).toBe('Travel');
    expect(sections.groups[0]?.conversations.map((record) => record.id)).toEqual(['b']);
    expect(sections.recent.map((record) => record.id)).toEqual(['c']);
  });
});

describe('storage', () => {
  function throwingStorage(): Storage {
    return {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
  }

  it('reads an empty library and reports a failed write instead of crashing', () => {
    const storage = throwingStorage();
    expect(readLibrary(storage)).toEqual(emptyLibrary());
    expect(writeLibrary(emptyLibrary(), storage)).toBe(false);
  });

  it('treats a missing storage object as an empty, unwritable library', () => {
    expect(readLibrary(null)).toEqual(emptyLibrary());
    expect(writeLibrary(emptyLibrary(), null)).toBe(false);
  });

  it('round-trips a real library through localStorage', () => {
    window.localStorage.clear();
    const library = upsertConversation(emptyLibrary(), {
      id: 'ui_1',
      transcript: [entry({ text: 'Book a table' })],
      now: '2026-02-01T00:00:00.000Z',
    });
    expect(writeLibrary(library, window.localStorage)).toBe(true);
    expect(readLibrary(window.localStorage)).toEqual(library);
  });

  it('serialises only the fields the schema documents', () => {
    const library = upsertConversation(emptyLibrary(), {
      id: 'ui_1',
      transcript: [entry({ text: 'Book a table' })],
      now: '2026-02-01T00:00:00.000Z',
    });
    expect(Object.keys(libraryReadyForStorage(library))).toEqual([
      'version',
      'conversations',
      'groups',
    ]);
    expect(Object.keys(libraryReadyForStorage(library).conversations[0] ?? {})).toEqual([
      'id',
      'title',
      'createdAt',
      'updatedAt',
      'pinned',
      'groupId',
      'transcript',
    ]);
  });
});
