// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useOcclusionHistory } from './useOcclusionHistory';
import { OcclusionRect } from '../types';

function rect(id: string): OcclusionRect {
  return { id, x: 0, y: 0, w: 0.1, h: 0.1, label: '', shape: 'rect' };
}

describe('useOcclusionHistory', () => {
  it('starts with the initial rects and no history', () => {
    const initial = [rect('a')];
    const { result } = renderHook(() => useOcclusionHistory(initial));
    expect(result.current.rects).toEqual(initial);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('push adds a snapshot and clears future', () => {
    const { result } = renderHook(() => useOcclusionHistory([]));
    act(() => {
      result.current.push([rect('a')]);
    });
    expect(result.current.rects).toEqual([rect('a')]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo restores the previous state and returns it', () => {
    const { result } = renderHook(() => useOcclusionHistory([]));
    act(() => {
      result.current.push([rect('a')]);
    });
    act(() => {
      result.current.push([rect('a'), rect('b')]);
    });
    let restored: ReturnType<typeof result.current.undo> = null;
    act(() => {
      restored = result.current.undo();
    });
    expect(result.current.rects).toEqual([rect('a')]);
    expect(restored).toEqual([rect('a')]);
    expect(result.current.canRedo).toBe(true);
  });

  it('redo reapplies the undone state and returns it', () => {
    const { result } = renderHook(() => useOcclusionHistory([]));
    act(() => {
      result.current.push([rect('a')]);
    });
    act(() => {
      result.current.push([rect('a'), rect('b')]);
    });
    act(() => {
      result.current.undo();
    });
    let redone: ReturnType<typeof result.current.redo> = null;
    act(() => {
      redone = result.current.redo();
    });
    expect(result.current.rects).toEqual([rect('a'), rect('b')]);
    expect(redone).toEqual([rect('a'), rect('b')]);
    expect(result.current.canRedo).toBe(false);
  });

  it('push after undo clears future', () => {
    const { result } = renderHook(() => useOcclusionHistory([]));
    act(() => {
      result.current.push([rect('a')]);
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.push([rect('b')]);
    });
    expect(result.current.canRedo).toBe(false);
    expect(result.current.rects).toEqual([rect('b')]);
  });

  it('undo returns null when there is no past', () => {
    const { result } = renderHook(() => useOcclusionHistory([rect('a')]));
    let returned: ReturnType<typeof result.current.undo> =
      undefined as unknown as null;
    act(() => {
      returned = result.current.undo();
    });
    expect(returned).toBeNull();
    expect(result.current.rects).toEqual([rect('a')]);
  });

  it('redo returns null when there is no future', () => {
    const { result } = renderHook(() => useOcclusionHistory([rect('a')]));
    let returned: ReturnType<typeof result.current.redo> =
      undefined as unknown as null;
    act(() => {
      returned = result.current.redo();
    });
    expect(returned).toBeNull();
    expect(result.current.rects).toEqual([rect('a')]);
  });

  it('caps history at 50 snapshots', () => {
    const { result } = renderHook(() => useOcclusionHistory([]));
    for (let i = 0; i < 60; i++) {
      act(() => {
        result.current.push([rect(`r${i}`)]);
      });
    }
    let undoCount = 0;
    while (result.current.canUndo) {
      act(() => {
        result.current.undo();
      });
      undoCount++;
    }
    expect(undoCount).toBe(50);
  });

  it('reset clears history and sets a new base', () => {
    const { result } = renderHook(() => useOcclusionHistory([]));
    act(() => {
      result.current.push([rect('a')]);
    });
    act(() => {
      result.current.reset([rect('z')]);
    });
    expect(result.current.rects).toEqual([rect('z')]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
