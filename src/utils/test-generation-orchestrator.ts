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
    private storage: TestStorage
  ) {}

  // Main test generation method
  async generateTestCases(learningResults: LearningResults, testOptions?: any): Promise<{success: boolean, testCases?: TestCase[], statistics?: any, error?: string}> {
    try {
      console.log('Starting test case generation...');
      
      // Generate test cases using LLM
      const testCases = await this.generateTestCasesWithLLM(learningResults);
      
      // Generate test data for each test case
      const testCasesWithData = await this.generateTestDataForTestCases(testCases, learningResults);
      
      // Save test cases to storage
      await this.storage.saveTestCases(testCasesWithData);
      
      console.log(`Generated ${testCasesWithData.length} test cases`);
      
      return {
        success: true,
        testCases: testCasesWithData,
        statistics: {
          total: testCasesWithData.length,
          byCategory: this.groupBy(testCasesWithData, 'category'),
          byPriority: this.groupBy(testCasesWithData, 'priority')
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

  // LLM-powered test case generation
  private async generateTestCasesWithLLM(learningResults: LearningResults): Promise<TestCase[]> {
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
        const testResult = await this.simulateTestExecution(testCase);
        const testEndTime = Date.now();
        
        results.push({
          testCaseId,
          testCaseName: testCase.name,
          status: testResult.status as 'passed' | 'failed' | 'skipped' | 'error',
          startTime: new Date(testStartTime),
          endTime: new Date(testEndTime),
          duration: testEndTime - testStartTime,
          screenshots: testResult.screenshots || [],
          error: testResult.error
        });
        
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
      const statistics = {
        total: results.length,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        duration: `${((endTime - startTime) / 1000).toFixed(2)}s`
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

  private groupBy(array: any[], key: string): Record<string, number> {
    return array.reduce((groups, item) => {
      const value = item[key];
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }
}
