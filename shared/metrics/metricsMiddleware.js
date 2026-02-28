/**
 * Prometheus metrics middleware for Express.
 *
 * Usage in each service:
 *   const promClient = require('prom-client');
 *   const { createMetricsMiddleware, createMetricsEndpoint } = require('../../shared/metrics/metricsMiddleware');
 *   const { middleware, endpoint } = createMetrics(promClient, 'auth-service');
 *   app.use(middleware);
 *   app.get('/metrics', endpoint);
 */

// Normalize route paths to avoid high-cardinality labels
const normalizeRoute = (req) => {
    let route = req.route?.path || req.path || 'unknown';
    // Collapse MongoDB ObjectIDs and numeric IDs into :id
    route = route.replace(/\/[0-9a-fA-F]{24}/g, '/:id');
    route = route.replace(/\/\d+/g, '/:id');
    return route;
};

/**
 * Factory that creates metrics middleware and endpoint.
 * @param {import('prom-client')} client - The prom-client module (passed in by the service)
 * @param {string} serviceName - e.g. 'auth-service'
 */
const createMetrics = (client, serviceName) => {
    const register = new client.Registry();

    // Collect default Node.js metrics (memory, CPU, event loop, GC)
    client.collectDefaultMetrics({ register, prefix: 'ecom_' });

    // HTTP request duration histogram
    const httpRequestDuration = new client.Histogram({
        name: 'ecom_http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code', 'service'],
        buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
        registers: [register],
    });

    // HTTP requests total counter
    const httpRequestsTotal = new client.Counter({
        name: 'ecom_http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code', 'service'],
        registers: [register],
    });

    // Active requests gauge
    const httpActiveRequests = new client.Gauge({
        name: 'ecom_http_active_requests',
        help: 'Number of active HTTP requests',
        labelNames: ['service'],
        registers: [register],
    });

    // Express middleware
    const middleware = (req, res, next) => {
        if (req.path === '/metrics') return next();

        httpActiveRequests.labels(serviceName).inc();
        const end = httpRequestDuration.startTimer();

        res.on('finish', () => {
            const route = normalizeRoute(req);
            const labels = {
                method: req.method,
                route,
                status_code: res.statusCode,
                service: serviceName,
            };
            end(labels);
            httpRequestsTotal.labels(labels).inc();
            httpActiveRequests.labels(serviceName).dec();
        });

        next();
    };

    // /metrics endpoint handler
    const endpoint = async (_req, res) => {
        try {
            res.set('Content-Type', register.contentType);
            res.end(await register.metrics());
        } catch (error) {
            res.status(500).end(error.message);
        }
    };

    return { middleware, endpoint };
};

module.exports = { createMetrics };
