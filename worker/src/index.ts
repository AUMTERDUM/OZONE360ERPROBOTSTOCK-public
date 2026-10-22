import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrfProtection } from './middleware/csrf';
import { authRoutes } from './routes/auth';
import { modelsRoutes } from './routes/models';
import { customersRoutes, contactsRoutes, sitesRoutes } from './routes/customers';
import { robotsRoutes } from './routes/robots';
import { usersRoutes } from './routes/users';
import { warehousesRoutes } from './routes/warehouses';
import { customerPartsRoutes } from './routes/customer-parts';
import { sparePartsRoutes } from './routes/spare-parts';
import { notificationsRoutes } from './routes/notifications';
import { trashRoutes } from './routes/trash';
import { ticketsRoutes, trackRoutes } from './routes/tickets';
import { schedulesRoutes, maPlansRoutes, maVisitsRoutes } from './routes/maintenance';
import { siteSurveysRoutes } from './routes/site-surveys';
import { deliveryNotesRoutes } from './routes/delivery-notes';
import { loansRoutes } from './routes/loans';
import { materialRequestsRoutes } from './routes/material-requests';
import { purchaseOrdersRoutes } from './routes/purchase-orders';
import { projectRequestsRoutes } from './routes/project-requests';
import { accountsRoutes } from './routes/accounts';
import { invoicesRoutes, paymentsRoutes } from './routes/invoices';
import { journalRoutes, budgetsRoutes, travelExpensesRoutes } from './routes/finance';
import { statsRoutes } from './routes/stats';
import { logsRoutes, timelineRoutes } from './routes/logs';
import { uploadRoutes, attachmentsRoutes, publicMediaRoutes } from './routes/uploads';
import { portalRoutes } from './routes/portal';
import { puduRoutes } from './routes/pudu';
import { agentsImportRoutes } from './routes/agents-import';
import { backupRoutes } from './routes/backup';
import { rateLimit } from './middleware/rate-limit';
import { getDb } from './db/client';
import { createNotification } from './lib/notifications';
import { dailyBackupJob, overdueLoanAlertJob, slaAndScheduleJob, puduAutoSyncJob } from './lib/cron-jobs';
import type { AppEnv, Bindings } from './types';

const app = new Hono<AppEnv>();

app.use('/api/*', async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS.split(',');
  return cors({
    origin: (origin) => (!origin || allowedOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })(c, next);
});

// Global API rate limiter: 300 req/min/IP (matches server/index.ts's apiLimiter).
app.use('/api/*', rateLimit('API_LIMITER', 'Too many requests. Please slow down.'));

app.use('/api/*', csrfProtection);

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.route('/api/auth', authRoutes);
app.route('/api/models', modelsRoutes);
app.route('/api/customer-parts', customerPartsRoutes);
app.route('/api/customers', customersRoutes);
app.route('/api/contacts', contactsRoutes);
app.route('/api/sites', sitesRoutes);
app.route('/api/robots', robotsRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/warehouses', warehousesRoutes);
app.route('/api/spare-parts', sparePartsRoutes);
app.route('/api/notifications', notificationsRoutes);
app.route('/api/trash', trashRoutes);
app.route('/api/tickets', ticketsRoutes);
app.route('/api/track', trackRoutes);
app.route('/api/maintenance-schedules', schedulesRoutes);
app.route('/api/ma-plans', maPlansRoutes);
app.route('/api/site-surveys', siteSurveysRoutes);
app.route('/api/ma-visits', maVisitsRoutes);
app.route('/api/delivery-notes', deliveryNotesRoutes);
app.route('/api/loans', loansRoutes);
app.route('/api/material-requests', materialRequestsRoutes);
app.route('/api/purchase-orders', purchaseOrdersRoutes);
app.route('/api/project-requests', projectRequestsRoutes);
app.route('/api/accounts', accountsRoutes);
app.route('/api/invoices', invoicesRoutes);
app.route('/api/payments', paymentsRoutes);
app.route('/api/journal-entries', journalRoutes);
app.route('/api/budgets', budgetsRoutes);
app.route('/api/travel-expenses', travelExpensesRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/logs', logsRoutes);
app.route('/api/timeline', timelineRoutes);
app.route('/api/upload', uploadRoutes);
app.route('/api/attachments', attachmentsRoutes);
app.route('/uploads', publicMediaRoutes);
app.route('/api/portal', portalRoutes);
app.route('/api/pudu', puduRoutes);
app.route('/api/agents/import', agentsImportRoutes);
app.route('/api/backup', backupRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Cron Triggers dispatch table — see wrangler.toml [triggers].crons for the schedules.
// Each Worker isolate handles one scheduled event at a time; event.cron tells us which
// of the four schedules fired so a single handler can serve all of them.
const CRON_JOBS: Record<string, (env: Bindings) => Promise<void>> = {
  '0 0 * * *': async (env) => { await dailyBackupJob(getDb(env.DB), env.UPLOADS); },
  '0 8 * * *': async (env) => { await overdueLoanAlertJob(getDb(env.DB)); },
  '0 * * * *': async (env) => { await slaAndScheduleJob(getDb(env.DB)); },
  '0 */6 * * *': async (env) => { await puduAutoSyncJob(getDb(env.DB), env); },
};

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    const job = CRON_JOBS[event.cron];
    if (!job) { console.error(`[cron] No handler for schedule "${event.cron}"`); return; }
    ctx.waitUntil(job(env).catch(async (err) => {
      console.error(`[cron] ${event.cron} failed:`, err);
      try { await createNotification(getDb(env.DB), 'system_error', `Cron ล้มเหลว: ${event.cron}`, String(err instanceof Error ? err.message : err).slice(0, 500), 'Cron', event.cron); } catch { /* best effort */ }
    }));
  },
};
