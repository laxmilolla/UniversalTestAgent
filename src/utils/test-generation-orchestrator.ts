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
    private playwrightLearningOrchestrator: any  // Get RAG client dynamically from this
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
    console.log(`🔍 executeTestCases called with ${testCaseIds.length} test cases`);
    
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
        console.log(`🔍 Calling executeTestWithValidation for test: ${testCase.name}`);
        console.log(`🚨 ABOUT TO CALL: executeTestWithValidation for test: ${testCase.name}`);
        console.log(`🚨 PARAMS CHECK: testCase=${JSON.stringify(testCase?.name)}, runId=${runId}`);
        const testResult = await this.executeTestWithValidation(testCase, runId);
        console.log(`🚨 AFTER CALL: executeTestWithValidation completed for test: ${testCase.name}`);
        console.log(`🔍 executeTestWithValidation completed for test: ${testCase.name}`);
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
    console.log(`🚨 FIRST LINE: executeTestWithValidation called for test: ${testCase.name}`);
    console.log(`🚨 METHOD START: executeTestWithValidation called for test: ${testCase.name}`);
    console.log(`🚨 IMMEDIATE LOG: executeTestWithValidation called for test: ${testCase.name}`);
    console.log(`🔍 executeTestWithValidation entry for test: ${testCase.name}`);
    
    try {
      // Get RAG client dynamically from playwrightLearningOrchestrator
      console.log('🔍 Getting RAG client...');
      const ragClient = this.playwrightLearningOrchestrator.getRagClient();
      if (!ragClient) {
        throw new Error('RAG client is not available. Please complete the Learning Phase first to load TSV data.');
      }
      console.log('✅ RAG client obtained successfully');
      
      // 1. Get expected results from TSV gold standard
      console.log('🔍 Generating expected results...');
      const expectedResults = await ragClient.generateExpectedResults(testCase);
      console.log(`📊 Expected from TSV: ${expectedResults.expectedCount} records`);
      
      // 2. Execute test on UI with Playwright
      console.log(`🔍 About to call executeTestOnUI for test: ${testCase.name}`);
      const uiResult = await this.executeTestOnUI(testCase, runId);
      console.log(`🔍 executeTestOnUI completed for test: ${testCase.name}`);
      console.log(`🌐 Actual from UI: ${uiResult.data.length} records`);
      
      // 3. Validate using TSV as gold standard
      console.log('🔍 Validating TSV Gold Standard vs UI Results...');
      const validation = await ragClient.validateResults(uiResult.data, expectedResults);
      
      return {
        status: validation.status,
        screenshots: [uiResult.screenshots.before, uiResult.screenshots.after, uiResult.screenshots.results],
        error: validation.passed ? undefined : validation.message,
        validation: validation
      };
      
    } catch (error) {
      console.error('❌ ERROR in executeTestWithValidation:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Error stack:', error.stack);
      return {
        status: 'error',
        error: error.message
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
    
    // Detect and dismiss any UI obstacles (modals, popups, banners, etc.)
    try {
      console.log('🎯 About to call dismissUIObstacles...');
      await this.dismissUIObstacles();
      console.log('🎯 dismissUIObstacles completed successfully');
    } catch (error) {
      console.error('🎯 ERROR in dismissUIObstacles:', error);
      throw error; // Re-throw to see if it's being caught elsewhere
    }
    
    // Take screenshot before test
    const beforeScreenshotResult = await this.mcpClient.callTools([{
      id: 'screenshot-before-' + Date.now(),
      name: 'playwright_screenshot',
      parameters: { path: `${testFolder}/before.png` }
    }]);
    
    // Extract actual screenshot path from Playwright MCP response
    const beforeScreenshotPath = this.extractScreenshotPath(beforeScreenshotResult);
    
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
    const afterScreenshotResult = await this.mcpClient.callTools([{
      id: 'screenshot-after-' + Date.now(),
      name: 'playwright_screenshot',
      parameters: { path: `${testFolder}/after.png` }
    }]);
    
    // Extract actual screenshot path from Playwright MCP response
    const afterScreenshotPath = this.extractScreenshotPath(afterScreenshotResult);
    
    // Take screenshot of results table specifically
    const resultsScreenshotResult = await this.mcpClient.callTools([{
      id: 'screenshot-results-' + Date.now(),
      name: 'playwright_screenshot',
      parameters: { 
        path: `${testFolder}/results.png`,
        selector: '[data-screenshot-table]'
      }
    }]);
    
    // Extract actual screenshot path from Playwright MCP response
    const resultsScreenshotPath = this.extractScreenshotPath(resultsScreenshotResult);
    
    const actualData = results[0]?.result[0]?.value || [];
    
    return {
      data: actualData,
      screenshots: {
        before: beforeScreenshotPath,
        after: afterScreenshotPath,
        results: resultsScreenshotPath
      }
    };
  }

  private async dismissUIObstacles(): Promise<void> {
    console.log('🔍 ENTRY: dismissUIObstacles method called');
    console.log('🔍 Universal AI-powered popup detection starting...');
    
    try {
      // Step 1: Take screenshot for AI analysis
      console.log('📸 Taking screenshot for AI analysis...');
      const screenshotResult = await this.mcpClient.callTools([{
        id: 'popup-screenshot-' + Date.now(),
        name: 'playwright_screenshot',
        parameters: { name: 'popup-detection.png' }
      }]);
      
      // Step 2: Get page text content
      console.log('📄 Getting page text content...');
      const pageTextResult = await this.mcpClient.callTools([{
        id: 'page-text-' + Date.now(),
        name: 'playwright_get_visible_text',
        parameters: {}
      }]);
      
      const pageText = pageTextResult[0]?.result?.[0]?.text || '';
      
      // Step 3: Use AI to analyze the page for popups
      console.log('🧠 Analyzing page with AI for popups...');
      const prompt = `You are analyzing a webpage screenshot and text to detect popups that need to be dismissed before testing can proceed.

Page Text Content: ${pageText.substring(0, 2000)}...

Analyze this page and determine:
1. Are there any popups, modals, warning dialogs, or blocking elements visible?
2. If yes, what is the dismissal button text and CSS selector?
3. What type of popup is it? (warning, consent, verification, terms, government notice, etc.)

Look for common popup patterns:
- Warning dialogs with "Continue", "Accept", "OK" buttons
- Cookie consent banners
- Age verification popups
- Government warnings
- Terms acceptance dialogs
- Privacy notices

Return ONLY a JSON response in this exact format:
{
  "hasPopup": true/false,
  "popupType": "warning|consent|verification|terms|government|other",
  "buttonText": "Continue|Accept|OK|I Agree|etc",
  "buttonSelector": "CSS selector like button:contains('Continue') or .btn-continue",
  "confidence": 0.0-1.0,
  "description": "Brief description of what you see"
}`;

      const aiResponse = await this.bedrockClient.generateResponse([{ role: 'user', content: prompt }], []);
      
      // Step 4: Parse AI response
      let popupAnalysis;
      try {
        // Extract JSON from AI response
        const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          popupAnalysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in AI response');
        }
      } catch (parseError) {
        console.log('⚠️ Failed to parse AI response, trying fallback detection');
        popupAnalysis = { hasPopup: false, confidence: 0 };
      }
      
      // Step 5: Handle popup if detected
      if (popupAnalysis.hasPopup && popupAnalysis.confidence > 0.6) {
        console.log(`🚫 AI detected ${popupAnalysis.popupType} popup`);
        console.log(`🎯 Button text: ${popupAnalysis.buttonText}`);
        console.log(`🎯 Button selector: ${popupAnalysis.buttonSelector}`);
        console.log(`📊 Confidence: ${popupAnalysis.confidence}`);
        
        try {
          // Click the dismissal button
          await this.mcpClient.callTools([{
            id: 'dismiss-popup-' + Date.now(),
            name: 'playwright_click',
            parameters: { selector: popupAnalysis.buttonSelector }
          }]);
          
          console.log(`✅ Popup dismissed successfully using AI detection`);
          
          // Wait for popup to disappear
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Verify popup is gone
          const verifyResult = await this.mcpClient.callTools([{
            id: 'verify-popup-gone-' + Date.now(),
            name: 'playwright_evaluate',
            parameters: {
              expression: `document.querySelector('${popupAnalysis.buttonSelector}') === null`
            }
          }]);
          
          if (verifyResult[0]?.result?.[0]?.value === true) {
            console.log('✅ Popup verification: Successfully dismissed');
          } else {
            console.log('⚠️ Popup verification: May still be present');
          }
          
        } catch (clickError) {
          console.log(`❌ Failed to click popup button: ${clickError.message}`);
          console.log('⚠️ Popup button click failed - continuing without popup dismissal');
        }
      } else {
        console.log('✅ AI analysis: No popups detected');
        console.log(`📊 Confidence: ${popupAnalysis.confidence || 0}`);
      }
      
    } catch (error) {
      console.error('❌ Error in AI popup detection:', error);
      console.log('⚠️ AI popup detection failed - continuing without popup dismissal');
    }
  }

  private extractScreenshotPath(screenshotResult: any[]): string {
    try {
      console.log('🔍 DEBUG: Extracting screenshot path from result:', JSON.stringify(screenshotResult, null, 2));
      
      // Extract the actual screenshot path from Playwright MCP response
      const result = screenshotResult[0]?.result; // Fixed: removed extra [0]
      if (result && Array.isArray(result)) {
        console.log('🔍 DEBUG: Found result array:', result);
        
        // Look for "Screenshot saved to:" in the content
        const content = result.find((c: any) => c.text?.includes('Screenshot saved to:'));
        if (content?.text) {
          console.log('🔍 DEBUG: Found screenshot text:', content.text);
          const pathMatch = content.text.match(/Screenshot saved to: (.+)/);
          if (pathMatch && pathMatch[1]) {
            // Convert the path to a web-accessible URL
            const actualPath = pathMatch[1].trim();
            console.log('🔍 DEBUG: Extracted actual path:', actualPath);
            
            // Extract just the filename and create a web path
            const filename = actualPath.split('/').pop();
            const webPath = `/screenshots/${filename}`;
            console.log('🔍 DEBUG: Generated web path:', webPath);
            return webPath;
          }
        }
      }
      
      console.warn('⚠️ Could not extract screenshot path, using fallback');
      // Fallback: return a default path
      return '/screenshots/default.png';
    } catch (error) {
      console.error('Error extracting screenshot path:', error);
      return '/screenshots/error.png';
    }
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
