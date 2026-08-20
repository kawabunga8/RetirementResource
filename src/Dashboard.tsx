import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import VncViewer from './VncViewer';
import ScreenshotViewer from './ScreenshotViewer';
import AlertsPanel from './AlertsPanel';
import { getMetricsForSystem, getMetricsColor, type SystemMetrics } from './MetricsCollector';

interface Agent {
  id: string;
  name: string;
  platform: string;
  status: 'online' | 'offline' | 'idle';
  lastActivity: Date;
  recentMessages: string[];
  credits?: number;
  queue?: number;
}

interface ScreenStatus {
  name: string;
  url: string;
  lastUpdate: Date;
}

export default function Dashboard() {
  const now = new Date();
  const [activeTab, setActiveTab] = useState<'systems' | 'agents' | 'bridge'>('agents');
  const [agents] = useState<Agent[]>([
    {
      id: 'raspy',
      name: 'Raspy',
      platform: 'OpenClaw',
      status: 'online',
      lastActivity: new Date(now.getTime() - 30 * 60000),
      recentMessages: ['Checked agent status', 'Responded to user query'],
      credits: 3.60,
      queue: 0,
    },
    {
      id: 'hermione',
      name: 'Hermione',
      platform: 'Hermes',
      status: 'online',
      lastActivity: new Date(now.getTime() - 14 * 24 * 60 * 60000),
      recentMessages: ['Last session: todo-app', 'No active tasks'],
      queue: 0,
    },
    {
      id: 'countbasey',
      name: 'CountBasey',
      platform: 'Base44',
      status: 'online',
      lastActivity: now,
      recentMessages: ['A2A bridge deployed', 'Awaiting entity fallback setup'],
      credits: 0,
      queue: 0,
    },
  ]);

  const [screens, setScreens] = useState<ScreenStatus[]>([
    {
      name: 'Raspy (Pi)',
      url: 'https://connect.raspberrypi.com',
      lastUpdate: new Date(),
    },
    {
      name: 'Vespa (Mac mini)',
      url: 'vnc://100.74.119.17:5900',
      lastUpdate: new Date(),
    },
    {
      name: 'Local (Mac)',
      url: 'about:blank',
      lastUpdate: new Date(),
    },
  ]);

  const [metrics, setMetrics] = useState<Record<string, SystemMetrics>>({
    'Raspy (Pi)': { cpu: 0, memory: 0, uptime: 'N/A', status: 'online', lastUpdate: new Date() },
    'Vespa (Mac mini)': { cpu: 0, memory: 0, uptime: 'N/A', status: 'online', lastUpdate: new Date() },
    'Local (Mac)': { cpu: 0, memory: 0, uptime: 'N/A', status: 'online', lastUpdate: new Date() },
  });

  useEffect(() => {
    const fetchMetrics = async () => {
      const newMetrics = { ...metrics };
      newMetrics['Raspy (Pi)'] = await getMetricsForSystem('raspy');
      newMetrics['Vespa (Mac mini)'] = await getMetricsForSystem('vespa');
      newMetrics['Local (Mac)'] = await getMetricsForSystem('local');
      setMetrics(newMetrics);
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setScreens(prev =>
        prev.map(screen => ({
          ...screen,
          lastUpdate: new Date(),
        }))
      );
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const statusDot = (status: string) => {
    const colors: Record<string, string> = { online: '#10b981', offline: '#ef4444', idle: '#f59e0b' };
    return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: colors[status] || '#94a3b8', marginRight: 6 }} />;
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🤖 Distributed Agent Dashboard</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div className="tab-switcher">
            <button className={`tab-btn ${activeTab === 'agents' ? 'active' : ''}`} onClick={() => setActiveTab('agents')}>Agents</button>
            <button className={`tab-btn ${activeTab === 'systems' ? 'active' : ''}`} onClick={() => setActiveTab('systems')}>Systems</button>
            <button className={`tab-btn ${activeTab === 'bridge' ? 'active' : ''}`} onClick={() => setActiveTab('bridge')}>A2A Bridge</button>
          </div>
          <p className="status-info">Last updated: {new Date().toLocaleTimeString()}</p>
        </div>
      </header>

      {activeTab === 'agents' && (
        <div className="agents-panel">
          <div className="agents-grid">
            {agents.map(agent => (
              <div key={agent.id} className="agent-card">
                <div className="agent-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {statusDot(agent.status)}
                    <div>
                      <h3 style={{ margin: 0 }}>{agent.name}</h3>
                      <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{agent.platform}</p>
                    </div>
                  </div>
                  <span className="status-badge" style={{ backgroundColor: agent.status === 'online' ? '#10b98166' : '#ef444466' }}>
                    {agent.status}
                  </span>
                </div>

                <div className="agent-body">
                  <div className="agent-stat">
                    <span className="stat-label">Last Activity</span>
                    <span className="stat-value">{Math.round((now.getTime() - agent.lastActivity.getTime()) / 60000)}m ago</span>
                  </div>
                  {agent.credits !== undefined && (
                    <div className="agent-stat">
                      <span className="stat-label">Credits</span>
                      <span className="stat-value" style={{ color: agent.credits > 0 ? '#10b981' : '#ef4444' }}>
                        ${agent.credits.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {agent.queue !== undefined && (
                    <div className="agent-stat">
                      <span className="stat-label">Queue</span>
                      <span className="stat-value">{agent.queue} tasks</span>
                    </div>
                  )}

                  <div className="agent-activity">
                    <h4 style={{ margin: '12px 0 8px 0', fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Recent Activity</h4>
                    <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                      {agent.recentMessages.map((msg, i) => (
                        <div key={i}>• {msg}</div>
                      ))}
                    </div>
                  </div>

                  <button className="action-btn" style={{ marginTop: 12, width: '100%' }}>
                    Send Task →
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px', borderTop: '1px solid #334155' }}>
            <AlertsPanel />
          </div>
        </div>
      )}

      {activeTab === 'systems' && (
        <div className="screens-grid">
          {screens.map((screen, idx) => (
            <div key={idx} className="screen-container">
              <div className="screen-header">
                <h2>{screen.name}</h2>
                <span className="status-dot">●</span>
              </div>
              <div className="screen-content">
                {screen.name === 'Raspy (Pi)' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 }}>
                    <p style={{ margin: 0, color: '#94a3b8' }}>Raspberry Pi Connect</p>
                    <a href="https://connect.raspberrypi.com" target="_blank" rel="noopener noreferrer" style={{ padding: '10px 20px', backgroundColor: '#10b981', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                      Open Screen Sharing →
                    </a>
                  </div>
                )}
                {screen.name === 'Vespa (Mac mini)' && <VncViewer host="100.74.119.17" port={5900} />}
                {screen.name === 'Local (Mac)' && <ScreenshotViewer />}
              </div>
              <div className="screen-metrics">
                <div className="metric">
                  <span className="metric-label">CPU</span>
                  <span className="metric-value" style={{ color: getMetricsColor(metrics[screen.name].cpu) }}>{metrics[screen.name].cpu.toFixed(1)}%</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Memory</span>
                  <span className="metric-value" style={{ color: getMetricsColor(metrics[screen.name].memory) }}>{metrics[screen.name].memory.toFixed(1)}%</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Uptime</span>
                  <span className="metric-value">{metrics[screen.name].uptime}</span>
                </div>
              </div>
              <div className="screen-footer">Updated: {screen.lastUpdate.toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'bridge' && (
        <div className="bridge-panel">
          <h2>A2A Bridge Status</h2>
          <div className="bridge-status">
            <div className="bridge-component">
              <h3>Endpoint</h3>
              <p>https://count-basey-899068b6.base44.app/functions/a2aAgent</p>
              <span className="status-badge" style={{ backgroundColor: '#10b98166' }}>✅ Live</span>
            </div>
            <div className="bridge-component">
              <h3>Auth</h3>
              <p>x-api-key header validation</p>
              <span className="status-badge" style={{ backgroundColor: '#10b98166' }}>✅ Working</span>
            </div>
            <div className="bridge-component">
              <h3>Method</h3>
              <p>tasks/send (JSON-RPC 2.0)</p>
              <span className="status-badge" style={{ backgroundColor: '#10b98166' }}>✅ Tested</span>
            </div>
            <div className="bridge-component">
              <h3>Agent API</h3>
              <p>Message credits</p>
              <span className="status-badge" style={{ backgroundColor: '#ef444466' }}>⏳ Exhausted (resets tomorrow)</span>
            </div>
          </div>
          <div className="bridge-info">
            <h3>Next Steps</h3>
            <ul>
              <li>✅ Primary: Direct agent API (ready, credit-limited)</li>
              <li>🔄 Secondary: Entity-based fallback (pending CountBasey setup)</li>
              <li>When both active: Raspy gets real-time responses with fallback to async</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
