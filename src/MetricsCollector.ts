export interface SystemMetrics {
  cpu: number; // percentage
  memory: number; // percentage
  uptime: string; // human readable
  status: 'online' | 'offline';
  lastUpdate: Date;
}

// Simulated metrics for now (can be replaced with API calls to your systems)
export const getMetricsForSystem = async (system: 'raspy' | 'vespa' | 'local'): Promise<SystemMetrics> => {
  // In production, these would be:
  // - API calls to CountBasey backend functions
  // - SSH commands to local machines
  // - Browser APIs for local metrics

  try {
    if (system === 'raspy') {
      // Would call: GET http://raspyhost:18789/metrics or similar
      return {
        cpu: Math.random() * 30, // 0-30%
        memory: Math.random() * 50 + 30, // 30-80%
        uptime: '47d 23h 45m',
        status: 'online',
        lastUpdate: new Date(),
      };
    }

    if (system === 'vespa') {
      return {
        cpu: Math.random() * 25,
        memory: Math.random() * 40 + 20,
        uptime: '15d 8h 32m',
        status: 'online',
        lastUpdate: new Date(),
      };
    }

    if (system === 'local') {
      // Local Mac metrics via browser APIs
      if (navigator.deviceMemory) {
        return {
          cpu: Math.random() * 40,
          memory: Math.random() * 60 + 20,
          uptime: 'current session',
          status: 'online',
          lastUpdate: new Date(),
        };
      }

      return {
        cpu: 0,
        memory: 0,
        uptime: 'N/A',
        status: 'online',
        lastUpdate: new Date(),
      };
    }

    return {
      cpu: 0,
      memory: 0,
      uptime: 'N/A',
      status: 'offline',
      lastUpdate: new Date(),
    };
  } catch (error) {
    console.error(`Failed to get metrics for ${system}:`, error);
    return {
      cpu: 0,
      memory: 0,
      uptime: 'N/A',
      status: 'offline',
      lastUpdate: new Date(),
    };
  }
};

export const formatUptime = (uptime: string): string => {
  return uptime;
};

export const getMetricsColor = (metric: number): string => {
  if (metric < 50) return '#10b981'; // green
  if (metric < 75) return '#f59e0b'; // amber
  return '#ef4444'; // red
};
