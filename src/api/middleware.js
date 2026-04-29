'use strict';

const logger = require('../utils/logger');

/**
 * Request logging middleware.
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
}

/**
 * API key authentication middleware (optional, for production use).
 */
function authenticate(req, res, next) {
  const apiKey = process.env.IGNIS_API_KEY;
  if (!apiKey) return next(); // No auth configured

  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
  }
  next();
}

/**
 * Global error handler.
 */
function errorHandler(err, req, res, _next) {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
}

module.exports = { requestLogger, authenticate, errorHandler };
