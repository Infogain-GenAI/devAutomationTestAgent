#!/usr/bin/env node
'use strict';

/**
 * Production Build and Deployment Script
 * 
 * This script validates, builds, and optionally pushes the Docker image
 * to Azure Container Registry for production deployment.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VERSION = '2.0.0';
const IMAGE_NAME = 'ignis-test-agent';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, silent = false) {
  try {
    const output = execSync(command, { 
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit'
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout };
  }
}

function checkPrerequisites() {
  log('\n📋 Checking Prerequisites...', 'cyan');
  
  // Check Docker
  const dockerCheck = exec('docker --version', true);
  if (!dockerCheck.success) {
    log('❌ Docker not found. Please install Docker.', 'red');
    process.exit(1);
  }
  log(`✅ Docker: ${dockerCheck.output.trim()}`, 'green');
  
  // Check Node.js
  const nodeCheck = exec('node --version', true);
  if (!nodeCheck.success) {
    log('❌ Node.js not found.', 'red');
    process.exit(1);
  }
  log(`✅ Node.js: ${nodeCheck.output.trim()}`, 'green');
  
  // Check package.json
  if (!fs.existsSync(path.join(__dirname, '..', 'package.json'))) {
    log('❌ package.json not found.', 'red');
    process.exit(1);
  }
  log('✅ package.json found', 'green');
  
  // Check Dockerfile
  if (!fs.existsSync(path.join(__dirname, '..', 'Dockerfile'))) {
    log('❌ Dockerfile not found.', 'red');
    process.exit(1);
  }
  log('✅ Dockerfile found', 'green');
}

function runValidation() {
  log('\n🔍 Running Validation Tests...', 'cyan');
  
  // Run npm validation
  const validateCheck = exec('npm run validate', false);
  if (!validateCheck.success) {
    log('❌ Validation failed. Fix errors before building.', 'red');
    process.exit(1);
  }
  log('✅ Validation passed', 'green');
}

function runSecurityScan() {
  log('\n🔒 Running Security Scan...', 'cyan');
  
  // Run npm audit
  const auditResult = exec('npm audit --production', true);
  if (auditResult.output && auditResult.output.includes('vulnerabilities')) {
    log('⚠️  Security vulnerabilities found:', 'yellow');
    console.log(auditResult.output);
    
    // Ask user if they want to continue
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      readline.question('Continue anyway? (yes/no): ', (answer) => {
        readline.close();
        if (answer.toLowerCase() !== 'yes') {
          log('❌ Build cancelled. Fix vulnerabilities first.', 'red');
          process.exit(1);
        }
        resolve();
      });
    });
  } else {
    log('✅ No vulnerabilities found', 'green');
    return Promise.resolve();
  }
}

function buildDockerImage(tag) {
  log(`\n🐳 Building Docker Image: ${tag}...`, 'cyan');
  
  const buildResult = exec(`docker build -t ${tag} .`, false);
  if (!buildResult.success) {
    log('❌ Docker build failed.', 'red');
    process.exit(1);
  }
  log(`✅ Image built successfully: ${tag}`, 'green');
}

function tagImage(sourceTag, targetTag) {
  log(`\n🏷️  Tagging Image: ${targetTag}...`, 'cyan');
  
  const tagResult = exec(`docker tag ${sourceTag} ${targetTag}`, true);
  if (!tagResult.success) {
    log('❌ Image tagging failed.', 'red');
    process.exit(1);
  }
  log(`✅ Image tagged: ${targetTag}`, 'green');
}

function pushImage(tag) {
  log(`\n⬆️  Pushing Image: ${tag}...`, 'cyan');
  
  const pushResult = exec(`docker push ${tag}`, false);
  if (!pushResult.success) {
    log('❌ Image push failed. Check ACR credentials.', 'red');
    process.exit(1);
  }
  log(`✅ Image pushed successfully: ${tag}`, 'green');
}

function scanImage(tag) {
  log(`\n🔍 Scanning Image for Vulnerabilities: ${tag}...`, 'cyan');
  
  // Try Trivy if available
  const trivyCheck = exec('trivy --version', true);
  if (trivyCheck.success) {
    log('Running Trivy scan...', 'blue');
    exec(`trivy image ${tag}`, false);
  } else {
    log('⚠️  Trivy not installed. Skipping image scan.', 'yellow');
    log('   Install: https://github.com/aquasecurity/trivy', 'yellow');
  }
}

async function main() {
  log('\n🚀 IGNIS Test Agent - Production Build Script', 'cyan');
  log(`Version: ${VERSION}\n`, 'blue');
  
  // Get ACR name from environment or command line
  const acrName = process.env.ACR_NAME || process.argv[2];
  const skipPush = process.argv.includes('--no-push');
  const skipValidation = process.argv.includes('--skip-validation');
  const skipScan = process.argv.includes('--skip-scan');
  
  if (!acrName && !skipPush) {
    log('Usage: node scripts/build-production.js <acr-name> [--no-push] [--skip-validation] [--skip-scan]', 'yellow');
    log('Example: node scripts/build-production.js myregistry.azurecr.io', 'yellow');
    log('\nOr set ACR_NAME environment variable:', 'yellow');
    log('export ACR_NAME=myregistry.azurecr.io', 'yellow');
    log('\nBuilding local image only (use --no-push to skip this message)...', 'blue');
  }
  
  // Step 1: Prerequisites
  checkPrerequisites();
  
  // Step 2: Validation
  if (!skipValidation) {
    runValidation();
  } else {
    log('\n⚠️  Skipping validation (--skip-validation)', 'yellow');
  }
  
  // Step 3: Security Scan
  if (!skipValidation && !skipScan) {
    await runSecurityScan();
  } else if (skipScan) {
    log('\n⚠️  Skipping security scan (--skip-scan)', 'yellow');
  }
  
  // Step 4: Build image
  const localTag = `${IMAGE_NAME}:${VERSION}`;
  buildDockerImage(localTag);
  
  // Step 5: Tag as latest
  const latestTag = `${IMAGE_NAME}:latest`;
  tagImage(localTag, latestTag);
  
  // Step 6: Scan image (if Trivy available)
  if (!skipScan) {
    scanImage(localTag);
  }
  
  // Step 7: Tag for ACR and push (if ACR specified)
  if (acrName && !skipPush) {
    const acrVersionTag = `${acrName}/${IMAGE_NAME}:${VERSION}`;
    const acrLatestTag = `${acrName}/${IMAGE_NAME}:latest`;
    
    tagImage(localTag, acrVersionTag);
    tagImage(localTag, acrLatestTag);
    
    // Check ACR login
    log('\n🔑 Checking Azure Container Registry login...', 'cyan');
    const acrRegistry = acrName.split('/')[0];
    const loginCheck = exec(`az acr login --name ${acrRegistry.replace('.azurecr.io', '')}`, true);
    
    if (!loginCheck.success) {
      log('⚠️  ACR login failed. Attempting to push anyway...', 'yellow');
      log('   If push fails, run: az acr login --name <registry-name>', 'yellow');
    } else {
      log('✅ ACR login successful', 'green');
    }
    
    pushImage(acrVersionTag);
    pushImage(acrLatestTag);
  } else if (skipPush) {
    log('\n⚠️  Skipping image push (--no-push)', 'yellow');
  }
  
  // Summary
  log('\n✅ Build Complete!', 'green');
  log('\n📦 Local Images:', 'cyan');
  log(`   - ${localTag}`, 'blue');
  log(`   - ${latestTag}`, 'blue');
  
  if (acrName && !skipPush) {
    log('\n☁️  Pushed to ACR:', 'cyan');
    log(`   - ${acrName}/${IMAGE_NAME}:${VERSION}`, 'blue');
    log(`   - ${acrName}/${IMAGE_NAME}:latest`, 'blue');
  }
  
  log('\n🎯 Next Steps:', 'cyan');
  log('   1. Test locally: docker run --rm <image-tag> node scripts/diagnose-container.js', 'blue');
  log('   2. Update workflows with new image tag', 'blue');
  log('   3. Deploy to production environment', 'blue');
  
  log('\n✨ Ready for production deployment!', 'green');
}

main().catch(err => {
  log(`\n❌ Build failed: ${err.message}`, 'red');
  process.exit(1);
});
