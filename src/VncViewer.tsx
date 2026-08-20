import React, { useEffect, useRef } from 'react';

interface VncViewerProps {
  host: string;
  port: number;
}

export default function VncViewer({ host, port }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // noVNC requires WebSocket access to the VNC server
    // For now, show connection instructions
    // In production, you'd need websockify or similar running on the VNC host

    // Try to load noVNC if needed
    // import('novnc/core/rfb.js').then((RFB) => {
    //   // Would set up connection here
    // });
  }, [host, port]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0f172a',
        color: '#94a3b8',
        textAlign: 'center',
        padding: '20px',
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 16 }}>
        <p style={{ margin: '0 0 12px 0', fontWeight: 600 }}>VNC Connection</p>
        <p style={{ margin: '0 0 8px 0', fontSize: 12 }}>
          Host: <code style={{ backgroundColor: '#1e293b', padding: '2px 6px', borderRadius: 4 }}>{host}:{port}</code>
        </p>
        <p style={{ margin: '8px 0', fontSize: 12, color: '#64748b' }}>
          Connect using a VNC client or set up websockify for browser access
        </p>
        <a
          href={`vnc://${host}:${port}`}
          style={{
            marginTop: 12,
            display: 'inline-block',
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: '#fff',
            borderRadius: 4,
            textDecoration: 'none',
            fontSize: 12,
          }}
        >
          Open VNC Client
        </a>
      </div>
    </div>
  );
}
