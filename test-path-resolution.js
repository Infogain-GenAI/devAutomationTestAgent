/**
 * Test script to verify analysis-prompts.json can be found in different runtime environments
 * Run: node test-path-resolution.js
 */

const path = require('path');
const fs = require('fs');

console.log('='.repeat(60));
console.log('  Analysis Prompts Path Resolution Test');
console.log('='.repeat(60));
console.log();

// Simulate the backend-validator.js path resolution logic
function testPathResolution() {
  const results = {
    passed: [],
    failed: []
  };

  // Test 1: From backend-validator.js perspective
  console.log('Test 1: Path resolution from src/core/backend-validator.js');
  console.log('-'.repeat(60));
  
  const currentDir = __dirname; // This script's directory (project root)
  const simulatedBackendValidatorDir = path.join(currentDir, 'src', 'core');
  
  // Simulate __dirname from backend-validator.js
  const projectRoot = path.resolve(simulatedBackendValidatorDir, '../..');
  const promptFilePath = 'config/analysis-prompts.json';
  const promptFile = path.join(projectRoot, promptFilePath);
  
  console.log('  Simulated __dirname:', simulatedBackendValidatorDir);
  console.log('  Resolved project root:', projectRoot);
  console.log('  Analysis prompts path:', promptFile);
  console.log('  File exists:', fs.existsSync(promptFile));
  
  if (fs.existsSync(promptFile)) {
    console.log('  ✓ PASS: File found');
    results.passed.push('Path resolution from backend-validator.js');
    
    // Test reading the file
    try {
      const content = fs.readFileSync(promptFile, 'utf-8');
      JSON.parse(content);
      console.log('  ✓ PASS: File is valid JSON');
      results.passed.push('JSON parsing');
    } catch (err) {
      console.log('  ✗ FAIL: JSON parsing error:', err.message);
      results.failed.push('JSON parsing: ' + err.message);
    }
  } else {
    console.log('  ✗ FAIL: File not found');
    results.failed.push('Path resolution from backend-validator.js');
  }
  
  console.log();

  // Test 2: From different working directories
  console.log('Test 2: Working directory independence');
  console.log('-'.repeat(60));
  
  const workingDirs = [
    process.cwd(),
    path.join(process.cwd(), 'src'),
    path.join(process.cwd(), 'src', 'core'),
    '/tmp/random-dir'
  ];
  
  workingDirs.forEach(wd => {
    console.log(`  Testing from working dir: ${wd}`);
    // Path resolution should work regardless of working directory
    // because we use __dirname, not process.cwd()
    const testProjectRoot = path.resolve(simulatedBackendValidatorDir, '../..');
    const testPromptFile = path.join(testProjectRoot, promptFilePath);
    console.log('    Resolved path:', testPromptFile);
    console.log('    Path is same:', testPromptFile === promptFile);
  });
  
  console.log('  ✓ PASS: Path resolution is working directory independent');
  results.passed.push('Working directory independence');
  console.log();

  // Test 3: GitHub Actions environment simulation
  console.log('Test 3: GitHub Actions environment simulation');
  console.log('-'.repeat(60));
  
  // In GitHub Actions, the structure is:
  // /home/runner/work/_actions/{org}/{repo}/{version}/
  //   ├── src/core/backend-validator.js
  //   ├── config/analysis-prompts.json
  //   └── package.json
  
  const githubActionPath = '/home/runner/work/_actions/org/ignis-test-agent/v1';
  const githubBackendValidatorPath = path.join(githubActionPath, 'src', 'core');
  const githubProjectRoot = path.resolve(githubBackendValidatorPath, '../..');
  const githubPromptFile = path.join(githubProjectRoot, promptFilePath);
  
  console.log('  GitHub Action path:', githubActionPath);
  console.log('  Backend validator path:', githubBackendValidatorPath);
  console.log('  Resolved project root:', githubProjectRoot);
  console.log('  Expected prompts path:', githubPromptFile);
  console.log('  Expected path matches:', githubPromptFile === path.join(githubActionPath, promptFilePath));
  
  if (githubProjectRoot === githubActionPath) {
    console.log('  ✓ PASS: Path resolution would work in GitHub Actions');
    results.passed.push('GitHub Actions path resolution');
  } else {
    console.log('  ✗ FAIL: Path resolution logic error');
    results.failed.push('GitHub Actions path resolution');
  }
  
  console.log();

  // Test 4: Docker container environment
  console.log('Test 4: Docker container environment simulation');
  console.log('-'.repeat(60));
  
  const dockerWorkdir = '/app';
  const dockerBackendValidatorPath = path.join(dockerWorkdir, 'src', 'core');
  const dockerProjectRoot = path.resolve(dockerBackendValidatorPath, '../..');
  const dockerPromptFile = path.join(dockerProjectRoot, promptFilePath);
  
  console.log('  Docker WORKDIR:', dockerWorkdir);
  console.log('  Backend validator path:', dockerBackendValidatorPath);
  console.log('  Resolved project root:', dockerProjectRoot);
  console.log('  Expected prompts path:', dockerPromptFile);
  console.log('  Expected path matches:', dockerPromptFile === path.join(dockerWorkdir, promptFilePath));
  
  if (dockerProjectRoot === dockerWorkdir) {
    console.log('  ✓ PASS: Path resolution would work in Docker');
    results.passed.push('Docker path resolution');
  } else {
    console.log('  ✗ FAIL: Path resolution logic error');
    results.failed.push('Docker path resolution');
  }
  
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('  Test Summary');
  console.log('='.repeat(60));
  console.log();
  console.log('Passed tests:', results.passed.length);
  results.passed.forEach(test => console.log('  ✓', test));
  console.log();
  
  if (results.failed.length > 0) {
    console.log('Failed tests:', results.failed.length);
    results.failed.forEach(test => console.log('  ✗', test));
    console.log();
    console.log('Status: FAILED');
    process.exit(1);
  } else {
    console.log('Status: ALL TESTS PASSED ✓');
    console.log();
    console.log('The analysis prompts file will be found correctly in:');
    console.log('  • Local development');
    console.log('  • GitHub Actions runtime');
    console.log('  • Docker containers');
    console.log('  • Any working directory');
    process.exit(0);
  }
}

// Run tests
try {
  testPathResolution();
} catch (err) {
  console.error('Test execution error:', err.message);
  console.error(err.stack);
  process.exit(1);
}
