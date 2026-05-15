"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { withInferixApiKey } from "@/lib/api";

// xterm can overflow its internal call stack on writes > ~32 KB when the data
// contains long single-line sequences (e.g. dense ANSI, OSC 8 hyperlinks).
// Chunk writes to prevent RangeError: Maximum call stack size exceeded.
const WRITE_CHUNK = 32 * 1024; // 32 KB

function writeChunked(write: (data: Uint8Array) => void, data: Uint8Array): void {
  let offset = 0;
  while (offset < data.length) {
    const slice = data.subarray(offset, offset + WRITE_CHUNK);
    try {
      write(slice);
    } catch {
      // Swallow per-chunk errors (usually malformed escape sequences);
      // continue so the rest of the frame still renders.
    }
    offset += WRITE_CHUNK;
  }
}

function getWsBase(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export type PtyTheme = "light" | "dark";

export type PtyConnectionState =
  | "connecting"
  | "connected"
  | "idle"
  | "closed"
  | "unavailable";

export interface PtyStats {
  bytesSent: number;
  bytesReceived: number;
  latencyMs: number | null;
  cols: number;
  rows: number;
}

interface PtyTerminalProps {
  sessionId: string;
  theme?: PtyTheme;
  onDisconnect?: () => void;
  onData?: (data: Uint8Array) => void;
  onState?: (state: PtyConnectionState, reason?: string) => void;
  onStats?: (stats: PtyStats) => void;
  className?: string;
}

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1f2937",
  cursor: "#3b82f6",
  cursorAccent: "#ffffff",
  selectionBackground: "#dbeafe",
  black: "#1f2937",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e5e7eb",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#f9fafb",
};

const DARK_THEME = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#a5b4fc",
  cursorAccent: "#09090b",
  selectionBackground: "#3f3f46",
  black: "#18181b",
  brightBlack: "#3f3f46",
};

