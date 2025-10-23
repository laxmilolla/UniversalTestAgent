import { BedrockClient } from '../chatbot/bedrock-client';

export class SimpleRAGClient {
    private bedrockClient: BedrockClient;
    private tsvData: any[] = [];
    private fieldNames: string[] = [];
    private fieldIndexes: Map<string, Map<any, any[]>> = new Map();

    constructor(bedrockClient: BedrockClient) {
        this.bedrockClient = bedrockClient;
    }

    // Step 1: Store TSV data for RAG queries
    async storeTSVData(tsvFiles: any[]): Promise<void> {
        console.log('📚 Storing TSV data for RAG...');
        
        this.tsvData = [];
        this.fieldNames = [];
        
        tsvFiles.forEach(file => {
            if (file.content) {
                const lines = file.content.split('\n').filter(line => line.trim());
                if (lines.length >= 2) {
                    const headers = lines[0].split('\t');
                    const rows = lines.slice(1).map(line => {
                        const values = line.split('\t');
                        const row: any = {};
                        headers.forEach((header, index) => {
                            row[header.trim()] = values[index]?.trim() || '';
                        });
                        return row;
                    });
                    
                    this.tsvData.push(...rows);
                    this.fieldNames.push(...headers.map(h => h.trim()));
                }
            }
        });
        
        // Remove duplicate field names
        this.fieldNames = [...new Set(this.fieldNames)];
        
        console.log(`✅ Stored ${this.tsvData.length} records with ${this.fieldNames.length} unique fields`);
        
        // Build field indexes for fast queries
        this.buildFieldIndexes();
    }

    // Build field indexes for O(1) lookups
    private buildFieldIndexes(): void {
        console.log('🔨 Building field indexes for gold standard validation...');
        
        this.fieldNames.forEach(field => {
            const index = new Map<any, any[]>();
            
            this.tsvData.forEach(record => {
                const value = record[field];
                if (!index.has(value)) {
                    index.set(value, []);
                }
                index.get(value)!.push(record);
            });
            
            this.fieldIndexes.set(field, index);
            console.log(`  📇 Indexed ${field}: ${index.size} unique values`);
        });
    }

    // Fast query by field for validation
    async queryByField(field: string, value: any): Promise<any[]> {
        const index = this.fieldIndexes.get(field);
        if (index) {
            const records = index.get(value) || [];
            console.log(`⚡ Fast query: ${field}=${value} → ${records.length} records`);
            return records;
        }
        
        // Fallback to linear search if field not indexed
        console.log(`⚠️ Slow query: ${field}=${value} (field not indexed)`);
        return this.tsvData.filter(record => record[field] === value);
    }

    // Generate expected results from TSV gold standard
    async generateExpectedResults(testCase: any): Promise<any> {
        const field = testCase.dataField;
        const value = testCase.testValues[0];
        
        console.log(`📊 Generating expected results from TSV: ${field}=${value}`);
        
        const expectedRecords = await this.queryByField(field, value);
        
        return {
            testCaseId: testCase.id,
            filterCriteria: `${field} = ${value}`,
            expectedCount: expectedRecords.length,
            expectedRecords: expectedRecords,
            expectedFieldValues: [...new Set(expectedRecords.map(r => r[field]))],
            dataField: field,
            filterValue: value,
            sourceData: 'TSV Gold Standard',
            timestamp: new Date()
        };
    }

    // Validate UI results against TSV gold standard
    async validateResults(actualRecords: any[], expectedResults: any): Promise<any> {
        console.log('🔍 Validating TSV Gold Standard vs UI Results...');
        
        const validation = {
            countMatch: this.validateCount(actualRecords.length, expectedResults.expectedCount),
            fieldValuesMatch: this.validateFieldValues(actualRecords, expectedResults),
            recordsMatch: this.validateRecordIds(actualRecords, expectedResults.expectedRecords)
        };
        
        const allPassed = validation.countMatch.passed && 
                         validation.fieldValuesMatch.passed && 
                         validation.recordsMatch.passed;
        
        return {
            passed: allPassed,
            status: allPassed ? 'passed' : 'failed',
            expectedCount: expectedResults.expectedCount,
            actualCount: actualRecords.length,
            validationChecks: validation,
            message: this.generateValidationMessage(validation, expectedResults, actualRecords)
        };
    }

    private validateCount(actualCount: number, expectedCount: number): any {
        const passed = actualCount === expectedCount;
        return {
            checkType: 'count',
            passed: passed,
            message: passed ? 
                `Count matches TSV: ${actualCount} records` : 
                `Count mismatch: Expected ${expectedCount} from TSV, got ${actualCount} from UI`,
            expectedCount,
            actualCount,
            difference: actualCount - expectedCount
        };
    }

