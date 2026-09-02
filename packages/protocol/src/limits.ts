/**
 * Hard bounds for everything that crosses the wire. These are part of the
 * contract: producers must respect them and consumers must reject anything
 * larger instead of trying to be lenient.
 */
export const PROTOCOL_VERSION = 1 as const;

export const LIMITS = {
  /** Maximum encoded size of a single event or command, in UTF-8 bytes. */
  maxEventBytes: 12 * 1024,
  /** Identifiers: event ids, conversation ids, action ids, segment ids, ... */
  maxIdChars: 64,
  /** Short human labels: agent names, adapter names, titles, methods. */
  maxLabelChars: 200,
  /** Transcript text, agent messages, speakable summaries. */
  maxTextChars: 4000,
  /** Progress messages and approval prompts. */
  maxMessageChars: 1000,
  /** Artifact URLs. */
  maxUrlChars: 2048,
  /** Artifacts attached to a single event. */
  maxArtifacts: 20,
  /** Inline artifact text. */
  maxArtifactTextChars: 4000,
} as const;

/** Data-channel topics used by the LiveKit transport binding. */
export const TOPICS = {
  events: 'agent-voice.events.v1',
  commands: 'agent-voice.commands.v1',
} as const;
