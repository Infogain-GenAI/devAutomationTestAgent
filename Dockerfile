FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Copy package files and install
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy source
COPY src/ src/
COPY config/ config/
COPY action.yml ./

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Create workspace, logs, and reports directories
RUN mkdir -p /app/workspace /app/logs /app/reports

# Non-root user (Playwright image provides pwuser)
USER pwuser

# Environment defaults
ENV NODE_ENV=production
ENV PORT=4000
ENV LOG_LEVEL=info
ENV ENABLE_BACKEND_VALIDATION=true
ENV ENABLE_BEST_PRACTICES_CHECK=true
ENV ENABLE_ENDPOINT_VALIDATION=true
ENV GENERATE_ANALYSIS_REPORT=true
ENV REPORT_OUTPUT_DIR=reports

EXPOSE 4000

# Default: run API server. Override with `node src/cli.js` for CLI mode.
CMD ["node", "src/index.js"]
