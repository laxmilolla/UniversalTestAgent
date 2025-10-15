import { BedrockClient } from '../chatbot/bedrock-client';

export class SimpleRAGClient {
    private bedrockClient: BedrockClient;
    private tsvData: any[] = [];
    private fieldNames: string[] = [];

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
  "dataRelationships": ["Case->Patient", "Case->Diagnosis"]
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
                            ]
                        };
                    });
                }
            }
            
            // If no test cases found, create default ones
            if (testCases.length === 0) {
                testCases = [
                    {
                        name: 'Field Validation Test',
                        description: 'Test that database fields are properly validated',
                        category: 'Data Integrity',
                        priority: 'High',
                        steps: ['Navigate to form', 'Test field validation', 'Verify results'],
                        selectors: ['#form', 'input[required]'],
                        expectedResults: ['Validation works correctly']
                    },
                    {
                        name: 'Search Functionality Test', 
                        description: 'Test search and filter functionality',
                        category: 'Search & Filter',
                        priority: 'High',
                        steps: ['Navigate to search', 'Enter search criteria', 'Verify results'],
                        selectors: ['#search-input', '.results'],
                        expectedResults: ['Search returns correct results']
                    },
                    {
                        name: 'Data Relationship Test',
                        description: 'Test data relationships and navigation',
                        category: 'Data Relationships', 
                        priority: 'Medium',
                        steps: ['Select record', 'Navigate to related data', 'Verify consistency'],
                        selectors: ['.record-item', '.related-data'],
                        expectedResults: ['Relationships work correctly']
                    },
                    {
                        name: 'Error Handling Test',
                        description: 'Test error handling and edge cases',
                        category: 'Error Handling',
                        priority: 'Medium', 
                        steps: ['Test invalid input', 'Verify error messages', 'Check recovery'],
                        selectors: ['.error-message', '.validation-alert'],
                        expectedResults: ['Errors handled gracefully']
                    },
                    {
                        name: 'Performance Test',
                        description: 'Test system performance with large datasets',
                        category: 'Performance',
                        priority: 'Low',
                        steps: ['Load large dataset', 'Test response times', 'Check memory usage'],
                        selectors: ['.loading-indicator', '.results-container'],
                        expectedResults: ['Performance within acceptable limits']
                    }
                ];
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
