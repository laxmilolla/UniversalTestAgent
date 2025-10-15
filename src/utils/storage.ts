// src/utils/storage.ts
// Simple in-memory storage for Phase 2 - LLM-First Approach

import { TestCase, TestResult, TestData } from '../models';

export class TestStorage {
  private testCases: Map<string, TestCase> = new Map();
  private testResults: Map<string, TestResult> = new Map();
  private testData: Map<string, TestData> = new Map();

  // Test Case Management
  async saveTestCase(testCase: TestCase): Promise<void> {
    this.testCases.set(testCase.id, testCase);
  }

  async saveTestCases(testCases: TestCase[]): Promise<void> {
    testCases.forEach(testCase => {
      this.testCases.set(testCase.id, testCase);
    });
  }

  async getTestCase(testCaseId: string): Promise<TestCase | null> {
    return this.testCases.get(testCaseId) || null;
  }

  async getAllTestCases(): Promise<TestCase[]> {
    return Array.from(this.testCases.values());
  }

  async updateTestCase(testCase: TestCase): Promise<void> {
    this.testCases.set(testCase.id, testCase);
  }

  async deleteTestCase(testCaseId: string): Promise<void> {
    this.testCases.delete(testCaseId);
  }

  // Test Result Management
  async saveTestResult(testResult: TestResult): Promise<void> {
    this.testResults.set(testResult.testCaseId, testResult);
  }

  async getTestResult(testCaseId: string): Promise<TestResult | null> {
    return this.testResults.get(testCaseId) || null;
  }

  async getAllTestResults(): Promise<TestResult[]> {
    return Array.from(this.testResults.values());
  }

  // Test Data Management
  async saveTestData(testData: TestData): Promise<void> {
    this.testData.set(testData.id, testData);
  }

  async getTestData(testDataId: string): Promise<TestData | null> {
    return this.testData.get(testDataId) || null;
  }

  async getTestDataByTestCase(testCaseId: string): Promise<TestData[]> {
    return Array.from(this.testData.values()).filter(td => td.testCaseId === testCaseId);
  }

  // Search and Filter
  async searchTestCases(query: string): Promise<TestCase[]> {
    const testCases = Array.from(this.testCases.values());
    return testCases.filter(tc => 
      tc.name.toLowerCase().includes(query.toLowerCase()) ||
      tc.description.toLowerCase().includes(query.toLowerCase()) ||
      tc.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
    );
  }

  async filterTestCases(filters: {
    category?: string;
    priority?: string;
    status?: string;
  }): Promise<TestCase[]> {
    let testCases = Array.from(this.testCases.values());
    
    if (filters.category) {
      testCases = testCases.filter(tc => tc.category === filters.category);
    }
    
    if (filters.priority) {
      testCases = testCases.filter(tc => tc.priority === filters.priority);
    }
    
    if (filters.status) {
      testCases = testCases.filter(tc => tc.status === filters.status);
    }
    
    return testCases;
  }

  // Statistics
  async getTestStatistics(): Promise<any> {
    const testCases = Array.from(this.testCases.values());
    const testResults = Array.from(this.testResults.values());
    
    return {
      totalTestCases: testCases.length,
      totalTestResults: testResults.length,
      byCategory: this.groupBy(testCases, 'category'),
      byPriority: this.groupBy(testCases, 'priority'),
      byStatus: this.groupBy(testCases, 'status'),
      passedTests: testResults.filter(tr => tr.status === 'passed').length,
      failedTests: testResults.filter(tr => tr.status === 'failed').length,
      averageDuration: testResults.reduce((sum, tr) => sum + tr.duration, 0) / testResults.length || 0
    };
  }

  private groupBy(array: any[], key: string): Record<string, number> {
    return array.reduce((groups, item) => {
      const value = item[key];
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }

  // Export/Import
  async exportTestCases(): Promise<TestCase[]> {
    return Array.from(this.testCases.values());
  }

  async importTestCases(testCases: TestCase[]): Promise<void> {
    testCases.forEach(testCase => {
      this.testCases.set(testCase.id, testCase);
    });
  }

  // Clear all data
  async clearAllData(): Promise<void> {
    this.testCases.clear();
    this.testResults.clear();
    this.testData.clear();
  }

  // Get storage info
  async getStorageInfo(): Promise<any> {
    return {
      testCasesCount: this.testCases.size,
      testResultsCount: this.testResults.size,
      testDataCount: this.testData.size,
      memoryUsage: process.memoryUsage()
    };
  }
}
