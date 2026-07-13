import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import appRoutes from './routes/app'
import billingRoutes from './routes/billing'
import adminRoutes from './routes/admin'
import type { AppEnv } from './lib/middleware'

const app = new Hono<AppEnv>()

app.use('/api/*', cors({ origin: (o) => o, credentials: true }))

// Edge cache headers for static assets are handled by CF Pages automatically.

// ---------- API ----------
app.route('/api/auth', authRoutes)
app.route('/api/app', appRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/admin', adminRoutes)

app.get('/api/health', (c) => c.json({ ok: true, service: 'aura', time: new Date().toISOString() }))

// ---------- HTML shells ----------
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">`

const shell = (title: string, script: string, bodyId: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0B0F1A">
<title>${title}</title>
${fonts}
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
<link href="/static/aura.css" rel="stylesheet">
</head>
<body id="${bodyId}">
<main id="app" class="app-root"><div class="boot-loader"><div class="boot-orb"></div></div></main>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/aura-core.js"></script>
<script src="/static/${script}"></script>
</body>
</html>`

app.get('/', (c) => c.html(shell('AURA — Breathe with intention', 'app.js', 'aura-app')))
app.get('/pricing', (c) => c.html(shell('AURA — Simple, Transparent Pricing', 'pricing.js', 'aura-pricing')))
app.get('/billing', (c) => c.html(shell('AURA — Billing', 'billing.js', 'aura-billing')))
app.get('/admin', (c) => c.html(shell('AURA — Admin', 'admin.js', 'aura-admin')))
app.get('/admin/*', (c) => c.html(shell('AURA — Admin', 'admin.js', 'aura-admin')))

export default app
