import React, { useState, useEffect } from 'react';

export default function ScreenshotViewer() {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const captureScreenshot = async () => {
    setLoading(true);
    setError(null);

    try {
      // Use native screenshot API if available
      if (navigator.mediaDevices?.getDisplayMedia) {
        const canvas = await navigator.mediaDevices
          .getDisplayMedia({ video: { mediaSource: 'screen' } })
          .then((stream) => {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();

            return new Promise<HTMLCanvasElement>((resolve) => {
              setTimeout(() => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d')?.drawImage(video, 0, 0);
                stream.getTracks().forEach((t) => t.stop());
                resolve(canvas);
              }, 500);
            });
          });

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setScreenshot(dataUrl);
        setLastUpdate(new Date());
      } else {
        setError('Screenshot API not available in this browser');
      }
    } catch (err) {
      // User cancelled or error occurred
      setError('Screenshot capture cancelled or failed');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    captureScreenshot();
    const interval = setInterval(captureScreenshot, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
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
        overflow: 'auto',
      }}
    >
      {screenshot ? (
        <>
          <img
            src={screenshot}
            alt="Local screenshot"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 4,
            }}
          />
          <div style={{ fontSize: 11, marginTop: 8, color: '#64748b' }}>
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        </>
      ) : (
        <div style={{ padding: 20 }}>
          <p style={{ margin: 0, marginBottom: 12 }}>
            {loading ? 'Capturing screenshot...' : 'Local Desktop'}
          </p>
          {error && (
            <p style={{ margin: 0, marginBottom: 12, fontSize: 12, color: '#f87171' }}>
              {error}
            </p>
          )}
          <button
            onClick={captureScreenshot}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#4b5563' : '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {loading ? 'Capturing...' : 'Capture Screenshot'}
          </button>
        </div>
      )}
    </div>
  );
}
