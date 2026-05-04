# Production Deployment Guide - IGNIS Test Agent v2.0.0

This guide covers deploying the IGNIS Automation Test Agent to production environments.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Setup](#environment-setup)
3. [Docker Image Build](#docker-image-build)
4. [Deployment Options](#deployment-options)
5. [Post-Deployment Validation](#post-deployment-validation)
6. [Monitoring & Maintenance](#monitoring--maintenance)
7. [Rollback Procedures](#rollback-procedures)
8. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### ✅ Prerequisites

- [ ] Docker installed (version 20.10+)
- [ ] Azure CLI installed (if using Azure)
- [ ] kubectl installed (if using Kubernetes)
- [ ] OpenAI API key acquired
- [ ] GitHub token/app credentials configured
- [ ] All environment variables documented
- [ ] Security review completed
- [ ] Load testing performed (optional)

### ✅ Required Secrets

Create these secrets in your deployment platform:

```bash
OPENAI_API_KEY=sk-...                    # Required for AI provider
GITHUB_TOKEN=ghp_...                     # Required for GitHub operations
GITHUB_APP_ID=123456                     # Optional: GitHub App auth
GITHUB_PRIVATE_KEY=-----BEGIN...         # Optional: GitHub App auth
GITHUB_INSTALLATION_ID=7890              # Optional: GitHub App auth
POSTGRES_PASSWORD=<secure-password>      # Optional: if using database
APP_SECRETS={"key":"value"}              # Optional: application secrets
```

### ✅ Configuration Validation

Run validation locally before deploying:

```bash
# Validate configuration
npm run validate

# Test OpenAI connectivity
npm run preflight

# Test on demo app
export REPO_PATH="$PWD/test-demo-app"
export AUTO_START_APP="true"
export MAX_ITERATIONS="1"
npm run cli
```

---

## Environment Setup

### Required Environment Variables

```bash
# Core Configuration
NODE_ENV=production
LOG_LEVEL=info
AI_PROVIDER=openai

# Agent Configuration
MAX_ITERATIONS=3
AGENT_TIMEOUT_MINUTES=30
ENABLE_BACKEND_VALIDATION=true
ENABLE_BEST_PRACTICES_CHECK=true

# Testing Configuration
TEST_TYPES=e2e,api
BROWSERS=chromium
HEADLESS=true

# Paths (Container)
AGENT_WORK_DIR=/app/workspace
REPORT_OUTPUT_DIR=/app/reports
LOG_DIR=/app/logs
```

### Optional Environment Variables

```bash
# GitHub Configuration
GITHUB_AUTH_METHOD=pat                   # or 'app'
REPO_BRANCH=main
FIX_BRANCH_PREFIX=ignis/fix

# Application Configuration
AUTO_START_APP=false                     # Auto-start app before testing
APP_START_COMMAND=npm start
APP_URL=http://localhost:3000
APP_PORT=3000

# Database (API Server Mode)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ignis_agent
POSTGRES_USER=postgres

# API Server Mode
PORT=4000
```

---

## Docker Image Build

### Option 1: Automated Build Script (Recommended)

```bash
# Build and push to Azure Container Registry
npm run build:production myregistry.azurecr.io

# Build only (no push)
npm run build:production -- --no-push

# Skip validation (not recommended)
npm run build:production myregistry.azurecr.io --skip-validation
```

### Option 2: Manual Build

```bash
# Build image
docker build -t ignis-test-agent:2.0.0 .

# Tag for ACR
docker tag ignis-test-agent:2.0.0 myregistry.azurecr.io/ignis-test-agent:2.0.0
docker tag ignis-test-agent:2.0.0 myregistry.azurecr.io/ignis-test-agent:latest

# Login to ACR
az acr login --name myregistry

# Push to ACR
docker push myregistry.azurecr.io/ignis-test-agent:2.0.0
docker push myregistry.azurecr.io/ignis-test-agent:latest
```

### Verify Build

```bash
# Run diagnostics
npm run docker:diagnose

# Or manually:
docker run --rm ignis-test-agent:2.0.0 node scripts/diagnose-container.js
```

---

## Deployment Options

### Option 1: GitHub Actions (Recommended for CI/CD)

#### Setup Steps

1. **Add Secrets to Repository**
   - Go to Settings → Secrets and variables → Actions
   - Add: `OPENAI_API_KEY`, `GITHUB_TOKEN`

2. **Create Workflow File**

```yaml
# .github/workflows/ignis-testing.yml
name: IGNIS Automation Testing

on:
  pull_request:
    branches: [main, develop]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run IGNIS Test Agent
        uses: your-org/ignis-test-agent@v2
        with:
          ai-provider: 'openai'
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          test-types: 'e2e,api'
          max-iterations: '3'
          auto-start-app: 'true'
          app-start-command: 'npm start'
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: |
            test-results/
            playwright-report/
```

#### Composite Action Usage

```yaml
steps:
  - uses: your-org/ignis-test-agent@v2
    with:
      ai-provider: 'openai'
      openai-api-key: ${{ secrets.OPENAI_API_KEY }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

### Option 2: Azure Container Instance

#### Deploy with Azure CLI

```bash
# Set variables
RESOURCE_GROUP="ignis-rg"
CONTAINER_NAME="ignis-agent"
ACR_NAME="myregistry.azurecr.io"
IMAGE="${ACR_NAME}/ignis-test-agent:latest"

# Create resource group (if not exists)
az group create --name $RESOURCE_GROUP --location eastus

# Create container instance
az container create \
  --resource-group $RESOURCE_GROUP \
  --name $CONTAINER_NAME \
  --image $IMAGE \
  --cpu 2 \
  --memory 4 \
  --registry-login-server $ACR_NAME \
  --registry-username $(az acr credential show --name ${ACR_NAME%.azurecr.io} --query username -o tsv) \
  --registry-password $(az acr credential show --name ${ACR_NAME%.azurecr.io} --query passwords[0].value -o tsv) \
  --environment-variables \
    NODE_ENV=production \
    AI_PROVIDER=openai \
    LOG_LEVEL=info \
  --secure-environment-variables \
    OPENAI_API_KEY=$OPENAI_API_KEY \
    GITHUB_TOKEN=$GITHUB_TOKEN \
  --ports 4000 \
  --ip-address Public \
  --restart-policy Never
```

#### With Azure Portal

1. Navigate to **Container Instances**
2. Click **+ Create**
3. Fill in:
   - **Basics:** Name, region, image source (ACR)
   - **Container:** Image tag, CPU (2), Memory (4GB)
   - **Environment Variables:** Add required vars (mark secrets as secure)
   - **Networking:** Public IP, port 4000
4. Review + Create

---

### Option 3: Kubernetes (AKS)

#### Create Kubernetes Manifests

**Namespace:**
```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ignis-system
```

**Secret:**
```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: ignis-secrets
  namespace: ignis-system
type: Opaque
stringData:
  openai-api-key: "sk-..."
  github-token: "ghp_..."
```

**Deployment:**
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ignis-agent
  namespace: ignis-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ignis-agent
  template:
    metadata:
      labels:
        app: ignis-agent
    spec:
      containers:
      - name: agent
        image: myregistry.azurecr.io/ignis-test-agent:2.0.0
        ports:
        - containerPort: 4000
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: AI_PROVIDER
          value: "openai"
        - name: LOG_LEVEL
          value: "info"
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: ignis-secrets
              key: openai-api-key
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: ignis-secrets
              key: github-token
        resources:
          requests:
            cpu: "1000m"
            memory: "2Gi"
          limits:
            cpu: "2000m"
            memory: "4Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 40
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 10
          periodSeconds: 10
        volumeMounts:
        - name: logs
          mountPath: /app/logs
        - name: workspace
          mountPath: /app/workspace
      volumes:
      - name: logs
        emptyDir: {}
      - name: workspace
        emptyDir: {}
```

**Service:**
```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: ignis-agent
  namespace: ignis-system
spec:
  type: ClusterIP
  ports:
  - port: 4000
    targetPort: 4000
    name: http
  selector:
    app: ignis-agent
```

#### Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Check status
kubectl get pods -n ignis-system
kubectl logs -f deployment/ignis-agent -n ignis-system

# Access service
kubectl port-forward -n ignis-system svc/ignis-agent 4000:4000
```

---

### Option 4: Docker Compose (Development/Staging)

```yaml
# docker-compose.production.yml
version: '3.8'

services:
  ignis-agent:
    image: myregistry.azurecr.io/ignis-test-agent:2.0.0
    container_name: ignis-agent
    restart: unless-stopped
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
      - AI_PROVIDER=openai
      - LOG_LEVEL=info
    env_file:
      - .env.production
    volumes:
      - ./logs:/app/logs
      - ./reports:/app/reports
      - ./workspace:/app/workspace
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
  
  postgres:
    image: postgres:16-alpine
    container_name: ignis-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=ignis_agent
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres-data:
```

**Deploy:**
```bash
docker-compose -f docker-compose.production.yml up -d
```

---

## Post-Deployment Validation

### Health Check

```bash
# For API server mode
curl http://localhost:4000/health

# Expected response:
# {"status":"ok","timestamp":"2026-05-04T..."}
```

### Smoke Test

```bash
# Run against demo app
docker run --rm \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  -e REPO_PATH=/app/test-demo-app \
  -e AUTO_START_APP=true \
  -e MAX_ITERATIONS=1 \
  -e TEST_TYPES=api \
  myregistry.azurecr.io/ignis-test-agent:2.0.0
```

### Log Monitoring

```bash
# Kubernetes
kubectl logs -f deployment/ignis-agent -n ignis-system

# Azure Container Instance
az container logs --resource-group ignis-rg --name ignis-agent --follow

# Docker
docker logs -f ignis-agent
```

---

## Monitoring & Maintenance

### Key Metrics to Monitor

1. **Container Health**
   - CPU usage (target: <70%)
   - Memory usage (target: <80%)
   - Restart count
   - Health check status

2. **Application Metrics**
   - Test execution duration
   - Success/failure rates
   - AI API call latency
   - GitHub API rate limits

3. **Error Tracking**
   - Application errors
   - Test failures
   - AI provider errors
   - Network failures

### Log Aggregation

**Azure Monitor:**
```bash
# Enable Container Insights
az monitor log-analytics workspace create \
  --resource-group ignis-rg \
  --workspace-name ignis-logs

# Link to AKS
az aks enable-addons \
  --resource-group ignis-rg \
  --name ignis-cluster \
  --addons monitoring \
  --workspace-resource-id /subscriptions/.../workspaces/ignis-logs
```

**ELK Stack:**
```yaml
# Add Filebeat sidecar to collect logs
volumes:
- name: logs
  emptyDir: {}
containers:
- name: filebeat
  image: docker.elastic.co/beats/filebeat:8.12.0
  volumeMounts:
  - name: logs
    mountPath: /app/logs
    readOnly: true
```

### Backup & Recovery

```bash
# Backup logs and reports
kubectl cp ignis-system/ignis-agent-xxx:/app/logs ./backup/logs
kubectl cp ignis-system/ignis-agent-xxx:/app/reports ./backup/reports

# Backup database (if used)
pg_dump -h postgres-host -U postgres ignis_agent > backup.sql
```

---

## Rollback Procedures

### Kubernetes Rollback

```bash
# Check deployment history
kubectl rollout history deployment/ignis-agent -n ignis-system

# Rollback to previous version
kubectl rollout undo deployment/ignis-agent -n ignis-system

# Rollback to specific revision
kubectl rollout undo deployment/ignis-agent -n ignis-system --to-revision=2

# Verify rollback
kubectl rollout status deployment/ignis-agent -n ignis-system
```

### Azure Container Instance Rollback

```bash
# Delete current instance
az container delete --resource-group ignis-rg --name ignis-agent --yes

# Recreate with previous image version
az container create \
  --resource-group ignis-rg \
  --name ignis-agent \
  --image myregistry.azurecr.io/ignis-test-agent:1.9.0 \
  ...
```

### GitHub Actions Rollback

```yaml
# Pin to specific version in workflow
uses: your-org/ignis-test-agent@v1.9.0  # Instead of @v2
```

---

## Troubleshooting

### Common Issues

#### 1. Container Won't Start

**Symptoms:** Container exits immediately  
**Solution:**
```bash
# Check logs
docker logs ignis-agent

# Run diagnostics
docker run --rm ignis-test-agent:latest node scripts/diagnose-container.js

# Check environment variables
docker exec ignis-agent env | grep -E '(OPENAI|GITHUB|AI_PROVIDER)'
```

#### 2. AI Provider Errors

**Symptoms:** "Error: Invalid API key" or "Error: Rate limit exceeded"  
**Solution:**
```bash
# Verify API key
npm run preflight

# Check rate limits (OpenAI)
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Switch to different provider
export AI_PROVIDER=claude
export CLAUDE_API_KEY=sk-ant-...
```

#### 3. GitHub API Rate Limit

**Symptoms:** "Error: API rate limit exceeded"  
**Solution:**
```bash
# Check rate limit
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Use GitHub App auth (higher limits)
export GITHUB_AUTH_METHOD=app
export GITHUB_APP_ID=123456
export GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
```

#### 4. Test Generation Failures

**Symptoms:** "Error: Failed to generate tests"  
**Solution:**
```bash
# Check repository structure
ls -R /app/workspace

# Increase iterations
export MAX_ITERATIONS=5

# Enable debug logging
export LOG_LEVEL=debug
```

#### 5. Permission Denied Errors

**Symptoms:** "EACCES: permission denied"  
**Solution:**
```bash
# Check user in container
docker exec ignis-agent whoami
# Should be: pwuser

# Check permissions
docker exec ignis-agent ls -la /app/workspace

# Fix permissions
docker run --rm -v $(pwd)/workspace:/app/workspace \
  ignis-test-agent:latest \
  chown -R pwuser:pwuser /app/workspace
```

---

## Security Hardening Checklist

### Production Security

- [ ] Use non-root user (pwuser) ✅ Already configured
- [ ] Scan image for vulnerabilities (Trivy/Snyk)
- [ ] Enable read-only root filesystem (if possible)
- [ ] Drop unnecessary Linux capabilities
- [ ] Use secrets management (Azure Key Vault, AWS Secrets Manager)
- [ ] Enable network policies (Kubernetes)
- [ ] Implement RBAC (Kubernetes)
- [ ] Use private container registry
- [ ] Enable audit logging
- [ ] Rotate secrets regularly
- [ ] Monitor for security events
- [ ] Keep dependencies updated

### Container Security Scan

```bash
# Using Trivy
trivy image myregistry.azurecr.io/ignis-test-agent:2.0.0

# Using Snyk
snyk container test myregistry.azurecr.io/ignis-test-agent:2.0.0

# Azure Defender for Containers
az security assessment list \
  --resource-group ignis-rg
```

---

## Support & Escalation

### Documentation
- **README:** Complete feature documentation
- **PRODUCTION-READINESS-REPORT:** Validation and checklist
- **Troubleshooting:** Common issues and solutions

### Monitoring Dashboards
- Azure Monitor / Application Insights
- Grafana / Prometheus
- ELK Stack

### Emergency Contacts
- DevOps Team: devops@company.com
- Platform Team: platform@company.com
- Security Team: security@company.com

---

**✨ Your IGNIS Test Agent is now production-ready!**

For additional support, refer to the [README.md](./README.md) and [PRODUCTION-READINESS-REPORT.md](./PRODUCTION-READINESS-REPORT.md).
