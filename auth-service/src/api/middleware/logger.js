const { randomUUID } = require('crypto');
const { createRequestLogger } = require('../../utils/logger');

const logger = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  const requestId = req.headers['x-request-id'] || randomUUID();
  const startTime = process.hrtime.bigint();

  req.correlationId = correlationId;
  req.requestId = requestId;
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', requestId);

  req.log = createRequestLogger({
    correlationId,
    requestId,
    method: req.method,
    path: req.path,
  });

  req.log.info({
    ip: req.ip,
    userAgent: req.get('user-agent'),
  }, 'Incoming request');

  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(elapsedNs) / 1e6;

    req.log.info({
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      contentLength: res.getHeader('content-length') || null,
    }, 'Request completed');
  });

  next();
};

module.exports = logger;
