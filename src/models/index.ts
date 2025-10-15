// src/models/index.ts
// Simple data models for Phase 2 - LLM-First Approach

export interface TestCase {
  id: string;
  name: string;
  description: string;
  category: 'data_validation' | 'functionality' | 'performance' | 'ui_validation';
  priority: 'high' | 'medium' | 'low';
  status: 'draft' | 'ready' | 'executed' | 'failed';
  
  // Test Structure (LLM generates these)
  steps: string[];              // Step-by-step instructions
  selectors: string[];          // CSS selectors for UI elements
  testData: any;                // Test data based on TSV fields
  expectedResults: string[];    // Expected outcomes
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

export interface TestResult {
  testCaseId: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  startTime: Date;
  endTime?: Date;
  duration: number;
  screenshots: string[];
  error?: string;
}

export interface TestData {
  id: string;
  testCaseId: string;
  name: string;
  description: string;
  
  // Input Data (based on TSV fields)
  inputs: Record<string, any>;
  
  // Expected Outputs
  expectedOutputs: Record<string, any>;
  
  // Metadata
  createdAt: Date;
  isTemplate: boolean;
  tags: string[];
}

// Learning results from Phase 1
export interface LearningResults {
  success: boolean;
  results: {
    uiElements: number;
    dbFields: number;
    testCases: number;
    relationships: number;
  };
  analysis: {
    database: DatabaseAnalysis;
    ui: UIAnalysis;
    mapping: MappingAnalysis;
  };
}

export interface DatabaseAnalysis {
  totalFields: number;
  fieldNames: string[];
  fieldTypes: Record<string, string>;
  relationships: string[];
  businessRules: string[];
}

export interface UIAnalysis {
  totalElements: number;
  interactiveElements: string[];
  dataComponents: string[];
  navigationElements: string[];
  formFields: string[];
  tableColumns: string[];
  interactionPatterns: string[];
  dataFlows: string[];
}

export interface MappingAnalysis {
  mappings: Array<{
    dbField: string;
    uiElement: string;
    type: string;
    selector: string;
  }>;
  testCases: Array<{
    name: string;
    description: string;
    steps: string[];
    selectors: string[];
  }>;
  validationRules: string[];
  missingMappings: string[];
  dataRelationships: string[];
}