export function PtyTerminal({
  sessionId,
  theme = "dark",
  onDisconnect,
  onData,
  onState,
  onStats,
  className,
}: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onDisconnectRef = useRef(onDisconnect);
  const onDataRef = useRef(onData);
  const onStateRef = useRef(onState);
  const onStatsRef = useRef(onStats);
  const termRef = useRef<{ options: { theme?: typeof LIGHT_THEME | typeof DARK_THEME } } | null>(null);

  useEffect(() => { onDisconnectRef.current = onDisconnect; });
  useEffect(() => { onDataRef.current = onData; });
  useEffect(() => { onStateRef.current = onState; });
  useEffect(() => { onStatsRef.current = onStats; });

  // Apply theme changes to a live terminal instance without remounting
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = theme === "light" ? LIGHT_THEME : DARK_THEME;
    if (containerRef.current) {
      containerRef.current.style.background = theme === "light" ? "#ffffff" : "#09090b";
    }
  }, [theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let term: { dispose: () => void } | null = null;
    let ws: WebSocket | null = null;
    let observer: ResizeObserver | null = null;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (disposed || !containerRef.current) return;

      const terminal = new Terminal({
        theme: theme === "light" ? LIGHT_THEME : DARK_THEME,
        fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        allowProposedApi: true,
      });
      term = terminal;
      termRef.current = terminal as unknown as typeof termRef.current;

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      // If the container is hidden (display:none) when the terminal mounts,
      // fitAddon.fit() gets 0 dimensions and xterm collapses to minimum size.
      // Incoming WebSocket data written at that size wraps at 1 column and stays
      // garbled permanently even after the container becomes visible.
      // Fix: buffer all incoming data until fitAddon.fit() produces real dimensions.
      let renderReady = terminal.cols > 10 && terminal.rows > 2;
      const writeQueue: Array<Uint8Array | string> = [];

      function flushWriteQueue() {
        for (const item of writeQueue) {
          if (typeof item === "string") {
            try { terminal.write(item); } catch { /* absorb */ }
          } else {
            writeChunked((chunk) => terminal.write(chunk), item);
          }
        }
        writeQueue.length = 0;
      }

      function termWrite(bytes: Uint8Array): void {
        if (renderReady) { writeChunked((chunk) => terminal.write(chunk), bytes); return; }
        writeQueue.push(bytes);
      }

      function termWriteText(text: string): void {
        if (renderReady) { try { terminal.write(text); } catch { /* absorb */ } return; }
        writeQueue.push(text);
      }

      let bytesSent = 0;
      let bytesReceived = 0;
      let latencyMs: number | null = null;
      const wsOpenStart = performance.now();

      function emitStats() {
        onStatsRef.current?.({
          bytesSent,
          bytesReceived,
          latencyMs,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
      emitStats();

      onStateRef.current?.("connecting");

      const socket = new WebSocket(`${getWsBase()}${withInferixApiKey(`/api/v1/sessions/${sessionId}/pty`)}`);
      ws = socket;
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        latencyMs = Math.round(performance.now() - wsOpenStart);
        const { cols, rows } = terminal;
        const payload = JSON.stringify({ type: "resize", cols, rows });
        socket.send(payload);
        bytesSent += payload.length;
        onStateRef.current?.("connected");
        emitStats();
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          bytesReceived += bytes.byteLength;
          termWrite(bytes);
          onDataRef.current?.(bytes);
        } else {
          const text = event.data as string;
          bytesReceived += text.length;
          termWriteText(text);
        }
        emitStats();
      };

      // onerror fires before onclose — let onclose handle the message with the code
      socket.onerror = () => {};

      socket.onclose = (event) => {
        if (disposed) return;
        if (event.code === 1008) {
          // Backend closes with 1008 when session is not found, terminated,
          // or already has an active PTY connection from another tab.
          terminal.writeln(
            `\r\n\x1b[33m─── ${event.reason || "session unavailable"} ───\x1b[0m`
          );
          onStateRef.current?.("unavailable", event.reason || "session unavailable");
          // Don't call onDisconnect — session wasn't disconnected by us
        } else {
          terminal.writeln("\r\n\x1b[90m─── connection closed ───\x1b[0m");
          onStateRef.current?.("closed", event.reason);
          onDisconnectRef.current?.();
        }
        emitStats();
      };

      const encoder = new TextEncoder();
      terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          const encoded = encoder.encode(data);
          socket.send(encoded);
          bytesSent += encoded.byteLength;
          emitStats();
        }
      });

      terminal.onResize(({ cols, rows }) => {
        if (socket.readyState === WebSocket.OPEN) {
          const payload = JSON.stringify({ type: "resize", cols, rows });
          socket.send(payload);
          bytesSent += payload.length;
        }
        emitStats();
      });

      observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          if (!renderReady && terminal.cols > 10 && terminal.rows > 2) {
            renderReady = true;
            flushWriteQueue();
          }
        } catch {
          // Non-fatal: container may have zero dimensions during tab transitions
        }
      });
      if (containerRef.current) observer.observe(containerRef.current);

      return () => {
        disposed = true;
        observer?.disconnect();
        socket.close();
        terminal.dispose();
        termRef.current = null;
      };
    }

    let cleanup: (() => void) | undefined;
    init()
      .then((fn) => {
        if (disposed) {
          fn?.();
          return;
        }
        cleanup = fn;
      })
      .catch(() => {
        // Terminal init failed (xterm dynamic import or DOM not ready);
        // the component will unmount cleanly via the cleanup path.
      });

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
        return;
      }
      observer?.disconnect();
      if (ws && ws.readyState < WebSocket.CLOSING) {
        ws.close();
      }
      term?.dispose();
      termRef.current = null;
    };
  }, [sessionId]); // theme handled separately above; callbacks via refs

  return (
    <div
      ref={containerRef}
      className={className ?? "h-full w-full"}
      style={{
        background: theme === "light" ? "#ffffff" : "#09090b",
        padding: "6px",
      }}
    />
  );
}
