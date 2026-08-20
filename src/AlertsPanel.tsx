import React, { useState } from 'react';

interface Alert {
  id: string;
  type: 'tailscale' | 'gas' | 'couch' | 'system';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: Date;
  actionUrl?: string;
}

export default function AlertsPanel() {
  const now = new Date();
  const [alerts] = useState<Alert[]>([
    {
      id: '1',
      type: 'tailscale',
      severity: 'info',
      title: 'Tailscale Status',
      message: 'All 3 machines online and healthy',
      timestamp: new Date(now.getTime() - 5 * 60000),
    },
    {
      id: '2',
      type: 'gas',
      severity: 'info',
      title: 'Gas Price Update',
      message: 'Super Save Gas (6000 No. 5 Rd) - 206.9¢/L',
      timestamp: new Date(now.getTime() - 3 * 3600000),
    },
    {
      id: '3',
      type: 'couch',
      severity: 'warning',
      title: 'New Couch Alert',
      message: 'Found 2 new couches under $1500 on Craigslist',
      timestamp: new Date(now.getTime() - 12 * 3600000),
      actionUrl: '#',
    },
    {
      id: '4',
      type: 'system',
      severity: 'info',
      title: 'Dashboard Online',
      message: 'Multi-machine monitoring active',
      timestamp: now,
    },
  ]);

  const getAlertColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'info':
      default:
        return '#3b82f6';
    }
  };

  const getAlertBgColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return '#7f1d1d';
      case 'warning':
        return '#78350f';
      case 'info':
      default:
        return '#1e3a8a';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'tailscale':
        return '🌐';
      case 'gas':
        return '⛽';
      case 'couch':
        return '🛋️';
      case 'system':
        return '⚙️';
      default:
        return '📢';
    }
  };

  return (
    <div style={{ padding: '16px', background: '#1e293b', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600 }}>Recent Alerts</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '300px', overflowY: 'auto' }}>
        {alerts.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>No recent alerts</p>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                padding: '10px 12px',
                background: getAlertBgColor(alert.severity),
                borderLeft: `3px solid ${getAlertColor(alert.severity)}`,
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{getIcon(alert.type)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                    {alert.title}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: 11, lineHeight: 1.4 }}>
                    {alert.message}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', textAlign: 'right' }}>
                {alert.timestamp.toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
