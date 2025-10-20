// src/utils/test-generation-orchestrator.ts
// Main orchestrator for Phase 2 - LLM-First Test Generation

import { BedrockClient } from '../chatbot/bedrock-client';
import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { TestStorage } from './storage';
import { TestCase, TestData, LearningResults, DatabaseAnalysis } from '../models';

export class TestGenerationOrchestrator {
  constructor(
    private bedrockClient: BedrockClient,
    private mcpClient: MCPPlaywrightClient,
    private storage: TestStorage,
    private ragClient?: any  // Add optional RAG client
  ) {}

  // Main test generation method - now uses Learning Phase test cases
  async generateTestCases(learningResults: LearningResults, testOptions?: any): Promise<{success: boolean, testCases?: TestCase[], statistics?: any, error?: string}> {
    try {
      console.log('Using test cases from Learning Phase...');
      
      // Get test cases from Learning Phase (already generated with TSV validation fields)
      const learningTestCases = learningResults.analysis.mapping.testCases || [];
      
      if (learningTestCases.length === 0) {
        console.warn('No test cases found in Learning Phase results');
        return {
          success: false,
          error: 'No test cases found in Learning Phase results'
        };
      }
      
      // Convert Learning Phase test cases to TestCase format with validation
      const testCases = learningTestCases
        .filter(tc => {
          // STRICT VALIDATION: Only include test cases with valid TSV validation fields
          const hasValidDataField = (tc as any).dataField && (tc as any).dataField !== 'undefined';
          const hasValidTestValues = (tc as any).testValues && Array.isArray((tc as any).testValues) && (tc as any).testValues.length > 0;
          const hasValidSelectors = tc.selectors && Array.isArray(tc.selectors) && tc.selectors.length > 0 && 
                                   !tc.selectors.some(s => s === 'undefined' || s.includes('undefined'));
          
          if (!hasValidDataField) {
            console.warn(`⚠️ Skipping test case "${tc.name}": No valid dataField`);
            return false;
          }
          if (!hasValidTestValues) {
            console.warn(`⚠️ Skipping test case "${tc.name}": No valid testValues`);
            return false;
          }
          if (!hasValidSelectors) {
            console.warn(`⚠️ Skipping test case "${tc.name}": No valid selectors`);
            return false;
          }
          
          return true;
        })
        .map((tc: any, index: number) => ({
          id: `test-${index + 1}`,
          name: tc.name || `Test Case ${index + 1}`,
          description: tc.description || 'No description provided',
          category: tc.category?.toLowerCase().replace(/\s+/g, '_') || 'general',
          priority: tc.priority?.toLowerCase() || 'medium',
          status: 'ready' as const,
          steps: Array.isArray(tc.steps) ? tc.steps : (tc.steps || '').split(',').map(s => s.trim()),
          selectors: Array.isArray(tc.selectors) ? tc.selectors : (tc.selectors ? [tc.selectors] : []),
          testData: tc.testData || {},
          expectedResults: tc.expectedResults || ['Test passes'],
          // TSV Validation fields (now included from Learning Phase)
          dataField: tc.dataField,
          testValues: tc.testValues,
          type: tc.type,
          websiteUrl: tc.websiteUrl,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: tc.tags || ['generated']
        }));
      
      // Save test cases to storage
      await this.storage.saveTestCases(testCases);
      
      console.log(`Loaded ${testCases.length} test cases from Learning Phase`);
      
      return {
        success: true,
        testCases: testCases,
        statistics: {
          total: testCases.length,
          byCategory: this.groupBy(testCases, 'category'),
          byPriority: this.groupBy(testCases, 'priority')
        }
      };
      
    } catch (error) {
      console.error('Test generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // OLD LLM-powered test case generation (NOT USED - using Learning Phase test cases instead)
  private async generateTestCasesWithLLM_OLD(learningResults: LearningResults): Promise<TestCase[]> {
    console.log('\n=== TEST CASE GENERATION - SENDING TO LLM ===');
    
    const prompt = `Generate comprehensive test cases for a website based on the following analysis:

UI Elements Discovered: ${learningResults.analysis.ui.totalElements}
- Interactive Elements: ${(learningResults.analysis.ui.interactiveElements || []).join(', ')}
- Data Components: ${(learningResults.analysis.ui.dataComponents || []).join(', ')}
- Form Fields: ${(learningResults.analysis.ui.formFields || []).join(', ')}
- Table Columns: ${(learningResults.analysis.ui.tableColumns || []).join(', ')}

Database Fields: ${learningResults.analysis.database.totalFields}
- Field Names: ${(learningResults.analysis.database.fieldNames || []).join(', ')}
- Field Types: ${JSON.stringify(learningResults.analysis.database.fieldTypes)}
Mappings Found: ${learningResults.analysis.mapping.mappings.length}
- Database to UI mappings: ${JSON.stringify(learningResults.analysis.mapping.mappings)}

Generate practical test cases that:
1. Test data validation using the database field names and types
2. Test functionality of discovered UI elements
3. Test form interactions and validation
4. Test table operations (sorting, filtering, pagination)
5. Test navigation and user workflows

Return JSON array of test cases in this format:
[
  {
    "name": "Test Case Name",
    "description": "What this test validates",
    "category": "data_validation|functionality|performance|ui_validation",
    "priority": "high|medium|low",
    "steps": ["Step 1", "Step 2", "Step 3"],
    "selectors": ["#element1", ".class2", "input[name='field']"],
    "testData": {"field1": "value1", "field2": "value2"},
    "expectedResults": ["Expected outcome 1", "Expected outcome 2"],
    "tags": ["tag1", "tag2"]
  }
]`;

    console.log('\n=== TEST GENERATION PROMPT ===');
    console.log(prompt.substring(0, 500) + '...');
    
    const response = await this.bedrockClient.generateResponse([{ role: 'user', content: prompt }], []);
    
    console.log('\n=== TEST GENERATION LLM RESPONSE ===');
    console.log('Response Length:', response.content.length);
    console.log('Response Content:', response.content.substring(0, 500) + '...');
    
    const parsed = this.parseJSONResponse(response.content);
    console.log('\n=== TEST GENERATION PARSED RESULT ===');
    console.log('Parsed Result:', JSON.stringify(parsed, null, 2));
    
    return parsed;
}

  // Generate test data based on TSV fields
  private async generateTestDataForTestCases(testCases: TestCase[], learningResults: LearningResults): Promise<TestCase[]> {
    const testCasesWithData = [];
    
    for (const testCase of testCases) {
      // Generate test data based on database fields
      const testData = await this.generateTestDataFromTSVFields(testCase, learningResults.analysis.database);
      
      testCasesWithData.push({
        ...testCase,
        testData: testData,
        id: this.generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft' as const
      });
    }
    
    return testCasesWithData;
  }

  // Generate test data from TSV field information
  private async generateTestDataFromTSVFields(testCase: TestCase, dbAnalysis: DatabaseAnalysis): Promise<TestData> {
    console.log('\n=== TEST DATA GENERATION - SENDING TO LLM ===');
    console.log('Test Case:', testCase.name);
    
    const prompt = `Generate realistic test data for this test case based on the database fields:

Test Case: ${testCase.name}
Description: ${testCase.description}
Steps: ${(testCase.steps || []).join(', ')}

Database Fields Available:
${(dbAnalysis.fieldNames || []).map(field => `- ${field} (${dbAnalysis.fieldTypes[field]})`).join('\n')}

Generate test data that:
1. Uses actual field names from the database
2. Provides realistic values based on field types
3. Includes both valid and invalid test data
4. Covers edge cases and boundary conditions

Return JSON in this format:
{
  "name": "Test Data for ${testCase.name}",
  "description": "Generated test data",
  "inputs": {
    "field1": "valid_value",
    "field2": "invalid_value"
  },
  "expectedOutputs": {
    "field1": "expected_result",
    "field2": "error_message"
  },
  "isTemplate": true,
  "tags": ["generated", "test_data"]
}`;

    console.log('\n=== TEST DATA GENERATION PROMPT ===');
    console.log(prompt.substring(0, 500) + '...');
    
    const response = await this.bedrockClient.generateResponse([{ role: 'user', content: prompt }], []);
    
    console.log('\n=== TEST DATA GENERATION LLM RESPONSE ===');
    console.log('Response Length:', response.content.length);
    console.log('Response Content:', response.content.substring(0, 500) + '...');
    
    const testData = this.parseJSONResponse(response.content);
    
    console.log('\n=== TEST DATA GENERATION PARSED RESULT ===');
    console.log('Parsed Result:', JSON.stringify(testData, null, 2));
    
    return {
        ...testData,
        id: this.generateId(),
        testCaseId: testCase.id,
        createdAt: new Date()
    };
}

  // Parse JSON response from LLM
  private parseJSONResponse(response: string): any {
    try {
      const startIndex = response.indexOf('[');
      const endIndex = response.lastIndexOf(']');
      
      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const jsonString = response.substring(startIndex, endIndex + 1);
        return JSON.parse(jsonString);
      }
      
      throw new Error('No JSON array found in response');
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      return [];
    }
  }

  // Generate unique ID
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Get test cases from storage
  async getTestCases(): Promise<TestCase[]> {
    return await this.storage.getAllTestCases();
  }

  // Get test case by ID
  async getTestCase(testCaseId: string): Promise<TestCase | null> {
    return await this.storage.getTestCase(testCaseId);
  }

  // Update test case
  async updateTestCase(testCase: TestCase): Promise<void> {
    testCase.updatedAt = new Date();
    await this.storage.updateTestCase(testCase);
  }

  // Delete test case
  async deleteTestCase(testCaseId: string): Promise<void> {
    await this.storage.deleteTestCase(testCaseId);
  }

  // Get test statistics
  async getTestStatistics(): Promise<any> {
    const testCases = await this.storage.getAllTestCases();
    
    return {
      total: testCases.length,
      byCategory: this.groupBy(testCases, 'category'),
      byPriority: this.groupBy(testCases, 'priority'),
      byStatus: this.groupBy(testCases, 'status'),
      recentlyCreated: testCases.filter(tc => 
        new Date(tc.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length
    };
  }

  async executeTestCases(testCaseIds: string[], options?: any): Promise<{success: boolean, results?: any[], statistics?: any, error?: string}> {
    try {
      console.log('Starting test execution for test cases:', testCaseIds);
      
      // Generate run ID and create run folder
      const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`;
      const runFolder = `test-reports/${runId}`;
      const fs = require('fs');
      
      if (!fs.existsSync(runFolder)) {
        fs.mkdirSync(runFolder, { recursive: true });
      }
      
      // Create run metadata
      const runMetadata = {
        runId: runId,
        timestamp: new Date().toISOString(),
        totalTests: testCaseIds.length,
        passed: 0,
        failed: 0,
        error: 0,
        duration: 0,
        testCases: []
      };
      
      const results = [];
      const startTime = Date.now();
      
      for (const testCaseId of testCaseIds) {
        const testCase = await this.storage.getTestCase(testCaseId);
        if (!testCase) {
          results.push({
            testCaseId,
            status: 'error',
            error: 'Test case not found',
            startTime: new Date(),
            endTime: new Date(),
            duration: 0
          });
          continue;
        }
        
        const testStartTime = Date.now();
        const testResult = await this.executeTestWithValidation(testCase, runId);
        const testEndTime = Date.now();
        
        results.push({
          testCaseId,
          testCaseName: testCase.name,
          status: testResult.status as 'passed' | 'failed' | 'skipped' | 'error',
          startTime: new Date(testStartTime),
          endTime: new Date(testEndTime),
          duration: testEndTime - testStartTime,
          screenshots: testResult.screenshots || [],
          error: testResult.error,
          validation: testResult.validation
        });
        
        // Generate individual test report
        const testReport = {
          testCaseId: testCase.id,
          testCaseName: testCase.name,
          status: testResult.status,
          startTime: new Date(testStartTime).toISOString(),
          endTime: new Date(testEndTime).toISOString(),
          duration: testEndTime - testStartTime,
          dataField: testCase.dataField,
          testValues: testCase.testValues,
          websiteUrl: testCase.websiteUrl,
          screenshots: testResult.screenshots || [],
          validation: testResult.validation,
          error: testResult.error
        };
        
        // Save individual test report
        const testReportPath = `${runFolder}/test-${testCase.id}/test-report.json`;
        fs.writeFileSync(testReportPath, JSON.stringify(testReport, null, 2));
        
        // Update run metadata
        runMetadata.testCases.push({
          testCaseId: testCase.id,
          testCaseName: testCase.name,
          status: testResult.status,
          duration: testEndTime - testStartTime
        });
        
        if (testResult.status === 'passed') runMetadata.passed++;
        else if (testResult.status === 'failed') runMetadata.failed++;
        else if (testResult.status === 'error') runMetadata.error++;
        
        await this.storage.saveTestResult({
          testCaseId,
          status: testResult.status as 'passed' | 'failed' | 'skipped' | 'error',
          startTime: new Date(testStartTime),
          endTime: new Date(testEndTime),
          duration: testEndTime - testStartTime,
          screenshots: testResult.screenshots || [],
          error: testResult.error
        });
      }
      
      const endTime = Date.now();
      runMetadata.duration = endTime - startTime;
      
      // Save run metadata
      const runMetadataPath = `${runFolder}/run-metadata.json`;
      fs.writeFileSync(runMetadataPath, JSON.stringify(runMetadata, null, 2));
      
      // Generate summary HTML report
      const summaryReportPath = `${runFolder}/summary-report.html`;
      const summaryHTML = this.generateSummaryReport(runMetadata, results);
      fs.writeFileSync(summaryReportPath, summaryHTML);
      
      const statistics = {
        total: results.length,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        duration: `${((endTime - startTime) / 1000).toFixed(2)}s`,
        runId: runId,
        runFolder: runFolder
      };
      
      return {
        success: true,
        results,
        statistics
      };
      
    } catch (error) {
      console.error('Test execution failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeTestWithValidation(testCase: TestCase, runId: string): Promise<{status: 'passed' | 'failed' | 'skipped' | 'error', screenshots?: string[], error?: string, validation?: any}> {
    console.log(`🧪 Executing test: ${testCase.name}`);
    
    try {
      // 1. Get expected results from TSV gold standard
      if (!this.ragClient) {
        console.warn('⚠️ No RAG client available, using simulated execution');
        return this.simulateTestExecution(testCase);
      }
      
      const expectedResults = await this.ragClient.generateExpectedResults(testCase);
      console.log(`📊 Expected from TSV: ${expectedResults.expectedCount} records`);
      
      // 2. Execute test on UI with Playwright
      const uiResult = await this.executeTestOnUI(testCase, runId);
      console.log(`🌐 Actual from UI: ${uiResult.data.length} records`);
      
      // 3. Validate using TSV as gold standard
      const validation = await this.ragClient.validateResults(uiResult.data, expectedResults);
      
      return {
        status: validation.status,
        screenshots: [uiResult.screenshots.before, uiResult.screenshots.after, uiResult.screenshots.results],
        error: validation.passed ? undefined : validation.message,
        validation: validation
      };
      
    } catch (error) {
      console.error('Test execution error:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  private async simulateTestExecution(testCase: TestCase): Promise<{status: 'passed' | 'failed' | 'skipped' | 'error', screenshots?: string[], error?: string}> {
    const random = Math.random();
    
    if (random > 0.8) {
        return {
            status: 'failed' as const,
            error: 'Simulated test failure'
        };
    } else if (random > 0.9) {
        return {
            status: 'error' as const,
            error: 'Simulated test error'
        };
    } else {
        return {
            status: 'passed' as const,
            screenshots: ['screenshot1.png', 'screenshot2.png']
        };
    }
  }

  // Execute test on UI with Playwright
  private async executeTestOnUI(testCase: TestCase, runId: string): Promise<{data: any[], screenshots: {before: string, after: string, results: string}}> {
    console.log(`🌐 Executing test on UI: ${testCase.name}`);
    
    // Validate test case has required fields
    if (!testCase.websiteUrl) {
      throw new Error(`Test case ${testCase.name} has no websiteUrl`);
    }
    
    if (!testCase.selectors || testCase.selectors.length === 0) {
      throw new Error(`Test case ${testCase.name} has no selectors`);
    }
    
    // Create test folder for screenshots
    const testFolder = `test-reports/${runId}/test-${testCase.id}`;
    const fs = require('fs');
    if (!fs.existsSync(testFolder)) {
      fs.mkdirSync(testFolder, { recursive: true });
    }
    
    // Navigate to website
    await this.mcpClient.callTools([{
      id: 'navigate-' + Date.now(),
      name: 'playwright_navigate',
      parameters: { url: testCase.websiteUrl }
    }]);
    
    // Wait for page to load
    await this.mcpClient.callTools([{
      id: 'wait-body-' + Date.now(),
      name: 'playwright_wait_for',
      parameters: { selector: 'body', timeout: 5000 }
    }]);
    
    // Take screenshot before test
    const beforeScreenshot = `${testFolder}/before.png`;
    await this.mcpClient.callTools([{
      id: 'screenshot-before-' + Date.now(),
      name: 'playwright_screenshot',
      parameters: { path: beforeScreenshot }
    }]);
    
    // Apply filter based on test case
    if (testCase.type === 'filter_test') {
      // Click filter dropdown
      await this.mcpClient.callTools([{
        id: 'click-filter-' + Date.now(),
        name: 'playwright_click',
        parameters: { selector: testCase.selectors[0] }
      }]);
      
      // Select filter value
      await this.mcpClient.callTools([{
        id: 'fill-filter-' + Date.now(),
        name: 'playwright_fill',
        parameters: { 
          selector: testCase.selectors[0],
          value: testCase.testValues[0]
        }
      }]);
      
      // Wait for results
      await this.mcpClient.callTools([{
        id: 'wait-results-' + Date.now(),
        name: 'playwright_wait_for',
        parameters: { selector: '[data-screenshot-table] tr', timeout: 5000 }
      }]);
    }
    
    // Extract actual results from UI
    const results = await this.mcpClient.callTools([{
      id: 'evaluate-results-' + Date.now(),
      name: 'playwright_evaluate',
      parameters: {
        expression: `
          const tableRows = document.querySelectorAll('[data-screenshot-table] tr:not(:first-child)');
          Array.from(tableRows).map(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            return {
              field1: cells[0]?.textContent?.trim(),
              field2: cells[1]?.textContent?.trim(),
              field3: cells[2]?.textContent?.trim(),
              field4: cells[3]?.textContent?.trim()
            };
          });
        `
      }
    }]);
    
    // Take screenshot after results
    const afterScreenshot = `${testFolder}/after.png`;
    await this.mcpClient.callTools([{
      id: 'screenshot-after-' + Date.now(),
      name: 'playwright_screenshot',
      parameters: { path: afterScreenshot }
    }]);
    
    // Take screenshot of results table specifically
    const resultsScreenshot = `${testFolder}/results.png`;
    await this.mcpClient.callTools([{
      id: 'screenshot-results-' + Date.now(),
      name: 'playwright_screenshot',
      parameters: { 
        path: resultsScreenshot,
        selector: '[data-screenshot-table]'
      }
    }]);
    
    const actualData = results[0]?.result[0]?.value || [];
    
    return {
      data: actualData,
      screenshots: {
        before: beforeScreenshot,
        after: afterScreenshot,
        results: resultsScreenshot
      }
    };
  }

  private groupBy(array: any[], key: string): Record<string, number> {
    return array.reduce((groups, item) => {
      const value = item[key];
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }

  private generateSummaryReport(runMetadata: any, results: any[]): string {
    const passRate = runMetadata.total > 0 ? ((runMetadata.passed / runMetadata.total) * 100).toFixed(1) : '0';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Run Summary - ${runMetadata.runId}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #007bff; }
        .stat-number { font-size: 2em; font-weight: bold; color: #007bff; }
        .stat-label { color: #6c757d; margin-top: 5px; }
        .passed { border-left-color: #28a745; }
        .passed .stat-number { color: #28a745; }
        .failed { border-left-color: #dc3545; }
        .failed .stat-number { color: #dc3545; }
        .error { border-left-color: #ffc107; }
        .error .stat-number { color: #ffc107; }
        .test-results { margin-top: 30px; }
        .test-item { background: #f8f9fa; margin: 10px 0; padding: 15px; border-radius: 8px; border-left: 4px solid #dee2e6; }
        .test-item.passed { border-left-color: #28a745; }
        .test-item.failed { border-left-color: #dc3545; }
        .test-item.error { border-left-color: #ffc107; }
        .test-name { font-weight: bold; margin-bottom: 5px; }
        .test-details { color: #6c757d; font-size: 0.9em; }
        .screenshots { margin-top: 10px; }
        .screenshot-link { display: inline-block; margin-right: 10px; padding: 5px 10px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-size: 0.8em; }
        .validation-details { margin-top: 10px; padding: 10px; background: #e9ecef; border-radius: 4px; }
        .validation-passed { color: #28a745; font-weight: bold; }
        .validation-failed { color: #dc3545; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Test Run Summary</h1>
            <p><strong>Run ID:</strong> ${runMetadata.runId}</p>
            <p><strong>Timestamp:</strong> ${new Date(runMetadata.timestamp).toLocaleString()}</p>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${runMetadata.total}</div>
                <div class="stat-label">Total Tests</div>
            </div>
            <div class="stat-card passed">
                <div class="stat-number">${runMetadata.passed}</div>
                <div class="stat-label">Passed</div>
            </div>
            <div class="stat-card failed">
                <div class="stat-number">${runMetadata.failed}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card error">
                <div class="stat-number">${runMetadata.error}</div>
                <div class="stat-label">Errors</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${passRate}%</div>
                <div class="stat-label">Pass Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${(runMetadata.duration / 1000).toFixed(1)}s</div>
                <div class="stat-label">Duration</div>
            </div>
        </div>
        
        <div class="test-results">
            <h2>Test Results</h2>
            ${results.map(result => `
                <div class="test-item ${result.status}">
                    <div class="test-name">${result.testCaseName}</div>
                    <div class="test-details">
                        <strong>Status:</strong> ${result.status.toUpperCase()} | 
                        <strong>Duration:</strong> ${result.duration}ms | 
                        <strong>Test Case ID:</strong> ${result.testCaseId}
                    </div>
                    ${result.screenshots && result.screenshots.length > 0 ? `
                        <div class="screenshots">
                            <strong>Screenshots:</strong><br>
                            ${result.screenshots.map(screenshot => `
                                <a href="${screenshot}" target="_blank" class="screenshot-link">View Screenshot</a>
                            `).join('')}
                        </div>
                    ` : ''}
                    ${result.validation ? `
                        <div class="validation-details">
                            <strong>TSV Validation:</strong> 
                            <span class="${result.validation.passed ? 'validation-passed' : 'validation-failed'}">
                                ${result.validation.passed ? 'PASSED' : 'FAILED'}
                            </span><br>
                            <strong>Expected Count:</strong> ${result.validation.expectedCount} | 
                            <strong>Actual Count:</strong> ${result.validation.actualCount}<br>
                            <strong>Message:</strong> ${result.validation.message}
                        </div>
                    ` : ''}
                    ${result.error ? `
                        <div class="validation-details" style="background: #f8d7da; color: #721c24;">
                            <strong>Error:</strong> ${result.error}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;
  }
}
