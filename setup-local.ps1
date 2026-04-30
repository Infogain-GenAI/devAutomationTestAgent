# IGNIS Test Agent - Local Testing Script
# This script helps you quickly set up and run IGNIS locally

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   IGNIS Automation Test Agent - Local Setup     " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Function to prompt for input with default
function Get-InputWithDefault {
    param(
        [string]$Prompt,
        [string]$Default
    )
    $input = Read-Host "$Prompt (default: $Default)"
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input
}

# Step 1: Check prerequisites
Write-Host "Step 1: Checking prerequisites..." -ForegroundColor Yellow
Write-Host ""

$allGood = $true

if (Test-Command node) {
    $nodeVersion = node --version
    Write-Host "  [✓] Node.js: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  [✗] Node.js not found. Please install from https://nodejs.org" -ForegroundColor Red
    $allGood = $false
}

if (Test-Command npm) {
    $npmVersion = npm --version
    Write-Host "  [✓] npm: v$npmVersion" -ForegroundColor Green
} else {
    Write-Host "  [✗] npm not found" -ForegroundColor Red
    $allGood = $false
}

if (-not $allGood) {
    Write-Host ""
    Write-Host "Please install missing prerequisites and run this script again." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Install dependencies
Write-Host "Step 2: Installing dependencies..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path "node_modules") {
    Write-Host "  Dependencies already installed. Skipping..." -ForegroundColor Gray
} else {
    Write-Host "  Installing npm packages..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [✗] Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [✓] Dependencies installed" -ForegroundColor Green
}

Write-Host ""

# Step 3: Install Playwright
Write-Host "Step 3: Installing Playwright browsers..." -ForegroundColor Yellow
Write-Host ""

$playwrightInstalled = Test-Path "node_modules\playwright"
if ($playwrightInstalled) {
    Write-Host "  Installing Chromium browser..." -ForegroundColor Cyan
    npx playwright install chromium --with-deps
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [✗] Failed to install Playwright browsers" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [✓] Playwright browsers installed" -ForegroundColor Green
} else {
    Write-Host "  [✗] Playwright not found in node_modules" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Configure environment
Write-Host "Step 4: Configuring environment..." -ForegroundColor Yellow
Write-Host ""

$envExists = Test-Path ".env"
if ($envExists) {
    Write-Host "  .env file already exists." -ForegroundColor Gray
    $overwrite = Read-Host "  Do you want to reconfigure? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "  Skipping configuration..." -ForegroundColor Gray
        Write-Host ""
        $setupComplete = $true
    } else {
        $setupComplete = $false
    }
} else {
    $setupComplete = $false
}

if (-not $setupComplete) {
    Write-Host ""
    Write-Host "  Let's set up your configuration..." -ForegroundColor Cyan
    Write-Host ""
    
    # AI Provider
    Write-Host "  AI Provider Configuration:" -ForegroundColor White
    $provider = Get-InputWithDefault "    Which AI provider? (openai/gemini/claude)" "openai"
    
    $apiKey = Read-Host "    Enter your API key"
    while ([string]::IsNullOrWhiteSpace($apiKey)) {
        Write-Host "      API key is required!" -ForegroundColor Red
        $apiKey = Read-Host "    Enter your API key"
    }
    
    Write-Host ""
    
    # GitHub Token
    Write-Host "  GitHub Configuration:" -ForegroundColor White
    $githubToken = Read-Host "    Enter GitHub token (or press Enter to skip)"
    if ([string]::IsNullOrWhiteSpace($githubToken)) {
        $githubToken = "dummy_token_for_local_testing"
        Write-Host "      Using dummy token (PR creation will be skipped)" -ForegroundColor Gray
    }
    
    Write-Host ""
    
    # Project Path
    Write-Host "  Project Configuration:" -ForegroundColor White
    $repoPath = Read-Host "    Enter project path to test (or press Enter for current dir)"
    if ([string]::IsNullOrWhiteSpace($repoPath)) {
        $repoPath = Get-Location
    }
    # Convert to forward slashes
    $repoPath = $repoPath -replace '\\', '/'
    
    Write-Host ""
    
    # Test Configuration
    Write-Host "  Test Configuration:" -ForegroundColor White
    $autoStart = Get-InputWithDefault "    Auto-start application? (true/false)" "true"
    $testTypes = Get-InputWithDefault "    Test types (comma-separated)" "e2e,api"
    $maxIterations = Get-InputWithDefault "    Max fix iterations" "3"
    
    Write-Host ""
    
    # Create .env file
    Write-Host "  Creating .env file..." -ForegroundColor Cyan
    
    $envContent = @"
# IGNIS Test Agent - Local Configuration
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

# AI Provider
AI_PROVIDER=$provider
$($provider.ToUpper())_API_KEY=$apiKey

# GitHub
GITHUB_TOKEN=$githubToken

# Project
REPO_PATH=$repoPath

# Testing
AUTO_START_APP=$autoStart
TEST_TYPES=$testTypes
MAX_ITERATIONS=$maxIterations

# Features
ENABLE_BACKEND_VALIDATION=true
ENABLE_BEST_PRACTICES_CHECK=true
GENERATE_ANALYSIS_REPORT=true

# Output
REPORT_OUTPUT_DIR=reports
LOG_LEVEL=info
LOG_DIR=logs
"@
    
    $envContent | Out-File -FilePath ".env" -Encoding UTF8
    Write-Host "  [✓] Configuration saved to .env" -ForegroundColor Green
}

Write-Host ""

# Step 5: Validate setup
Write-Host "Step 5: Validating setup..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path "scripts\validate-setup.js") {
    npm run validate
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [✗] Validation failed" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Please check your configuration and try again." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  Validation script not found, skipping..." -ForegroundColor Gray
}

Write-Host ""

# Step 6: Ready to run
Write-Host "==================================================" -ForegroundColor Green
Write-Host "   Setup Complete! Ready to run IGNIS Agent       " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Configuration:" -ForegroundColor White
Write-Host "  • Project: $(if (Test-Path .env) { (Get-Content .env | Select-String 'REPO_PATH=' | ForEach-Object { $_ -replace 'REPO_PATH=', '' }) } else { 'Not configured' })" -ForegroundColor Gray
Write-Host "  • AI Provider: $(if (Test-Path .env) { (Get-Content .env | Select-String 'AI_PROVIDER=' | ForEach-Object { $_ -replace 'AI_PROVIDER=', '' }) } else { 'Not configured' })" -ForegroundColor Gray
Write-Host ""

Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Review .env file: notepad .env" -ForegroundColor Cyan
Write-Host "  2. Run the agent: npm run cli" -ForegroundColor Cyan
Write-Host "  3. Check results in: reports/ and generated-tests/" -ForegroundColor Cyan
Write-Host ""

$runNow = Read-Host "Do you want to run IGNIS now? (y/N)"
if ($runNow -eq "y" -or $runNow -eq "Y") {
    Write-Host ""
    Write-Host "Starting IGNIS Agent..." -ForegroundColor Green
    Write-Host ""
    npm run cli
} else {
    Write-Host ""
    Write-Host "Setup complete! Run 'npm run cli' when ready." -ForegroundColor Green
    Write-Host ""
}
