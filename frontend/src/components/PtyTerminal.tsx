"use client";

import { useEffect, useRef } from "react";
import "xterm/css/xterm.css";

// WS_BASE is derived at runtime from window.location so it works from any
// host (localhost, Tailscale IP, custom domain) without build-time config.
// Next.js rewrites proxy the upgrade at /api/** → backend:8000.
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

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    // Dynamic imports prevent SSR from touching xterm DOM APIs.
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
        fontFamily:
          "ui-monospace, 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
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

      const ws = new WebSocket(
        `${getWsBase()}/api/v1/sessions/${sessionId}/pty`
      );
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

      ws.onclose = () => {
        if (!disposed) {
          term.writeln(
            "\r\n\x1b[90m─── connection closed ───\x1b[0m"
          );
          onDisconnect?.();
        }
      };

      ws.onerror = () => {
        term.writeln(
          "\r\n\x1b[31m[WebSocket error — is the session still active?]\x1b[0m"
        );
      };

      // Keyboard input → SSH channel (send as binary so the backend
      // can distinguish PTY bytes from JSON control messages)
      const encoder = new TextEncoder();
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encoder.encode(data));
        }
      });

      // Resize → propagate to remote PTY
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      // Fit terminal when container resizes
      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore if terminal already disposed
        }
      });
      if (containerRef.current) observer.observe(containerRef.current);

      // Cleanup
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
  }, [sessionId, onDisconnect]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: "#09090b", padding: "6px" }}
    />
  );
}
