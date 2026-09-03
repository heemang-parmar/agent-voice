'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PushToTalkPhase = 'idle' | 'starting' | 'listening' | 'finishing';

const MICROPHONE_ENABLE_TIMEOUT_MS = 4_000;

interface UsePushToTalkOptions {
  enabled: boolean;
  microphoneEnabled: boolean;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/**
 * Serializes temporary microphone changes for text-mode push-to-talk.
 * The queue guarantees that a release requested during a pending enable
 * always runs last, so a late enable cannot leave the microphone live.
 */
export function usePushToTalk({
  enabled,
  microphoneEnabled,
  setMicrophoneEnabled,
}: UsePushToTalkOptions) {
  const [phase, setPhase] = useState<PushToTalkPhase>('idle');
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);
  const held = useRef(false);
  const desired = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const hotkeyHeld = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const updatePhase = useCallback((next: PushToTalkPhase): void => {
    if (mounted.current) setPhase(next);
  }, []);

  const enqueue = useCallback(
    (nextEnabled: boolean): Promise<void> => {
      const operation = queue.current
        .catch(() => undefined)
        .then(async () => {
          const request = setMicrophoneEnabled(nextEnabled);
          if (nextEnabled) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const outcome = await Promise.race([
              request.then(() => 'settled' as const),
              new Promise<'timeout'>((resolve) => {
                timeout = setTimeout(() => resolve('timeout'), MICROPHONE_ENABLE_TIMEOUT_MS);
              }),
            ]);
            if (timeout) clearTimeout(timeout);
            if (outcome === 'timeout') {
              // A browser permission/media request can remain pending indefinitely.
              // Let release continue, then correct any enable that resolves late.
              void request
                .then(async () => {
                  if (!desired.current || !held.current) await setMicrophoneEnabled(false);
                })
                .catch(() => undefined);
              return;
            }
          } else {
            await request;
          }
          if (!mounted.current) return;
          if (nextEnabled && desired.current && held.current) updatePhase('listening');
          if (!nextEnabled && !desired.current) updatePhase('idle');
        });
      queue.current = operation;
      return operation;
    },
    [setMicrophoneEnabled, updatePhase],
  );

  const start = useCallback((): void => {
    if (!enabledRef.current || held.current) return;
    held.current = true;
    desired.current = true;
    updatePhase('starting');
    void enqueue(true);
  }, [enqueue, updatePhase]);

  const release = useCallback((): Promise<void> => {
    hotkeyHeld.current = false;
    if (!held.current && !desired.current) return queue.current.catch(() => undefined);
    held.current = false;
    desired.current = false;
    updatePhase('finishing');
    return enqueue(false).catch(() => undefined);
  }, [enqueue, updatePhase]);

  useEffect(() => {
    if (!enabled) void release();
  }, [enabled, release]);

  useEffect(() => {
    if (!enabled || !held.current) return;
    if (microphoneEnabled) updatePhase('listening');
  }, [enabled, microphoneEnabled, updatePhase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !enabledRef.current ||
        event.code !== 'Space' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing ||
        isEditable(event.target) ||
        isEditable(document.activeElement) ||
        hotkeyHeld.current
      ) {
        return;
      }
      event.preventDefault();
      hotkeyHeld.current = true;
      start();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || !hotkeyHeld.current) return;
      event.preventDefault();
      hotkeyHeld.current = false;
      void release();
    };

    const onBlur = (): void => {
      if (held.current) void release();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden' && held.current) void release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [release, start]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (held.current || desired.current) {
        held.current = false;
        desired.current = false;
        void enqueue(false);
      }
    };
  }, [enqueue]);

  return { phase, start, release };
}