    private validateFieldValues(actualRecords: any[], expectedResults: any): any {
        const actualValues = actualRecords.map(r => r[expectedResults.dataField]);
        const invalidValues = actualValues.filter(v => !expectedResults.expectedFieldValues.includes(v));
        
        const passed = invalidValues.length === 0;
        return {
            checkType: 'field_values',
            passed: passed,
            message: passed ? 
                `All ${expectedResults.dataField} values match TSV` : 
                `Found ${invalidValues.length} invalid ${expectedResults.dataField} values`,
            invalidValues,
            fieldName: expectedResults.dataField
        };
    }

    private validateRecordIds(actualRecords: any[], expectedRecords: any[]): any {
        const idField = this.findIdField(expectedRecords);
        if (!idField) {
            return { checkType: 'records', passed: true, message: 'No ID field found, skipping record validation' };
        }
        
        const expectedIds = expectedRecords.map(r => r[idField]).sort();
        const actualIds = actualRecords.map(r => r[idField]).sort();
        
        const missingIds = expectedIds.filter(id => !actualIds.includes(id));
        const extraIds = actualIds.filter(id => !expectedIds.includes(id));
        
        const passed = missingIds.length === 0 && extraIds.length === 0;
        return {
            checkType: 'records',
            passed: passed,
            message: passed ? 
                'All record IDs match TSV' : 
                `Record ID mismatch: Missing ${missingIds.length}, Extra ${extraIds.length}`,
            missingIds,
            extraIds,
            idField
        };
    }

    private findIdField(records: any[]): string | null {
        if (records.length === 0) return null;
        const fields = Object.keys(records[0]);
        return fields.find(f => f.toLowerCase().includes('id') || f.toLowerCase().includes('case')) || null;
    }

    private generateValidationMessage(validation: any, expectedResults: any, actualRecords: any[]): string {
        const messages = [];
        
        if (!validation.countMatch.passed) {
            messages.push(validation.countMatch.message);
        }
        if (!validation.fieldValuesMatch.passed) {
            messages.push(validation.fieldValuesMatch.message);
        }
        if (!validation.recordsMatch.passed) {
            messages.push(validation.recordsMatch.message);
        }
        
        if (messages.length === 0) {
            return `✅ All validations passed: UI results match TSV gold standard (${actualRecords.length} records)`;
        }
        
        return `❌ Validation failed:\n${messages.join('\n')}`;
    }

    // Create stratified sample for large TSV files
    async createStratifiedSample(maxRecords: number = 100): Promise<any[]> {
        console.log(`📊 Creating stratified sample (max ${maxRecords} records from ${this.tsvData.length} total)...`);
        
        if (this.tsvData.length <= maxRecords) {
            console.log('  → Dataset small enough, using all records');
            return this.tsvData;
        }
        
        // Use first categorical field for stratification
        const categoricalField = this.fieldNames[0];
        const uniqueValues = [...new Set(this.tsvData.map(r => r[categoricalField]))];
        
        console.log(`  → Stratifying by ${categoricalField}: ${uniqueValues.length} unique values`);
        
        const recordsPerValue = Math.ceil(maxRecords / uniqueValues.length);
        const sample: any[] = [];
        
        uniqueValues.forEach(value => {
            const records = this.tsvData.filter(r => r[categoricalField] === value);
            sample.push(...records.slice(0, recordsPerValue));
        });
        
        const finalSample = sample.slice(0, maxRecords);
        console.log(`  ✅ Created sample: ${finalSample.length} records`);
        return finalSample;
    }

    // Step 2: Query specific data based on UI filters
    async queryRelevantData(uiFilters: string[]): Promise<any[]> {
        console.log('🔍 RAG Query for UI filters:', uiFilters);
        
        if (this.tsvData.length === 0) {
            console.log('⚠️ No TSV data stored, returning empty array');
            return [];
        }

        // Simple keyword matching
        const relevantRecords: any[] = [];
        
        for (const record of this.tsvData) {
            const recordText = JSON.stringify(record).toLowerCase();
            
            // Check if any UI filter matches this record
            const hasMatch = uiFilters.some(filter => 
                recordText.includes(filter.toLowerCase())
            );
            
            if (hasMatch) {
                relevantRecords.push(record);
            }
            
            // Limit to 20 records to prevent timeout
            if (relevantRecords.length >= 20) {
                break;
            }
        }
        
        console.log(`🎯 Found ${relevantRecords.length} relevant records`);
        return relevantRecords;
    }

