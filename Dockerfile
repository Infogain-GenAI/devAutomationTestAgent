FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Metadata labels for production tracking
LABEL maintainer="IGNIS Team"
LABEL version="2.0.0"
LABEL description="IGNIS Automation Test Agent - AI-powered testing with Playwright"

WORKDIR /app

# Copy package files and install (production only)
COPY package.json package-lock.json* ./
RUN npm ci --production --no-audit --no-fund && \
    npm cache clean --force

# Copy source code and configuration
COPY src/ src/
COPY config/ config/
COPY scripts/ scripts/
COPY action.yml ./

# Make scripts executable
RUN chmod +x scripts/*.js scripts/*.sh || true

# Install Playwright browsers (chromium only for smaller image)
RUN npx playwright install --with-deps chromium

# Create required directories with proper permissions
RUN mkdir -p /app/workspace /app/logs /app/reports /app/test-results && \
    chown -R pwuser:pwuser /app/workspace /app/logs /app/reports /app/test-results

# Switch to non-root user for security
USER pwuser

# Environment defaults for production
ENV NODE_ENV=production \
    PORT=4000 \
    LOG_LEVEL=info \
    AI_PROVIDER=openai \
    AGENT_WORK_DIR=/app/workspace \
    ENABLE_BACKEND_VALIDATION=true \
    ENABLE_BEST_PRACTICES_CHECK=true \
    ENABLE_ENDPOINT_VALIDATION=true \
    GENERATE_ANALYSIS_REPORT=true \
    REPORT_OUTPUT_DIR=/app/reports \
    ANALYSIS_PROMPT_FILE=/app/config/analysis-prompts.json

# Health check for container orchestration (API server mode)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 1

EXPOSE 4000

# Use entrypoint script to handle flags and validation
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]

# Default: Run CLI (can be overridden to run API server with: docker run ... node src/index.js)
CMD []
