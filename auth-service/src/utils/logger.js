const axios = require('axios');

const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SERVICE_NAME = process.env.SERVICE_NAME || 'auth-service';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_DESTINATION = (process.env.LOG_DESTINATION || 'console').toLowerCase();
const LOG_HTTP_ENDPOINT = process.env.LOG_HTTP_ENDPOINT || '';
const LOG_HTTP_AUTH_TOKEN = process.env.LOG_HTTP_AUTH_TOKEN || '';
const LOG_HTTP_TIMEOUT_MS = Number.parseInt(process.env.LOG_HTTP_TIMEOUT_MS || '1500', 10);

let warnedMissingHttpEndpoint = false;

const getPriority = (level) => LEVEL_PRIORITY[level] || LEVEL_PRIORITY.info;

const isLevelEnabled = (level) => getPriority(level) >= getPriority(LOG_LEVEL);

const toSerializable = (value) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(toSerializable);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, nestedValue]) => {
      acc[key] = toSerializable(nestedValue);
      return acc;
    }, {});
  }

  return value;
};

const shouldWriteConsole = LOG_DESTINATION === 'console' || LOG_DESTINATION === 'both';
const shouldSendHttp = LOG_DESTINATION === 'http' || LOG_DESTINATION === 'both';

const writeConsole = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(line);
    return;
  }

  if (entry.level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
};

const writeHttp = (entry) => {
  if (!shouldSendHttp) {
    return;
  }

  if (!LOG_HTTP_ENDPOINT) {
    if (!warnedMissingHttpEndpoint) {
      warnedMissingHttpEndpoint = true;
      console.warn(JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        service: SERVICE_NAME,
        message: 'LOG_DESTINATION includes http but LOG_HTTP_ENDPOINT is not configured',
      }));
    }
    return;
  }

  const headers = {};
  if (LOG_HTTP_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${LOG_HTTP_AUTH_TOKEN}`;
  }

  void axios.post(LOG_HTTP_ENDPOINT, entry, {
    headers,
    timeout: LOG_HTTP_TIMEOUT_MS,
  }).catch((error) => {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      service: SERVICE_NAME,
      message: 'Failed to send log to centralized HTTP endpoint',
      endpoint: LOG_HTTP_ENDPOINT,
      error: error.message,
    }));
  });
};

const normalizeArgs = (metaOrMessage, maybeMessage) => {
  if (typeof metaOrMessage === 'string') {
    return {
      metadata: {},
      message: metaOrMessage,
    };
  }

  return {
    metadata: metaOrMessage || {},
    message: maybeMessage || '',
  };
};

const createLogger = (baseContext = {}) => {
  const write = (level, metaOrMessage, maybeMessage) => {
    if (!isLevelEnabled(level)) {
      return;
    }

    const { metadata, message } = normalizeArgs(metaOrMessage, maybeMessage);

    const entry = {
      level,
      timestamp: new Date().toISOString(),
      service: SERVICE_NAME,
      message,
      ...toSerializable(baseContext),
      ...toSerializable(metadata),
    };

    if (shouldWriteConsole) {
      writeConsole(entry);
    }

    writeHttp(entry);
  };

  return {
    debug: (metaOrMessage, maybeMessage) => write('debug', metaOrMessage, maybeMessage),
    info: (metaOrMessage, maybeMessage) => write('info', metaOrMessage, maybeMessage),
    warn: (metaOrMessage, maybeMessage) => write('warn', metaOrMessage, maybeMessage),
    error: (metaOrMessage, maybeMessage) => write('error', metaOrMessage, maybeMessage),
    child: (context = {}) => createLogger({ ...baseContext, ...context }),
  };
};

const appLogger = createLogger();

const createRequestLogger = ({ correlationId, requestId, method, path }) =>
  createLogger({
    correlationId,
    requestId,
    method,
    path,
  });

const getLoggingConfig = () => ({
  level: LOG_LEVEL,
  destination: LOG_DESTINATION,
  hasHttpEndpoint: Boolean(LOG_HTTP_ENDPOINT),
});

module.exports = {
  appLogger,
  createRequestLogger,
  getLoggingConfig,
};
