'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ReportGenerator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate comprehensive analysis and fixes report
   */
  async generateComprehensiveReport(workDir, runData) {
    const timestamp = new Date();
    const reportDir = path.join(workDir, this.config.agent.reportOutputDir);
    
    // Create reports directory
    fs.mkdirSync(reportDir, { recursive: true });

    const reportFileName = `analysis-report-${timestamp.toISOString().replace(/[:.]/g, '-')}.md`;
    const reportPath = path.join(reportDir, reportFileName);

    logger.info(`Generating comprehensive report: ${reportFileName}`);

    const reportContent = this._buildReportContent(runData, timestamp);

    // Write report
    fs.writeFileSync(reportPath, reportContent, 'utf-8');

    // Also generate JSON version for programmatic access
    const jsonReportPath = path.join(reportDir, reportFileName.replace('.md', '.json'));
    fs.writeFileSync(jsonReportPath, JSON.stringify(runData, null, 2), 'utf-8');

    logger.info(`Report generated: ${reportPath}`);

    return {
      reportPath,
      jsonReportPath,
      fileName: reportFileName
    };
  }

  /**
   * Build markdown report content
   */
  _buildReportContent(runData, timestamp) {
    const sections = [];

    // Header
    sections.push(this._buildHeader(runData, timestamp));

    // Executive Summary
    sections.push(this._buildExecutiveSummary(runData));

    // Analysis Overview
    sections.push(this._buildAnalysisOverview(runData));

    // Backend Validation Results
    if (runData.backendValidation) {
      sections.push(this._buildBackendValidationSection(runData.backendValidation));
    }

    // Best Practices Validation
    if (runData.bestPracticesValidation) {
      sections.push(this._buildBestPracticesSection(runData.bestPracticesValidation));
    }

    // Security Issues
    sections.push(this._buildSecuritySection(runData));

    // Performance Concerns
    sections.push(this._buildPerformanceSection(runData));

    // Code Quality Metrics
    sections.push(this._buildCodeQualitySection(runData));

    // Test Results
    if (runData.testResults) {
      sections.push(this._buildTestResultsSection(runData.testResults));
    }

    // Fixes Applied
    if (runData.fixesApplied) {
      sections.push(this._buildFixesSection(runData.fixesApplied));
    }

    // Pull Requests Created
    if (runData.pullRequests) {
      sections.push(this._buildPullRequestsSection(runData.pullRequests));
    }

    // Root Cause Analysis
    sections.push(this._buildRootCauseAnalysis(runData));

    // Recommendations
    sections.push(this._buildRecommendations(runData));

    // Footer
    sections.push(this._buildFooter(runData, timestamp));

    return sections.join('\n\n---\n\n');
  }

  /**
   * Build report header
   */
  _buildHeader(runData, timestamp) {
    return `# IGNIS Automation Test Agent - Analysis Report

**Run ID:** ${runData.runId}  
**Generated:** ${timestamp.toISOString()}  
**Date:** ${timestamp.toLocaleDateString()} ${timestamp.toLocaleTimeString()}  
**Repository:** ${runData.repository || 'N/A'}  
**Branch:** ${runData.branch || 'main'}  
**Agent Version:** ${runData.agentVersion || '1.0.0'}  `;
  }

  /**
   * Build executive summary
   */
  _buildExecutiveSummary(runData) {
    const totalIssues = this._getTotalIssues(runData);
    const criticalCount = this._getIssueCountBySeverity(runData, 'critical');
    const highCount = this._getIssueCountBySeverity(runData, 'high');
    const fixesApplied = runData.fixesApplied?.applied?.length || 0;

    let status = '✅ Success';
    if (criticalCount > 0) {
      status = '🔴 Critical Issues Found';
    } else if (highCount > 0) {
      status = '⚠️ High Priority Issues Found';
    } else if (totalIssues > 0) {
      status = '⚡ Issues Found';
    }

    return `## Executive Summary

**Status:** ${status}

**Analysis Results:**
- Total Issues Found: **${totalIssues}**
- Critical: **${criticalCount}**
- High Priority: **${highCount}**
- Medium Priority: **${this._getIssueCountBySeverity(runData, 'medium')}**
- Low Priority: **${this._getIssueCountBySeverity(runData, 'low')}**
- Informational: **${this._getIssueCountBySeverity(runData, 'info')}**

**Fixes Applied:** ${fixesApplied}  
**Test Success Rate:** ${this._getTestSuccessRate(runData)}%  
**Execution Time:** ${this._formatDuration(runData.duration)}  `;
  }

  /**
   * Build analysis overview
   */
  _buildAnalysisOverview(runData) {
    return `## Analysis Overview

### Scope
- **Backend Files Analyzed:** ${runData.backendValidation?.validatedFiles || 0}
- **Frontend Files Analyzed:** ${runData.codeAnalysis?.stats?.totalFiles || 0}
- **Endpoints Validated:** ${runData.backendValidation?.validatedEndpoints || 0}
- **Test Cases Generated:** ${runData.testResults?.total || 0}

### Configuration
- **AI Provider:** ${runData.aiProvider || 'N/A'}
- **Max Iterations:** ${runData.maxIterations || 'N/A'}
- **Actual Iterations:** ${runData.actualIterations || 'N/A'}
- **Test Types:** ${runData.testTypes?.join(', ') || 'N/A'}`;
  }

  /**
   * Build backend validation section
   */
  _buildBackendValidationSection(backendValidation) {
    let content = `## Backend Validation Results

### Summary
- Total Endpoints: **${backendValidation.totalEndpoints}**
- Validated Endpoints: **${backendValidation.validatedEndpoints}**
- Issues Found: **${backendValidation.issues?.length || 0}**

### Issues by Severity
`;

    const severityGroups = this._groupIssuesBySeverity(backendValidation.issues || []);
    
    for (const [severity, issues] of Object.entries(severityGroups)) {
      if (issues.length === 0) continue;
      
      content += `\n#### ${this._capitalizeFirst(severity)} (${issues.length})\n\n`;
      
      for (const issue of issues.slice(0, 10)) { // Limit to 10 per severity
        content += `**${issue.endpoint || issue.file}**\n`;
        content += `- **Category:** ${issue.category || 'General'}\n`;
        content += `- **Description:** ${issue.description}\n`;
        content += `- **Recommendation:** ${issue.recommendation || 'Review and fix'}\n`;
        if (issue.lineNumber) {
          content += `- **Location:** Line ${issue.lineNumber}\n`;
        }
        content += '\n';
      }
    }

    return content;
  }

  /**
   * Build best practices section
   */
  _buildBestPracticesSection(bestPracticesValidation) {
    let content = `## Best Practices Validation

### Summary
- Total Files Validated: **${bestPracticesValidation.validatedFiles}**
- Issues Found: **${bestPracticesValidation.issues?.length || 0}**

### Top Issues
`;

    const topIssues = (bestPracticesValidation.issues || [])
      .filter(i => ['critical', 'high'].includes(i.severity))
      .slice(0, 15);

    if (topIssues.length === 0) {
      content += '\n✅ No critical or high-priority best practice violations found.\n';
    } else {
      for (const issue of topIssues) {
        content += `\n**[${issue.severity.toUpperCase()}] ${issue.file}**\n`;
        content += `- **Issue:** ${issue.description}\n`;
        content += `- **Recommendation:** ${issue.recommendation}\n`;
        if (issue.rootCause) {
          content += `- **Root Cause:** ${issue.rootCause}\n`;
        }
        content += '\n';
      }
    }

    return content;
  }

  /**
   * Build security section
   */
  _buildSecuritySection(runData) {
    const securityIssues = this._extractSecurityIssues(runData);
    
    let content = `## Security Analysis

### Summary
- Security Issues Found: **${securityIssues.length}**
- Critical Security Issues: **${securityIssues.filter(i => i.severity === 'critical').length}**

`;

    if (securityIssues.length === 0) {
      content += '✅ No security vulnerabilities detected.\n';
    } else {
      content += '### Security Vulnerabilities\n\n';
      
      for (const issue of securityIssues.slice(0, 10)) {
        content += `**[${issue.severity.toUpperCase()}] ${issue.category || 'Security Issue'}**\n`;
        content += `- **File:** ${issue.file}\n`;
        content += `- **Description:** ${issue.description}\n`;
        content += `- **Impact:** ${issue.impact || 'Could compromise security'}\n`;
        content += `- **Remediation:** ${issue.recommendation}\n\n`;
      }
    }

    return content;
  }

  /**
   * Build performance section
   */
  _buildPerformanceSection(runData) {
    const performanceIssues = this._extractPerformanceIssues(runData);
    
    return `## Performance Analysis

### Summary
- Performance Issues: **${performanceIssues.length}**
- Optimization Opportunities: **${performanceIssues.filter(i => i.severity !== 'critical').length}**

${performanceIssues.length === 0 ? '✅ No significant performance issues detected.' : '### Performance Concerns\n\n' + performanceIssues.slice(0, 8).map(issue => 
  `**${issue.file}**\n- **Issue:** ${issue.description}\n- **Impact:** ${issue.impact || 'May affect performance'}\n- **Optimization:** ${issue.recommendation}\n`
).join('\n')}`;
  }

  /**
   * Build code quality section
   */
  _buildCodeQualitySection(runData) {
    const qualityScore = this._calculateQualityScore(runData);
    
    return `## Code Quality Metrics

### Overall Quality Score: ${qualityScore}/100

### Metrics
- **Code Duplication:** ${this._getMetric(runData, 'duplication', 'Low')}
- **Code Complexity:** ${this._getMetric(runData, 'complexity', 'Medium')}
- **Documentation:** ${this._getMetric(runData, 'documentation', 'Good')}
- **Test Coverage:** ${this._getMetric(runData, 'coverage', 'N/A')}
- **Maintainability:** ${this._getMetric(runData, 'maintainability', 'Good')}

${this._getQualityRecommendations(qualityScore)}`;
  }

  /**
   * Build test results section
   */
  _buildTestResultsSection(testResults) {
    const successRate = testResults.total > 0 
      ? ((testResults.passed / testResults.total) * 100).toFixed(1) 
      : 0;

    return `## Test Results

### Summary
- Total Tests: **${testResults.total}**
- Passed: **${testResults.passed}** ✅
- Failed: **${testResults.failed}** ❌
- Success Rate: **${successRate}%**

### Test Execution Details
${this._buildTestExecutionTable(testResults)}

${testResults.failed > 0 ? `### Failed Tests\n\n${this._buildFailedTestsList(testResults)}` : ''}`;
  }

  /**
   * Build fixes section
   */
  _buildFixesSection(fixesApplied) {
    return `## Fixes Applied

### Summary
- Total Fixes Applied: **${fixesApplied.applied?.length || 0}**
- App Code Fixes: **${fixesApplied.appFixes || 0}**
- Test Code Fixes: **${fixesApplied.testFixes || 0}**
- Reverted Fixes: **${fixesApplied.reverted?.length || 0}**

### Applied Fixes
${(fixesApplied.applied || []).slice(0, 20).map((fix, idx) => 
  `${idx + 1}. **${fix.file}**\n   - ${fix.explanation || fix.description || 'Code fix applied'}\n`
).join('\n')}

${fixesApplied.reverted?.length > 0 ? `### Reverted Fixes\n${fixesApplied.reverted.map(fix => 
  `- ${fix.file}: ${fix.reason}`
).join('\n')}` : ''}`;
  }

  /**
   * Build pull requests section
   */
  _buildPullRequestsSection(pullRequests) {
    return `## Pull Requests Created

${pullRequests.map(pr => 
  `### ${pr.title}
- **URL:** ${pr.url}
- **Branch:** ${pr.branch}
- **Status:** ${pr.state}
- **Files Changed:** ${pr.filesChanged || 'N/A'}
`).join('\n')}`;
  }

  /**
   * Build root cause analysis
   */
  _buildRootCauseAnalysis(runData) {
    const rootCauses = this._extractRootCauses(runData);
    
    return `## Root Cause Analysis

### Identified Root Causes

${rootCauses.length === 0 ? 'No specific root causes identified.' : rootCauses.map((rc, idx) => 
  `${idx + 1}. **${rc.category}**
   - **Description:** ${rc.description}
   - **Impact:** ${rc.impact}
   - **Resolution:** ${rc.resolution}
`).join('\n')}`;
  }

  /**
   * Build recommendations
   */
  _buildRecommendations(runData) {
    const recommendations = this._generateRecommendations(runData);
    
    return `## Recommendations

### Immediate Actions
${recommendations.immediate.map((rec, idx) => `${idx + 1}. ${rec}`).join('\n')}

### Short-term Improvements
${recommendations.shortTerm.map((rec, idx) => `${idx + 1}. ${rec}`).join('\n')}

### Long-term Enhancements
${recommendations.longTerm.map((rec, idx) => `${idx + 1}. ${rec}`).join('\n')}`;
  }

  /**
   * Build footer
   */
  _buildFooter(runData, timestamp) {
    return `## Report Metadata

- **Report Generated:** ${timestamp.toISOString()}
- **Run Duration:** ${this._formatDuration(runData.duration)}
- **Agent Run ID:** ${runData.runId}
- **Generated by:** IGNIS Automation Test Agent v${runData.agentVersion || '1.0.0'}

---

*This report was automatically generated by the IGNIS Automation Test Agent.*`;
  }

  // Helper methods
  _getTotalIssues(runData) {
    let total = 0;
    if (runData.backendValidation?.issues) total += runData.backendValidation.issues.length;
    if (runData.bestPracticesValidation?.issues) total += runData.bestPracticesValidation.issues.length;
    return total;
  }

  _getIssueCountBySeverity(runData, severity) {
    let count = 0;
    
    const allIssues = [
      ...(runData.backendValidation?.issues || []),
      ...(runData.bestPracticesValidation?.issues || [])
    ];
    
    return allIssues.filter(i => i.severity === severity).length;
  }

  _getTestSuccessRate(runData) {
    if (!runData.testResults || runData.testResults.total === 0) return 0;
    return ((runData.testResults.passed / runData.testResults.total) * 100).toFixed(1);
  }

  _formatDuration(ms) {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  _groupIssuesBySeverity(issues) {
    const groups = { critical: [], high: [], medium: [], low: [], info: [] };
    for (const issue of issues) {
      const severity = issue.severity || 'info';
      if (groups[severity]) groups[severity].push(issue);
    }
    return groups;
  }

  _capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  _extractSecurityIssues(runData) {
    const allIssues = [
      ...(runData.backendValidation?.issues || []),
      ...(runData.bestPracticesValidation?.issues || [])
    ];
    
    return allIssues.filter(issue => 
      issue.category?.toLowerCase().includes('security') ||
      issue.description?.toLowerCase().includes('security') ||
      issue.description?.toLowerCase().includes('vulnerability') ||
      issue.description?.toLowerCase().includes('injection') ||
      issue.description?.toLowerCase().includes('xss')
    );
  }

  _extractPerformanceIssues(runData) {
    const allIssues = [
      ...(runData.backendValidation?.issues || []),
      ...(runData.bestPracticesValidation?.issues || [])
    ];
    
    return allIssues.filter(issue => 
      issue.category?.toLowerCase().includes('performance') ||
      issue.description?.toLowerCase().includes('performance') ||
      issue.description?.toLowerCase().includes('optimization') ||
      issue.description?.toLowerCase().includes('slow')
    );
  }

  _calculateQualityScore(runData) {
    const totalIssues = this._getTotalIssues(runData);
    const criticalCount = this._getIssueCountBySeverity(runData, 'critical');
    const highCount = this._getIssueCountBySeverity(runData, 'high');
    
    let score = 100;
    score -= criticalCount * 10;
    score -= highCount * 5;
    score -= (totalIssues - criticalCount - highCount) * 2;
    
    return Math.max(0, Math.min(100, score));
  }

  _getMetric(runData, metric, defaultValue) {
    return runData.metrics?.[metric] || defaultValue;
  }

  _getQualityRecommendations(score) {
    if (score >= 90) return '✅ Excellent code quality!';
    if (score >= 75) return '⚡ Good code quality with minor improvements needed.';
    if (score >= 60) return '⚠️ Moderate code quality. Several improvements recommended.';
    return '🔴 Code quality needs significant improvement.';
  }

  _buildTestExecutionTable(testResults) {
    return `| Test Type | Total | Passed | Failed |
|-----------|-------|--------|--------|
| E2E | ${testResults.e2e?.total || 0} | ${testResults.e2e?.passed || 0} | ${testResults.e2e?.failed || 0} |
| API | ${testResults.api?.total || 0} | ${testResults.api?.passed || 0} | ${testResults.api?.failed || 0} |
| Visual | ${testResults.visual?.total || 0} | ${testResults.visual?.passed || 0} | ${testResults.visual?.failed || 0} |
| Accessibility | ${testResults.a11y?.total || 0} | ${testResults.a11y?.passed || 0} | ${testResults.a11y?.failed || 0} |
| Performance | ${testResults.perf?.total || 0} | ${testResults.perf?.passed || 0} | ${testResults.perf?.failed || 0} |`;
  }

  _buildFailedTestsList(testResults) {
    return (testResults.failures || []).slice(0, 10).map((failure, idx) => 
      `${idx + 1}. **${failure.test}**\n   - File: ${failure.file}\n   - Error: ${failure.error}\n`
    ).join('\n');
  }

  _extractRootCauses(runData) {
    // Extract root causes from various sources
    const rootCauses = [];
    
    if (runData.backendValidation?.issues) {
      const criticalIssues = runData.backendValidation.issues.filter(i => i.severity === 'critical');
      for (const issue of criticalIssues.slice(0, 5)) {
        if (issue.rootCause) {
          rootCauses.push({
            category: issue.category || 'Backend',
            description: issue.rootCause || issue.description,
            impact: 'Critical',
            resolution: issue.recommendation || 'Review and fix'
          });
        }
      }
    }
    
    return rootCauses;
  }

  _generateRecommendations(runData) {
    const recommendations = {
      immediate: [],
      shortTerm: [],
      longTerm: []
    };
    
    const criticalCount = this._getIssueCountBySeverity(runData, 'critical');
    const highCount = this._getIssueCountBySeverity(runData, 'high');
    
    if (criticalCount > 0) {
      recommendations.immediate.push(`Address ${criticalCount} critical security/functionality issues immediately`);
    }
    
    if (highCount > 0) {
      recommendations.immediate.push(`Fix ${highCount} high-priority issues within the next sprint`);
    }
    
    if (runData.testResults?.failed > 0) {
      recommendations.immediate.push(`Investigate and fix ${runData.testResults.failed} failing test(s)`);
    }
    
    recommendations.shortTerm.push('Implement automated testing in CI/CD pipeline');
    recommendations.shortTerm.push('Review and update API documentation');
    recommendations.shortTerm.push('Add comprehensive error handling across the application');
    
    recommendations.longTerm.push('Establish code review best practices');
    recommendations.longTerm.push('Implement comprehensive monitoring and alerting');
    recommendations.longTerm.push('Regular security audits and penetration testing');
    
    return recommendations;
  }
}

module.exports = ReportGenerator;