    // Step 3: Generate field mappings with small dataset
    async generateMappingsWithRAG(uiAnalysis: any, uiFilters: string[]): Promise<any> {
        console.log('🧠 Generating mappings with RAG...');
        
        // Get only relevant data
        const relevantData = await this.queryRelevantData(uiFilters);
        
        if (relevantData.length === 0) {
            console.log('⚠️ No relevant data found, using sample data');
            // Use first 5 records as fallback
            const sampleData = this.tsvData.slice(0, 5);
            return await this.generateMappingsWithData(uiAnalysis, sampleData);
        }
        
        return await this.generateMappingsWithData(uiAnalysis, relevantData);
    }

    // Step 4: Generate mappings with small dataset (no timeout)
    private async generateMappingsWithData(uiAnalysis: any, data: any[]): Promise<any> {
        const prompt = `Generate test cases using this data:

UI Elements: ${JSON.stringify(uiAnalysis, null, 1)}
Database Records: ${JSON.stringify(data.slice(0, 5), null, 1)}
Field Names: ${this.fieldNames.slice(0, 20).join(', ')}

Return JSON:
{
  "mappings": [{"dbField": "field", "uiElement": "element", "type": "input", "selector": "#field", "validation": "required"}],
  "testCases": [
    {
      "name": "Field Validation Test",
      "description": "Test field validation",
      "category": "Data Integrity", 
      "priority": "High",
      "steps": ["Navigate to form", "Test validation", "Verify results"],
      "selectors": ["#form", "input[required]"],
      "expectedResults": ["Validation works"]
    },
    {
      "name": "Search Functionality Test", 
      "description": "Test search and filter functionality",
      "category": "Search & Filter",
      "priority": "High",
      "steps": ["Navigate to search", "Enter search criteria", "Verify results"],
      "selectors": ["#search-input", ".results"],
      "expectedResults": ["Search returns correct results"]
    },
    {
      "name": "Data Relationship Test",
      "description": "Test data relationships and navigation",
      "category": "Data Relationships", 
      "priority": "Medium",
      "steps": ["Select record", "Navigate to related data", "Verify consistency"],
      "selectors": [".record-item", ".related-data"],
      "expectedResults": ["Relationships work correctly"]
    },
    {
      "name": "Error Handling Test",
      "description": "Test error handling and edge cases",
      "category": "Error Handling",
      "priority": "Medium", 
      "steps": ["Test invalid input", "Verify error messages", "Check recovery"],
      "selectors": [".error-message", ".validation-alert"],
      "expectedResults": ["Errors handled gracefully"]
    },
    {
      "name": "Performance Test",
      "description": "Test system performance with large datasets",
      "category": "Performance",
      "priority": "Low",
      "steps": ["Load large dataset", "Test response times", "Check memory usage"],
      "selectors": [".loading-indicator", ".results-container"],
      "expectedResults": ["Performance within acceptable limits"]
    }
  ],
  "validationRules": ["Required fields", "Data types", "Constraints"],
  "missingMappings": [],
  "dataRelationships": ["Field1->Field2", "Field1->Field3"]
}`;

        try {
            const response = await this.bedrockClient.generateResponse([
                { role: 'user', content: prompt }
            ], []);
            
            return this.parseJSONResponse(response.content);
        } catch (error) {
            console.error('RAG mapping generation failed:', error);
            return {
                mappings: [],
                testCases: [],
                validationRules: [],
                missingMappings: [],
                dataRelationships: []
            };
        }
    }

