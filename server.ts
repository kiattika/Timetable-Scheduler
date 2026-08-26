import express from 'express';
import path from 'path';
import { MetricServiceClient } from '@google-cloud/monitoring';

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', school: 'Uttaradit School (@utd.ac.th)' });
  });

  // API Route: ดึงข้อมูลสถิติ Firestore Document Operations จาก Google Cloud Monitoring API
  app.get('/api/firestore-usage-stats', async (req, res) => {
    const requestedDays = parseInt(req.query.days as string, 10) || 7;
    const days = Math.min(Math.max(1, requestedDays), 30);

    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 
                      process.env.GCLOUD_PROJECT || 
                      process.env.GOOGLE_CLOUD_PROJECT;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'ไม่พบการตั้งค่า Google Cloud Project ID (VITE_FIREBASE_PROJECT_ID หรือ GCLOUD_PROJECT)'
      });
    }

    const nowMs = Date.now();
    const startTimeSeconds = Math.floor((nowMs - days * 24 * 60 * 60 * 1000) / 1000);
    const endTimeSeconds = Math.floor(nowMs / 1000);

    const formatDateKey = (d: Date): string => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const dailyMap: Record<string, { date: string; reads: number; writes: number; deletes: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(nowMs - i * 24 * 60 * 60 * 1000);
      const dateKey = formatDateKey(d);
      dailyMap[dateKey] = { date: dateKey, reads: 0, writes: 0, deletes: 0 };
    }

    const metricsToQuery = [
      { key: 'reads', type: 'firestore.googleapis.com/document/read_count' },
      { key: 'writes', type: 'firestore.googleapis.com/document/write_count' },
      { key: 'deletes', type: 'firestore.googleapis.com/document/delete_count' }
    ];

    try {
      const monitoringClient = new MetricServiceClient();
      const projectName = monitoringClient.projectPath(projectId);

      for (const metricDef of metricsToQuery) {
        try {
          const request = {
            name: projectName,
            filter: `metric.type = "${metricDef.type}"`,
            interval: {
              startTime: { seconds: startTimeSeconds },
              endTime: { seconds: endTimeSeconds }
            },
            aggregation: {
              alignmentPeriod: { seconds: 86400 },
              perSeriesAligner: 'ALIGN_SUM',
              crossSeriesReducer: 'REDUCE_SUM'
            }
          };

          const [timeSeries] = await monitoringClient.listTimeSeries(request as any);

          if (timeSeries && Array.isArray(timeSeries)) {
            for (const series of timeSeries) {
              if (series.points && Array.isArray(series.points)) {
                for (const point of series.points) {
                  const pointEndTime = point.interval?.endTime?.seconds;
                  if (pointEndTime) {
                    const pointDate = new Date(Number(pointEndTime) * 1000);
                    const dateKey = formatDateKey(pointDate);
                    let pointValue = 0;
                    if (point.value?.int64Value !== undefined && point.value?.int64Value !== null) {
                      pointValue = Number(point.value.int64Value);
                    } else if (point.value?.doubleValue !== undefined && point.value?.doubleValue !== null) {
                      pointValue = Math.round(Number(point.value.doubleValue));
                    }

                    if (dailyMap[dateKey]) {
                      if (metricDef.key === 'reads') dailyMap[dateKey].reads += pointValue;
                      if (metricDef.key === 'writes') dailyMap[dateKey].writes += pointValue;
                      if (metricDef.key === 'deletes') dailyMap[dateKey].deletes += pointValue;
                    }
                  }
                }
              }
            }
          }
        } catch (mErr: any) {
          console.warn(`Could not list time series for ${metricDef.type}:`, mErr.message);
        }
      }

      const dailyStats = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
      const totalReads = dailyStats.reduce((acc, curr) => acc + curr.reads, 0);
      const totalWrites = dailyStats.reduce((acc, curr) => acc + curr.writes, 0);
      const totalDeletes = dailyStats.reduce((acc, curr) => acc + curr.deletes, 0);
      const daysCount = Math.max(1, dailyStats.length);

      return res.json({
        success: true,
        projectId,
        source: 'Google Cloud Monitoring API',
        timeRange: {
          days,
          startDate: dailyStats[0]?.date || formatDateKey(new Date(nowMs - days * 86400000)),
          endDate: dailyStats[dailyStats.length - 1]?.date || formatDateKey(new Date(nowMs))
        },
        dailyStats,
        totals: {
          totalReads,
          totalWrites,
          totalDeletes,
          dailyAverageReads: Math.round(totalReads / daysCount),
          dailyAverageWrites: Math.round(totalWrites / daysCount),
          dailyAverageDeletes: Math.round(totalDeletes / daysCount)
        },
        fetchedAt: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('Error fetching Firestore stats from Cloud Monitoring in Express:', err);
      let errorMessage = err.message || 'Unknown error querying Cloud Monitoring API';
      if (err.code === 7 || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('permission') || errorMessage.includes('IAM')) {
        errorMessage = `ไม่สามารถดึงข้อมูลสถิติได้เนื่องจากติดสิทธิ์ IAM: บัญชี Service Account ของระบบยังไม่ได้รับบทบาท 'Monitoring Viewer' (roles/monitoring.viewer) บน Google Cloud Project "${projectId}"`;
      } else if (errorMessage.includes('Could not load the default credentials') || errorMessage.includes('credentials')) {
        errorMessage = `ยังไม่ได้กำหนดค่า Google Cloud Application Default Credentials สำหรับ Cloud Monitoring บนสภาพแวดล้อมนี้ หรือ Service Account ยังไม่ได้รับสิทธิ์ Monitoring Viewer บนโปรเจกต์ "${projectId}"`;
      }

      return res.status(500).json({
        success: false,
        error: errorMessage,
        projectId
      });
    }
  });

  // Vite middleware สำหรับโหมดทดสอบพัฒนา
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();