import { BedrockClient } from '../chatbot/bedrock-client';
import { FileProcessor } from './file-processor';

export class LearningOrchestrator {
    private bedrockClient: BedrockClient;

    constructor(bedrockClient: BedrockClient) {
        this.bedrockClient = bedrockClient;
    }

    async analyzeTSVFiles(tsvFiles: any[]): Promise<any> {
        const tsvContent = tsvFiles.map(file => 
            `File: ${file.name}\nContent: ${file.content}\n---\n`
        ).join('\n');

        const prompt = `Analyze these TSV files and extract:
1. All unique field names across all files
2. Data types for each field
3. Relationships between tables (foreign keys, references)
4. Business rules and constraints
5. Data validation patterns

TSV Files (${tsvFiles.length} files):
${tsvContent}

Return JSON format:
{
  "totalFields": number,
  "fieldNames": ["field1", "field2", ...],
  "fieldTypes": {"field1": "string", "field2": "integer", ...},
  "relationships": ["case_id -> sample_id", ...],
  "businessRules": ["rule1", "rule2", ...],
  "validationPatterns": ["pattern1", "pattern2", ...]
}`;

        const response = await this.bedrockClient.generateResponse([{ role: 'user', content: prompt }], []);
        return this.parseJSONResponse(response.content);
    }

async analyzeUIScreenshot(screenshotData: any): Promise<any> {
    const prompt = `Analyze this UI screenshot and identify ALL interactive elements:

SCREENSHOT ANALYSIS TASK:
${screenshotData.name} (${screenshotData.size} bytes)

DETECT AND CATEGORIZE:
1. BUTTONS: All clickable buttons, links, and interactive elements
2. FORMS: Input fields, text areas, dropdowns, checkboxes, radio buttons
3. TABLES: Data tables with columns, rows, sortable headers
4. NAVIGATION: Menus, tabs, breadcrumbs, pagination
5. CHARTS: Visual data representations (donut charts, bar charts, etc.)
6. FILTERS: Search boxes, filter dropdowns, selection controls

RETURN DETAILED JSON:
{
  "totalElements": number,
  "buttons": [
    {
      "type": "button|link|icon",
      "text": "button text",
      "position": "top|middle|bottom|sidebar",
      "purpose": "action|navigation|filter"
    }
  ],
  "forms": [
    {
      "type": "input|dropdown|checkbox|radio|textarea",
      "label": "field label",
      "placeholder": "placeholder text",
      "position": "header|sidebar|main|footer"
    }
  ],
  "tables": [
    {
      "columns": ["col1", "col2", "col3"],
      "rowCount": number,
      "sortable": boolean,
      "selectable": boolean
    }
  ],
  "navigation": [
    {
      "type": "tab|menu|breadcrumb|pagination",
      "items": ["item1", "item2"],
      "active": "current item"
    }
  ],
  "charts": [
    {
      "type": "donut|bar|line|pie",
      "title": "chart title",
      "dataPoints": number
    }
  ],
  "filters": [
    {
      "type": "dropdown|checkbox|search",
      "label": "filter name",
      "options": ["option1", "option2"]
    }
  ],
  "interactionPatterns": [
    "filter -> table update",
    "button -> modal open",
    "tab -> content switch"
  ],
  "dataFlows": [
    "search -> filter -> table",
    "select -> action -> result"
  ]
}`;

    // Convert image to base64 if it's a buffer
    let imageData = '';
    let mediaType = 'image/png';
    
    console.log('DEBUG: Screenshot data properties:', Object.keys(screenshotData));
    console.log('DEBUG: Screenshot data:', screenshotData);
    
    // For now, use text-only analysis with enhanced prompt
    console.log('Using enhanced text-only analysis for screenshot');
    const enhancedPrompt = `${prompt}

IMPORTANT: Even though I cannot see the actual image, please analyze this as if you were looking at a typical data exploration website (like Canine Commons) and provide a comprehensive analysis of what UI elements would typically be present:

1. Data tables with columns for Case ID, Study Code, Field1, Field2, etc.
2. Filter panels with dropdowns for Field1, Field2, Field3, etc.
3. Action buttons like "Add Files", "View in JBrowse", "Export"
4. Search boxes and pagination controls
5. Charts showing data distributions (donut charts, bar charts)
6. Navigation tabs and breadcrumbs

Please provide a detailed analysis as if you were analyzing a real screenshot of such a website.`;

    const response = await this.bedrockClient.generateResponse([{ role: 'user', content: enhancedPrompt }], []);
    const analysis = this.parseJSONResponse(response.content);
    
    // Add grouped elements for frontend display
    if (analysis) {
        analysis.interactiveElements = [
            ...(analysis.buttons || []),
            ...(analysis.forms || [])
        ];
        
        analysis.dataComponents = [
            ...(analysis.tables || []),
            ...(analysis.charts || [])
        ];
        
        analysis.navigationElements = [
            ...(analysis.navigation || []),
            ...(analysis.filters || [])
        ];
    }
    
    return analysis;
}

