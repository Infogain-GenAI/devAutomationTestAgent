FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Copy package files and install
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy source
COPY src/ src/
COPY config/ config/
COPY scripts/ scripts/
COPY action.yml ./

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Create workspace, logs, and reports directories with proper permissions
RUN mkdir -p /app/workspace /app/logs /app/reports && \
    chown -R pwuser:pwuser /app/workspace /app/logs /app/reports

# Non-root user (Playwright image provides pwuser)
USER pwuser

# Environment defaults
ENV NODE_ENV=production
ENV PORT=4000
ENV LOG_LEVEL=info
ENV AI_PROVIDER=openai
ENV AGENT_WORK_DIR=/app/workspace
ENV ENABLE_BACKEND_VALIDATION=true
ENV ENABLE_BEST_PRACTICES_CHECK=true
ENV ENABLE_ENDPOINT_VALIDATION=true
ENV GENERATE_ANALYSIS_REPORT=true
ENV REPORT_OUTPUT_DIR=/app/reports
ENV ANALYSIS_PROMPT_FILE=/app/config/analysis-prompts.json

EXPOSE 4000

# Default: CLI mode for GitHub Actions. Override with `node src/index.js` for API server.
CMD ["node", "/app/src/cli.js"]