    private parseJSONResponse(response: string): any {
        try {
            console.log('=== DEBUG: RAG parseJSONResponse ===');
            console.log('Response length:', response?.length || 0);
            console.log('Response preview:', response?.substring(0, 300) + '...');
            
            // First try to parse the entire response as JSON
            try {
                const directParse = JSON.parse(response);
                console.log('Direct JSON parse successful');
                return directParse;
            } catch (directError) {
                console.log('Direct JSON parse failed, trying extraction methods...');
            }
            
            // Try to extract JSON from markdown code blocks
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                try {
                    const extracted = JSON.parse(jsonMatch[1]);
                    console.log('Extracted JSON from markdown code block');
                    return extracted;
                } catch (extractError) {
                    console.log('Markdown extraction failed:', extractError.message);
                }
            }
            
            // Try to find JSON object boundaries
            const startIndex = response.indexOf('{');
            const endIndex = response.lastIndexOf('}');
            
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                const jsonString = response.substring(startIndex, endIndex + 1);
                console.log('Extracted JSON string length:', jsonString.length);
                console.log('Extracted JSON preview:', jsonString.substring(0, 200) + '...');
                
                try {
                    const extracted = JSON.parse(jsonString);
                    console.log('JSON extraction successful');
                    return extracted;
                } catch (extractError) {
                    console.log('JSON extraction failed:', extractError.message);
                    
                    // Try to fix common JSON issues
                    try {
                        const fixedJson = jsonString
                            .replace(/,\s*}/g, '}')  // Remove trailing commas
                            .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
                            .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // Quote unquoted keys
                            .replace(/:\s*([^",{\[\s][^,}]*?)([,}])/g, ': "$1"$2');  // Quote unquoted string values
                        
                        const fixed = JSON.parse(fixedJson);
                        console.log('Fixed JSON parsing successful');
                        return fixed;
                    } catch (fixError) {
                        console.log('JSON fixing failed:', fixError.message);
                    }
                }
            }
            
            console.log('All parsing methods failed, trying to extract raw data...');
            return this.extractRawTestData(response);
            
        } catch (error) {
            console.error('RAG parseJSONResponse error:', error);
            return {
                mappings: [],
                testCases: [],
                validationRules: [],
                missingMappings: [],
                dataRelationships: []
            };
        }
    }

    // Enhanced: Extract test case data from raw response even if JSON is truncated
    private extractRawTestData(response: string): any {
        console.log('=== DEBUG: extractRawTestData ===');
        
        try {
            // Extract mappings from visible data
            let mappings = [];
            const mappingMatches = response.match(/"mappings":\s*\[([^\]]*(?:\{[^}]*\}[^\]]*)*)/);
            if (mappingMatches) {
                const mappingContent = mappingMatches[1];
                const fieldMatches = mappingContent.match(/"dbField":\s*"([^"]+)"/g);
                if (fieldMatches) {
                    mappings = fieldMatches.map(match => {
                        const fieldName = match.match(/"dbField":\s*"([^"]+)"/)[1];
                        return {
                            dbField: fieldName,
                            uiElement: `${fieldName} field`,
                            type: 'input',
                            selector: `#${fieldName.replace(/\./g, '-')}`,
                            validation: 'required'
                        };
                    });
                }
            }
            
            // Extract test cases from visible data
            let testCases = [];
            const testCaseMatches = response.match(/"testCases":\s*\[([^\]]*(?:\{[^}]*\}[^\]]*)*)/);
            if (testCaseMatches) {
                const testCaseContent = testCaseMatches[1];
                
                // Extract individual test case names
                const nameMatches = testCaseContent.match(/"name":\s*"([^"]+)"/g);
                if (nameMatches) {
                    testCases = nameMatches.map((match, index) => {
                        const testName = match.match(/"name":\s*"([^"]+)"/)[1];
                        return {
                            name: testName,
                            description: `Test case ${index + 1}: ${testName}`,
                            category: index === 0 ? 'Data Integrity' : index === 1 ? 'Search & Filter' : 'General',
                            priority: index < 2 ? 'High' : 'Medium',
                            steps: [
                                `Execute ${testName}`,
                                'Verify expected results',
                                'Check for errors'
                            ],
                            selectors: ['#main-content', '.test-element'],
                            expectedResults: [
                                'Test executes successfully',
                                'No errors occur',
                                'Expected behavior observed'
                            ],
                            // ADD TSV VALIDATION FIELDS:
                            dataField: this.fieldNames[0] || 'field1', // Use first TSV field
                            testValues: ['test_value_1', 'test_value_2'], // Default test values
                            type: 'filter_test', // Default test type
                            websiteUrl: 'https://example.com'
                        };
                    });
                }
            }
            
            // If no test cases found, DON'T create default ones
            if (testCases.length === 0) {
                console.warn('⚠️ No test cases found in LLM response - will not generate fallback test cases');
                // Return empty array instead of defaults
            }
            
            const result = {
                mappings,
                testCases,
                validationRules: [
                    'Required fields cannot be empty',
                    'Data types must match expected format',
                    'Unique constraints must be respected'
                ],
                missingMappings: [],
                dataRelationships: [
                    'Case is associated with Patient',
                    'Case has Diagnosis information',
                    'Case is part of Study'
                ]
            };
            
            console.log('Enhanced RAG extraction result:', result);
            return result;
            
        } catch (error) {
            console.error('Enhanced RAG extraction failed:', error);
            return {
                mappings: [],
                testCases: [],
                validationRules: [],
                missingMappings: [],
                dataRelationships: []
            };
        }
    }
}