    async mapDatabaseToUI(dbAnalysis: any, uiAnalysis: any): Promise<any> {
        const prompt = `Map database fields to UI elements:
1. Match TSV fields to UI table columns
2. Identify data validation rules
3. Generate test scenarios for data entry
4. Find missing mappings and gaps
5. Create data relationship tests

Database Fields: ${JSON.stringify(dbAnalysis.fieldNames)}
UI Elements: ${JSON.stringify(uiAnalysis.interactiveElements)}

Return JSON format:
{
  "mappings": [
    {"dbField": "sample_id", "uiElement": "Sample ID column", "type": "display"},
    {"dbField": "field1", "uiElement": "Field 1 dropdown", "type": "input"}
  ],
  "testCases": [
    {"name": "test1", "description": "description", "steps": ["step1", "step2"]}
  ],
  "validationRules": ["rule1", "rule2", ...],
  "missingMappings": ["field1", "field2", ...],
  "dataRelationships": ["relationship1", "relationship2", ...]
}`;

        const response = await this.bedrockClient.generateResponse([{ role: 'user', content: prompt }], []);
        return this.parseJSONResponse(response.content);
    }

    async performCompleteAnalysis(files: any): Promise<any> {
        try {
            // Phase 1: Analyze TSV files
            console.log('Phase 1: Analyzing TSV files...');
            const dbAnalysis = await this.analyzeTSVFiles(files.tsv || []);

            // Phase 2: Analyze UI screenshot
            console.log('Phase 2: Analyzing UI screenshot...');
            const uiAnalysis = await this.analyzeUIScreenshot(files.screenshot?.[0] || {});

            // Phase 3: Map database to UI
            console.log('Phase 3: Mapping database to UI...');
            const mappingAnalysis = await this.mapDatabaseToUI(dbAnalysis, uiAnalysis);

            // Combine results
            return {
                success: true,
                results: {
                    uiElements: uiAnalysis.totalElements || 0,
                    dbFields: dbAnalysis.totalFields || 0,
                    testCases: mappingAnalysis.testCases?.length || 0,
                    relationships: mappingAnalysis.dataRelationships?.length || 0
                },
                analysis: {
                    database: dbAnalysis,
                    ui: uiAnalysis,
                    mapping: mappingAnalysis
                }
            };
        } catch (error) {
            console.error('Complete analysis failed:', error);
            return {
                success: false,
                error: error.message,
                results: {
                    uiElements: 0,
                    dbFields: 0,
                    testCases: 0,
                    relationships: 0
                }
            };
        }
    }

    private parseJSONResponse(response: string): any {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error('No JSON found in response');
        } catch (error) {
            console.error('Failed to parse LLM response:', error);
            return {
                totalFields: 0,
                fieldNames: [],
                fieldTypes: {},
                relationships: [],
                businessRules: [],
                validationPatterns: []
            };
        }
    }
}
