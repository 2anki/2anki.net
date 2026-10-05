// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCanvasZoom, ZOOM_PRESETS } from './useCanvasZoom';

describe('useCanvasZoom', () => {
  it('starts at zoom 1, pan 0/0', () => {
    const { result } = renderHook(() => useCanvasZoom());
    expect(result.current.zoom).toBe(1);
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });

  it('setZoom clamps to [0.25, 4]', () => {
    const { result } = renderHook(() => useCanvasZoom());
    act(() => result.current.setZoom(0.1));
    expect(result.current.zoom).toBe(0.25);
    act(() => result.current.setZoom(10));
    expect(result.current.zoom).toBe(4);
  });

  it('setZoom accepts values inside the range', () => {
    const { result } = renderHook(() => useCanvasZoom());
    act(() => result.current.setZoom(1.5));
    expect(result.current.zoom).toBe(1.5);
  });

  it('setPan updates panX and panY', () => {
    const { result } = renderHook(() => useCanvasZoom());
    act(() => result.current.setPan(50, 100));
    expect(result.current.panX).toBe(50);
    expect(result.current.panY).toBe(100);
  });

  it('fitZoom returns the zoom that fits the image', () => {
    const { result } = renderHook(() => useCanvasZoom());
    let fitted = 0;
    act(() => {
      fitted = result.current.fitZoom(800, 600, 400, 300);
    });
    expect(fitted).toBe(0.5);
    expect(result.current.zoom).toBe(0.5);
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });

  it('fitZoom returns 1 for zero-size image', () => {
    const { result } = renderHook(() => useCanvasZoom());
    let fitted = 0;
    act(() => {
      fitted = result.current.fitZoom(0, 0, 400, 300);
    });
    expect(fitted).toBe(1);
  });

  it('fitZoom clamps to 4 maximum', () => {
    const { result } = renderHook(() => useCanvasZoom());
    let fitted = 0;
    act(() => {
      fitted = result.current.fitZoom(10, 10, 800, 600);
    });
    expect(fitted).toBe(4);
  });

  it('exports ZOOM_PRESETS', () => {
    expect(ZOOM_PRESETS).toContain(1);
    expect(ZOOM_PRESETS).toContain(0.5);
  });

  it('handleWheel does nothing without Ctrl/Cmd', () => {
    const { result } = renderHook(() => useCanvasZoom());
    const fakeRect = { left: 0, top: 0 } as DOMRect;
    const event = {
      ctrlKey: false,
      metaKey: false,
      deltaY: -100,
    } as WheelEvent;
    act(() => result.current.handleWheel(event, fakeRect));
    expect(result.current.zoom).toBe(1);
  });
});
