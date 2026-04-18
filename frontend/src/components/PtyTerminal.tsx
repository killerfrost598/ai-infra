"use client";

import { useEffect, useRef } from "react";
import "xterm/css/xterm.css";

function getWsBase(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

interface PtyTerminalProps {
  sessionId: string;
  onDisconnect?: () => void;
}

export function PtyTerminal({ sessionId, onDisconnect }: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Store onDisconnect in a ref so the main effect only re-runs when sessionId
  // changes — not every time the parent re-renders with a new function reference.
  // Without this, the terminal would reconnect on every parent state update.
  const onDisconnectRef = useRef(onDisconnect);
  useEffect(() => { onDisconnectRef.current = onDisconnect; });

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    async function init() {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
          cursor: "#a5b4fc",
          cursorAccent: "#09090b",
          selectionBackground: "#3f3f46",
          black: "#18181b",
          brightBlack: "#3f3f46",
        },
        fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const ws = new WebSocket(`${getWsBase()}/api/v1/sessions/${sessionId}/pty`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else {
          term.write(event.data as string);
        }
      };

      // onerror fires before onclose — let onclose handle the message with the code
      ws.onerror = () => {};

      ws.onclose = (event) => {
        if (disposed) return;
        if (event.code === 1008) {
          // Backend closes with 1008 when session is not found, terminated,
          // or already has an active PTY connection from another tab.
          term.writeln(
            `\r\n\x1b[33m─── ${event.reason || "session unavailable"} ───\x1b[0m`
          );
          // Don't call onDisconnect — session wasn't disconnected by us
        } else {
          term.writeln("\r\n\x1b[90m─── connection closed ───\x1b[0m");
          onDisconnectRef.current?.();
        }
      };

      const encoder = new TextEncoder();
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encoder.encode(data));
        }
      });

      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      const observer = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch { /* terminal already disposed */ }
      });
      if (containerRef.current) observer.observe(containerRef.current);

      return () => {
        disposed = true;
        observer.disconnect();
        ws.close();
        term.dispose();
      };
    }

    let cleanup: (() => void) | undefined;
    init().then((fn) => { cleanup = fn; });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [sessionId]); // onDisconnect intentionally excluded — read via ref above

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: "#09090b", padding: "6px" }}
    />
  );
}
