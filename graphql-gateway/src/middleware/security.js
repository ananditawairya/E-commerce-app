const cors = require('cors');
const express = require('express');
const helmet = require('helmet');

/**
 * Applies common security and body-parser middleware.
 * @param {import('express').Express} app Express app.
 * @return {void}
 */
function applySecurityMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  }));

  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-ID',
      'Idempotency-Key',
    ],
  }));

  app.use(express.json({
    limit: '50mb',
    parameterLimit: 50000,
  }));
  app.use(express.urlencoded({
    limit: '50mb',
    parameterLimit: 50000,
    extended: true,
  }));
}

module.exports = {
  applySecurityMiddleware,
};
