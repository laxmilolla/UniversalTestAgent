import { BedrockClient } from '../chatbot/bedrock-client';
import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { FileProcessor } from './file-processor';
import { SimpleRAGClient } from './simple-rag-client';
import { UniversalPatternDetector, DataPatterns, UIPatterns } from './universal-pattern-detector';
import { UniversalPatternMatcher, TestableConnections } from './universal-pattern-matcher';
import { UniversalTestGenerator, UniversalTestCase } from './universal-test-generator';

export class PlaywrightLearningOrchestrator {
    private bedrockClient: BedrockClient;
    private mcpClient: MCPPlaywrightClient;
    private ragClient: SimpleRAGClient;
    private currentWebsiteUrl: string = '';
    private executionTrace: any[] = []; // Add this line
    private readonly timeout = 120000; // 120 seconds instead of 60
    private currentTSVFiles: any[] = []; // Add this line

    // Add global LLM tracking
    private llmCallTracker: any[] = [];

    constructor(bedrockClient: BedrockClient, mcpClient: MCPPlaywrightClient) {
        this.bedrockClient = bedrockClient;
        this.mcpClient = mcpClient;
        this.ragClient = new SimpleRAGClient(bedrockClient); // Add this line
        this.executionTrace = []; // Initialize trace
    }

    // Expose RAG client for test orchestrator
    getRagClient(): SimpleRAGClient {
        return this.ragClient;
    }

    // Add this method to log each step
    private logStep(step: string, actor: string, action: string, input: any, output: any, duration?: number) {
        const traceEntry = {
            timestamp: new Date().toISOString(),
            step,
            actor, // 'Playwright', 'LLM', 'System', 'User'
            action,
            input: typeof input === 'string' ? input.substring(0, 200) + '...' : input,
            output: typeof output === 'string' ? output.substring(0, 200) + '...' : output,
            duration: duration || 0,
            success: !(output instanceof Error)
        };
        
        this.executionTrace.push(traceEntry);
        console.log(`🔍 [${actor}] ${action}:`, traceEntry);
        
        // Store in global for frontend access
        if (typeof global !== 'undefined') {
            global.executionTrace = this.executionTrace;
        }
    }

    async performCompleteLearning(websiteUrl: string, tsvFiles: any[]): Promise<any> {
        const startTime = Date.now(); // ✅ This should be here
        this.executionTrace = []; // Reset trace
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Learning process timeout after 60 seconds')), 60000);
        });
        
        const learningPromise = this.performLearning(websiteUrl, tsvFiles);
        
        try {
            return await Promise.race([learningPromise, timeoutPromise]);
        } catch (error) {
            this.logStep('ERROR', 'System', 'Learning Process Timeout', 
                { error: error.message }, 
                'Process terminated due to timeout');
            
            return { 
                success: false, 
                error: error.message,
                results: { uiElements: 0, dbFields: 0, testCases: 0, relationships: 0 },
                executionTrace: this.executionTrace
            };
        }
    }

    private async performLearning(websiteUrl: string, tsvFiles: any[]): Promise<any> {
        const startTime = Date.now(); // ✅ Move this to the top level
        
        try {
            this.logStep('1', 'System', 'Starting Learning Process', { websiteUrl, tsvCount: tsvFiles?.length || 0 }, 'Initializing...');

            // Store TSV files for RAG
            this.currentTSVFiles = tsvFiles;

            // Add debug logging here
            console.log('=== DEBUG: performLearning method start ===');
            console.log('websiteUrl:', websiteUrl);
            console.log('tsvFiles:', tsvFiles);
            console.log('tsvFiles.length:', tsvFiles?.length);
            console.log('this.mcpClient:', this.mcpClient);
            console.log('this.bedrockClient:', this.bedrockClient);
            
            // Store the current website URL
            this.currentWebsiteUrl = websiteUrl;
            
            let pageContent = '';
            let pageText = '';
            let screenshot = null;
            
            try {
                // Phase 1: Navigate to website with Playwright
                this.logStep('2', 'Playwright', 'Navigate to Website', { url: websiteUrl }, 'Attempting navigation...');
                
                const navigateStart = Date.now();
                const navigatePromise = this.mcpClient.callTools([{
                    id: 'navigate-1',
                    name: 'playwright_navigate',
                    parameters: { url: websiteUrl }
                }]);

                const navigateTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Playwright navigation timeout after 10 seconds')), 10000)
                );

                const navigateResult = await Promise.race([navigatePromise, navigateTimeout]);
                const navigateDuration = Date.now() - navigateStart;
                
                this.logStep('3', 'Playwright', 'Navigation Result', { url: websiteUrl }, navigateResult, navigateDuration);
                
                if (!navigateResult[0]?.success) {
                    throw new Error('Navigation failed');
                }
                
                // Extract HTML content - Wait for dynamic React components to load
                console.log('Waiting for React components to load...');
                
                // Wait for common React/Material-UI components to appear
                try {
                    await this.mcpClient.callTools([{
                        name: 'playwright_wait_for',
                        parameters: { 
                            selector: '.MuiButton-root, [data-testid], .data-table, .filter-panel',
                            timeout: 10000 
                        },
                        id: 'wait-for-components-' + Date.now()
                    }]);
                    console.log('✅ React components detected');
                } catch (error) {
                    console.log('⚠️ React components not found, proceeding with basic wait');
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Fallback wait
                }

                this.logStep('4', 'Playwright', 'Extract HTML Content', 
                    { website: websiteUrl, waitForJS: true, waitForReact: true }, 
                    'Extracting HTML after React components load...');

                // Extract HTML after React components are loaded
                const htmlStart = Date.now();
                const htmlResult = await this.mcpClient.callTools([{
                    name: 'playwright_get_visible_html',
                    parameters: {},
                    id: 'html-extraction-' + Date.now()
                }]);

                // Additional wait for any remaining dynamic content
                await new Promise(resolve => setTimeout(resolve, 2000));

                const htmlDuration = Date.now() - htmlStart; // Fix: Define htmlDuration
                this.logStep('5', 'Playwright', 'HTML Extraction Result', {}, htmlResult, htmlDuration);

                if (htmlResult[0]?.success && htmlResult[0].result?.[0]?.text) {
                    pageContent = htmlResult[0].result[0].text;
                    console.log(`HTML Content Length: ${pageContent.length}`);
                }
                
                // Extract text content
                this.logStep('6', 'Playwright', 'Extract Text Content', {}, 'Getting visible text...');
                
                const textStart = Date.now();
                const textResult = await this.mcpClient.callTools([{
                    id: 'text-1',
                    name: 'playwright_get_visible_text',
                    parameters: {}
                }]);
                const textDuration = Date.now() - textStart;
                
                this.logStep('7', 'Playwright', 'Text Extraction Result', {}, textResult, textDuration);
                
                if (textResult[0]?.success && textResult[0].result?.[0]?.text) {
                    pageText = textResult[0].result[0].text;
                }
                
                // Take screenshot
                this.logStep('8', 'Playwright', 'Take Screenshot', {}, 'Capturing screenshot...');
                
                const screenshotStart = Date.now();
                const screenshotResult = await this.mcpClient.callTools([{
                    id: 'screenshot-1',
                    name: 'playwright_screenshot',
                    parameters: {}
                }]);
                const screenshotDuration = Date.now() - screenshotStart;
                
                this.logStep('9', 'Playwright', 'Screenshot Result', {}, screenshotResult, screenshotDuration);
                
                if (screenshotResult[0]?.success && screenshotResult[0].result?.[0]?.text) {
                    screenshot = screenshotResult[0].result[0].text;
                }
                
                this.logStep('10', 'Playwright', 'Data Extraction Complete', 
                    { pageContentLength: pageContent.length, pageTextLength: pageText.length }, 
                    'Successfully extracted website data');
                    
            } catch (playwrightError) {
                this.logStep('11', 'Playwright', 'Playwright Failed', 
                    { error: playwrightError.message }, 
                    'Playwright extraction failed - no fallback content');
                
                // No fallback - let it fail cleanly
                throw new Error(`Playwright failed: ${playwrightError.message}`);
            }
            
            // Phase 4: LLM Analysis
            this.logStep('12', 'LLM', 'UI Analysis', 
                { pageContentLength: pageContent.length }, 
                'Analyzing UI elements...');
            
            // Check if there's existing screenshot analysis to use
            const existingScreenshotAnalysis = (global as any).screenshotAnalysis;
            if (existingScreenshotAnalysis) {
                console.log('📸 Using existing screenshot analysis for hybrid approach');
                console.log('📸 Screenshot analysis elements:', existingScreenshotAnalysis.totalElements || 0);
            } else {
                console.log('📸 No existing screenshot analysis - using HTML-only approach');
            }
            
            const uiAnalysis = await this.analyzeRealUI(pageContent, pageText, screenshot, existingScreenshotAnalysis);
            this.storeLLMResponse('UI Analysis', 'Analyzing UI elements from website content', uiAnalysis, uiAnalysis);
            
            this.logStep('13', 'LLM', 'Database Analysis', 
                { tsvCount: tsvFiles?.length || 0 }, 
                'Analyzing TSV files...');
            
            const dbAnalysis = await this.analyzeTSVFiles(tsvFiles);
            this.storeLLMResponse('Database Analysis', 'Analyzing TSV files for database structure', dbAnalysis, dbAnalysis);
            
            this.logStep('14', 'LLM', 'RAG Mapping Analysis', 
                { uiElements: uiAnalysis.totalElements, dbFields: dbAnalysis.totalFields }, 
                'Generating mappings with RAG...');
            
            const mappingAnalysis = await this.mapDatabaseToRealUI(dbAnalysis, uiAnalysis, tsvFiles, pageContent);
            this.storeLLMResponse('RAG Mapping Analysis', 'Generating mappings between UI elements and database fields', mappingAnalysis, mappingAnalysis);
            
            const endTime = Date.now();
            const totalDuration = endTime - startTime;
            
            this.logStep('15', 'System', 'Learning Complete', 
                { totalDuration }, 
                'Learning process completed successfully');
            
            // DEBUG: Log the actual analysis objects
            console.log('🔍 DEBUG - uiAnalysis:', JSON.stringify(uiAnalysis, null, 2));
            console.log('🔍 DEBUG - dbAnalysis:', JSON.stringify(dbAnalysis, null, 2));
            console.log('🔍 DEBUG - mappingAnalysis:', JSON.stringify(mappingAnalysis, null, 2));

            // DEBUG: Calculate and log each part
            const uiElementsCalc = (uiAnalysis.forms?.length || 0) + 
                                 (uiAnalysis.buttons?.length || 0) + 
                                 (uiAnalysis.tables?.length || 0) + 
                                 (uiAnalysis.inputs?.length || 0) + 
                                 (uiAnalysis.links?.length || 0) + 
                                 (uiAnalysis.dropdowns?.length || 0) +
                                 (uiAnalysis.charts?.length || 0) +
                                 (uiAnalysis.navigation?.length || 0) +
                                 (uiAnalysis.filters?.length || 0);

            console.log('🔍 DEBUG - UI Elements Calculation:', {
                forms: uiAnalysis.forms?.length || 0,
                buttons: uiAnalysis.buttons?.length || 0,
                tables: uiAnalysis.tables?.length || 0,
                inputs: uiAnalysis.inputs?.length || 0,
                links: uiAnalysis.links?.length || 0,
                dropdowns: uiAnalysis.dropdowns?.length || 0,
                charts: uiAnalysis.charts?.length || 0,
                navigation: uiAnalysis.navigation?.length || 0,
                filters: uiAnalysis.filters?.length || 0,
                total: uiElementsCalc,
                analysisMethod: uiAnalysis.analysisMethod || 'unknown',
                htmlElements: uiAnalysis.htmlElements || 0,
                screenshotElements: uiAnalysis.screenshotElements || 0
            });

            console.log('🔍 DEBUG - DB Fields:', dbAnalysis.totalFields);

            // Store LLM responses globally for API access
            (global as any).llmResponses = this.llmCallTracker;
            (global as any).lastLLMResponse = this.llmCallTracker.length > 0 ? this.llmCallTracker[this.llmCallTracker.length - 1] : null;

            return {
                success: true,
                results: {
                    // Calculate UI elements from actual structure (including screenshot elements)
                    uiElements: uiElementsCalc,
                    
                    // These should work correctly
                    dbFields: dbAnalysis.totalFields || 0,
                    testCases: mappingAnalysis.testCases?.length || 0,
                    relationships: mappingAnalysis.dataRelationships?.length || 0
                },
                analysis: {
                    database: dbAnalysis,
                    ui: uiAnalysis,
                    mapping: mappingAnalysis
                },
                executionTrace: this.executionTrace,
                llmResponses: this.llmCallTracker,
                lastLLMResponse: this.llmCallTracker.length > 0 ? this.llmCallTracker[this.llmCallTracker.length - 1] : null
            };
            
        } catch (error) {
            const endTime = Date.now();
            const totalDuration = endTime - startTime;
            
            this.logStep('ERROR', 'System', 'Learning Failed', 
                { error: error.message, totalDuration }, 
                'Learning process failed');
            
            return {
                success: false,
                error: error.message,
                results: {
                    uiElements: 0,
                    dbFields: 0,
                    testCases: 0,
                    relationships: 0
                },
                executionTrace: this.executionTrace
            };
        }
    }

async analyzeRealUI(pageContent: string, pageText: string, screenshot: any, existingScreenshotAnalysis?: any): Promise<any> {
    console.log('\n=== HYBRID UI ANALYSIS (HTML + SCREENSHOT) ===');
        
        try {
        // Phase 1: HTML-based pattern detection
        console.log('Phase 1: HTML Pattern Detection...');
            const patternDetector = new UniversalPatternDetector();
        const htmlPatterns = patternDetector.discoverUIPatterns(pageContent);
        console.log('🎯 HTML Patterns:', htmlPatterns);
        
        // Phase 2: Screenshot-based visual analysis
        console.log('Phase 2: Screenshot Visual Analysis...');
        let screenshotAnalysis = existingScreenshotAnalysis;
        
        // If no existing analysis provided, try to analyze the current screenshot
        if (!screenshotAnalysis && screenshot) {
            console.log('📸 Analyzing current screenshot...');
            const { LearningOrchestrator } = await import('./learning-orchestrator');
            const { BedrockClient } = await import('../chatbot/bedrock-client');
            const bedrockClient = new BedrockClient({
                region: process.env.AWS_REGION || 'us-east-1',
                modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
            });
            const learningOrchestrator = new LearningOrchestrator(bedrockClient);
            screenshotAnalysis = await learningOrchestrator.analyzeUIScreenshot({
                name: 'playwright-screenshot.png',
                size: screenshot.length || 0,
                data: screenshot
            });
            console.log('📸 Current Screenshot Analysis:', screenshotAnalysis);
        } else if (screenshotAnalysis) {
            console.log('📸 Using provided screenshot analysis:', screenshotAnalysis);
        } else {
            console.log('📸 No screenshot analysis available');
        }
        
        // Phase 3: Combine both approaches
        console.log('Phase 3: Combining Analysis...');
        const combinedResult = this.combineHTMLAndScreenshotAnalysis(htmlPatterns, screenshotAnalysis);
        
        console.log('✅ Combined Analysis:', combinedResult);
        
        return combinedResult;
        
    } catch (error) {
        console.error('Error in hybrid UI analysis:', error);
        // Fallback to HTML-only analysis
        const patternDetector = new UniversalPatternDetector();
        const htmlPatterns = patternDetector.discoverUIPatterns(pageContent);
        return this.convertHTMLPatternsToResult(htmlPatterns);
    }
}

// New method to combine HTML and screenshot analysis
private combineHTMLAndScreenshotAnalysis(htmlPatterns: any, screenshotAnalysis: any): any {
            const result = {
        forms: [],
        buttons: [],
        tables: [],
        inputs: [],
        links: [],
        dropdowns: [],
        
        // Enhanced fields from screenshot analysis
        charts: [],
        navigation: [],
        filters: [],
        interactionPatterns: [],
        dataFlows: [],
        
        // Analysis metadata
        analysisMethod: 'hybrid',
        htmlElements: 0,
        screenshotElements: 0,
        confidence: 0.9
    };
    
    // Convert HTML patterns
    if (htmlPatterns) {
        result.forms = htmlPatterns.forms?.map(f => ({ 
            selector: f.selector, 
            inputs: f.inputs,
            submitButton: f.submitButton,
            source: 'html'
        })) || [];
        
        result.buttons = htmlPatterns.buttons?.map(b => ({ 
            selector: b.selector, 
            type: b.type,
            text: b.text,
            ariaLabel: b.ariaLabel,
            source: 'html'
        })) || [];
        
        result.tables = htmlPatterns.tables?.map(t => ({ 
                    selector: t.selector, 
            columns: t.columns,
            source: 'html'
        })) || [];
        
        result.inputs = htmlPatterns.search?.map(s => ({ 
                    selector: s.selector, 
            type: s.type,
            source: 'html'
        })) || [];
        
        result.dropdowns = htmlPatterns.filters?.filter(f => f.type === 'dropdown').map(f => ({ 
            selector: f.selector,
            source: 'html'
        })) || [];
        
        result.htmlElements = (result.forms.length + result.buttons.length + result.tables.length + 
                              result.inputs.length + result.dropdowns.length);
    }
    
    // Add screenshot analysis results
    if (screenshotAnalysis) {
        // Add screenshot-detected buttons
        if (screenshotAnalysis.buttons) {
            const screenshotButtons = screenshotAnalysis.buttons.map(b => ({
                selector: `[data-screenshot-button="${b.text}"]`,
                type: b.type,
                text: b.text,
                position: b.position,
                purpose: b.purpose,
                source: 'screenshot'
            }));
            result.buttons.push(...screenshotButtons);
        }
        
        // Add screenshot-detected forms
        if (screenshotAnalysis.forms) {
            const screenshotForms = screenshotAnalysis.forms.map(f => ({
                selector: `[data-screenshot-form="${f.label}"]`,
                type: f.type,
                label: f.label,
                placeholder: f.placeholder,
                position: f.position,
                source: 'screenshot'
            }));
            result.forms.push(...screenshotForms);
        }
        
        // Add screenshot-detected tables
        if (screenshotAnalysis.tables) {
            const screenshotTables = screenshotAnalysis.tables.map(t => ({
                selector: '[data-screenshot-table]',
                columns: t.columns,
                rowCount: t.rowCount,
                sortable: t.sortable,
                selectable: t.selectable,
                source: 'screenshot'
            }));
            result.tables.push(...screenshotTables);
        }
        
        // Add additional screenshot insights
        result.charts = screenshotAnalysis.charts || [];
        result.navigation = screenshotAnalysis.navigation || [];
        result.filters = screenshotAnalysis.filters || [];
        result.interactionPatterns = screenshotAnalysis.interactionPatterns || [];
        result.dataFlows = screenshotAnalysis.dataFlows || [];
        
        result.screenshotElements = screenshotAnalysis.totalElements || 0;
    }
    
    // Calculate total elements
    const totalElements = result.htmlElements + result.screenshotElements;
    
    // Update confidence based on agreement between methods
    if (result.htmlElements > 0 && result.screenshotElements > 0) {
        result.confidence = 0.95; // High confidence when both methods agree
    } else if (result.screenshotElements > 0) {
        result.confidence = 0.85; // Good confidence with screenshot analysis
    } else {
        result.confidence = 0.7; // Lower confidence with HTML only
    }
    
    // Group elements for frontend display
    (result as any).interactiveElements = [
        ...result.buttons,
        ...result.forms,
        ...result.inputs,
        ...result.dropdowns
    ];
    
    (result as any).dataComponents = [
        ...result.tables,
        ...result.charts
    ];
    
    (result as any).navigationElements = [
        ...result.navigation,
        ...result.filters,
        ...result.links
    ];
    
    return result;
}

// Fallback method for HTML-only analysis
private convertHTMLPatternsToResult(htmlPatterns: any): any {
    const result = {
        forms: htmlPatterns.forms?.map(f => ({ 
            selector: f.selector, 
            inputs: f.inputs,
            submitButton: f.submitButton,
            source: 'html'
        })) || [],
        buttons: htmlPatterns.buttons?.map(b => ({ 
            selector: b.selector, 
            type: b.type,
            text: b.text,
            ariaLabel: b.ariaLabel,
            source: 'html'
        })) || [],
        tables: htmlPatterns.tables?.map(t => ({ 
            selector: t.selector, 
            columns: t.columns,
            source: 'html'
        })) || [],
        inputs: htmlPatterns.search?.map(s => ({ 
            selector: s.selector, 
            type: s.type,
            source: 'html'
        })) || [],
        links: [],
        dropdowns: htmlPatterns.filters?.filter(f => f.type === 'dropdown').map(f => ({ 
            selector: f.selector,
            source: 'html'
        })) || [],
        
        // Empty arrays for screenshot-specific fields
        charts: [],
        navigation: [],
        filters: [],
        interactionPatterns: [],
        dataFlows: [],
        
        analysisMethod: 'html-only',
        htmlElements: 0,
        screenshotElements: 0,
        confidence: 0.7
    };
    
    // Calculate HTML elements count
    result.htmlElements = result.forms.length + result.buttons.length + result.tables.length + 
                         result.inputs.length + result.dropdowns.length;
    
    // Group elements for frontend display
    (result as any).interactiveElements = [
        ...result.buttons,
        ...result.forms,
        ...result.inputs,
        ...result.dropdowns
    ];
    
    (result as any).dataComponents = [
        ...result.tables,
        ...result.charts
    ];
    
    (result as any).navigationElements = [
        ...result.navigation,
        ...result.filters,
        ...result.links
    ];
    
    return result;
    }

    async analyzeTSVFiles(tsvFiles: any[]): Promise<any> {
        console.log('\n=== UNIVERSAL DATA PATTERN DETECTION ===');
        
        try {
            // Use the existing UniversalPatternDetector
            const patternDetector = new UniversalPatternDetector();
            const dataPatterns = patternDetector.discoverDataPatterns(tsvFiles);
            
            console.log('🎯 Discovered Data Patterns:', dataPatterns);
            
            // Convert to the expected format for compatibility
            const result = {
                totalFields: Object.values(dataPatterns).flat().length,
                fieldNames: Object.values(dataPatterns).flat().map(f => f.name),
                fieldTypes: this.extractFieldTypes(dataPatterns),
                relationships: this.extractRelationships(dataPatterns),
                businessRules: this.extractBusinessRules(dataPatterns),
                dataQuality: 'High', // Based on pattern analysis
                confidence: 0.9 // High confidence with pattern detection
            };
            
            console.log('🎯 Universal Pattern Data result:', result);
            return result;
            
        } catch (error) {
            console.error('Error in Universal Data Pattern Detection:', error);
            return { totalFields: 0, fieldNames: [], fieldTypes: {}, relationships: [], businessRules: [] };
        }
    }

    async mapDatabaseToRealUI(dbAnalysis: any, uiAnalysis: any, tsvFiles: any[] = [], pageContent?: string): Promise<any> {
        console.log('\n=== UNIVERSAL PATTERN MATCHING & TEST GENERATION ===');
        
        try {
            // Use the existing UniversalPatternDetector
            const patternDetector = new UniversalPatternDetector();
            
            // Discover data patterns from current TSV files (not cached)
            const dataPatterns = patternDetector.discoverDataPatterns(tsvFiles || []);
            
            // Convert hybrid UI analysis to UI patterns (instead of HTML parsing)
            const uiPatterns = this.convertHybridUIToPatterns(uiAnalysis);
            
            console.log('🎯 Data Patterns:', dataPatterns);
            console.log('🎯 UI Patterns (from hybrid analysis):', uiPatterns);
            
            // If no TSV data, generate mappings from UI analysis structure
            if (tsvFiles.length === 0) {
                console.log('🎯 No TSV data - generating mappings from UI analysis structure');
                console.log('🎯 UI Analysis structure:', JSON.stringify(uiAnalysis, null, 2));
                
                const uiBasedMappings = this.generateMappingsFromUIAnalysis(uiAnalysis);
                const uiBasedTestCases = this.generateTestCasesFromUIAnalysis(uiAnalysis);
                
                console.log('🎯 Generated mappings:', uiBasedMappings);
                console.log('🎯 Generated test cases:', uiBasedTestCases);
                
                return {
                    mappings: uiBasedMappings,
                    testCases: uiBasedTestCases,
                    validationRules: this.extractValidationRulesFromUI(uiAnalysis),
                    missingMappings: [],
                    dataRelationships: this.extractDataRelationshipsFromUI(uiAnalysis)
                };
            }
            
            // Use the existing UniversalPatternMatcher
            const patternMatcher = new UniversalPatternMatcher();
            const connections = patternMatcher.matchPatterns(dataPatterns, uiPatterns);
            
            console.log('🎯 Pattern Connections:', connections);
            
            // Use the existing UniversalTestGenerator
            const testGenerator = new UniversalTestGenerator();
            const universalTests = testGenerator.generateTests(connections);
            
            console.log('🎯 Generated Universal Tests:', universalTests.length);
            
            // Convert to the expected format for compatibility
            const result = {
                mappings: this.convertConnectionsToMappings(connections),
                testCases: this.convertUniversalTestsToTestCases(universalTests),
                validationRules: this.extractValidationRules(connections),
                missingMappings: [],
                dataRelationships: this.extractDataRelationships(dataPatterns)
            };
            
            console.log('🎯 Universal Pattern Matching result:', result);
            return result;
            
        } catch (error) {
            console.error('Universal Pattern Matching failed:', error);
            return {
                mappings: [],
                testCases: [],
                validationRules: [],
                missingMappings: [],
                dataRelationships: []
            };
        }
    }

    // Helper methods for Universal Pattern Detection integration
    
    private extractFieldTypes(dataPatterns: DataPatterns): any {
        const fieldTypes: any = {};
        
        // Map categorical fields to string type
        dataPatterns.categorical.forEach(field => {
            fieldTypes[field.name] = 'string';
        });
        
        // Map numerical fields to number type
        dataPatterns.numerical.forEach(field => {
            fieldTypes[field.name] = 'number';
        });
        
        // Map identifier fields to string type
        dataPatterns.identifiers.forEach(field => {
            fieldTypes[field.name] = 'string';
        });
        
        // Map searchable fields to string type
        dataPatterns.searchable.forEach(field => {
            fieldTypes[field.name] = 'string';
        });
        
        // Map temporal fields to date type
        dataPatterns.temporal.forEach(field => {
            fieldTypes[field.name] = 'date';
        });
        
        // Map sortable fields to their detected type
        dataPatterns.sortable.forEach(field => {
            fieldTypes[field.name] = field.type || 'string';
        });
        
        return fieldTypes;
    }
    
    private extractRelationships(dataPatterns: DataPatterns): string[] {
        const relationships: string[] = [];
        
        // Extract relationships from identifier fields
        dataPatterns.identifiers.forEach(field => {
            if (field.relationships) {
                relationships.push(...field.relationships);
            }
        });
        
        // Extract relationships from categorical fields
        dataPatterns.categorical.forEach(field => {
            if (field.relationships) {
                relationships.push(...field.relationships);
            }
        });
        
        return [...new Set(relationships)]; // Remove duplicates
    }
    
    private extractBusinessRules(dataPatterns: DataPatterns): string[] {
        const businessRules: string[] = [];
        
        // Extract business rules from all field types
        Object.values(dataPatterns).flat().forEach(field => {
            if (field.businessRules) {
                businessRules.push(...field.businessRules);
            }
        });
        
        return [...new Set(businessRules)]; // Remove duplicates
    }
    
    private convertConnectionsToMappings(connections: TestableConnections): any[] {
        const mappings: any[] = [];
        
        // Convert categorical filter connections
        connections.categoricalToFilters.forEach(conn => {
            mappings.push({
                dbField: conn.dataField,
                uiElement: conn.uiElement,
                type: 'categorical_filter',
                selector: conn.uiElement,
                confidence: conn.confidence
            });
        });
        
        // Convert search connections
        connections.searchableToSearch.forEach(conn => {
            mappings.push({
                dbField: conn.dataField,
                uiElement: conn.uiElement,
                type: 'search',
                selector: conn.uiElement,
                confidence: conn.confidence
            });
        });
        
        // Convert numerical filter connections
        connections.numericalToFilters.forEach(conn => {
            mappings.push({
                dbField: conn.dataField,
                uiElement: conn.uiElement,
                type: 'numerical_filter',
                selector: conn.uiElement,
                confidence: conn.confidence
            });
        });
        
        // Convert sort connections
        connections.sortableToSort.forEach(conn => {
            mappings.push({
                dbField: conn.dataField,
                uiElement: conn.uiElement,
                type: 'sort',
                selector: conn.uiElement,
                confidence: conn.confidence
            });
        });
        
        return mappings;
    }
    
    private convertUniversalTestsToTestCases(universalTests: UniversalTestCase[]): any[] {
        return universalTests.map(test => ({
            name: test.name,
            description: test.description,
            steps: test.steps,
            selectors: test.selectors,
            category: test.category,
            priority: test.priority,
            type: test.type,
            // ADD TSV VALIDATION FIELDS:
            dataField: test.dataField,
            testValues: test.testValues,
            uiElement: test.uiElement,
            websiteUrl: 'https://www.cancer.gov/ccg/research/genome-sequencing/tcga',
            expectedResults: test.expectedResults,
            confidence: test.confidence
        }));
    }
    
    private extractValidationRules(connections: TestableConnections): string[] {
        const validationRules: string[] = [];
        
        // Extract validation rules from all connections
        Object.values(connections).flat().forEach(conn => {
            if (conn.testValues && conn.testValues.length > 0) {
                validationRules.push(`Validate ${conn.dataField} with test values: ${conn.testValues.join(', ')}`);
            }
        });
        
        return validationRules;
    }
    
    private extractDataRelationships(dataPatterns: DataPatterns): string[] {
        const relationships: string[] = [];
        
        // Extract relationships from identifier fields
        dataPatterns.identifiers.forEach(field => {
            if (field.relationships && field.relationships.length > 0) {
                relationships.push(...field.relationships);
            }
        });
        
        // Extract relationships from categorical fields
        dataPatterns.categorical.forEach(field => {
            if (field.relationships && field.relationships.length > 0) {
                relationships.push(...field.relationships);
            }
        });
        
        // Fallback: Generate relationships based on field patterns if none found
        if (relationships.length === 0) {
            const allFields = [
                ...dataPatterns.identifiers.map(f => f.name),
                ...dataPatterns.categorical.map(f => f.name),
                ...dataPatterns.numerical.map(f => f.name),
                ...dataPatterns.searchable.map(f => f.name),
                ...dataPatterns.temporal.map(f => f.name),
                ...dataPatterns.sortable.map(f => f.name)
            ];
            
            // Look for ID patterns and create relationships
            const idFields = allFields.filter(field => 
                field.toLowerCase().includes('_id') || 
                field.toLowerCase().endsWith('id')
            );
            
            idFields.forEach(idField => {
                const baseField = idField.replace(/_id$|id$/i, '');
                const relatedFields = allFields.filter(field => 
                    field !== idField && 
                    (field.toLowerCase().includes(baseField) || 
                     field.toLowerCase().startsWith(baseField + '_'))
                );
                
                relatedFields.forEach(relatedField => {
                    relationships.push(`${idField} -> ${relatedField} (foreign_key)`);
                });
            });
            
            // Look for common relationship patterns
            if (idFields.length > 1) {
                relationships.push(`${idFields[0]} -> ${idFields[1]} (cross_reference)`);
            }
        }
        
        return [...new Set(relationships)]; // Remove duplicates
    }

    // Add this helper method to extract UI filters
    private extractUIFilters(uiAnalysis: any): string[] {
        const filters: string[] = [];
        
        // Extract from forms
        if (uiAnalysis.forms) {
            uiAnalysis.forms.forEach((form: any) => {
                if (form.name) filters.push(form.name);
                if (form.placeholder) filters.push(form.placeholder);
            });
        }
        
        // Extract from buttons
        if (uiAnalysis.buttons) {
            uiAnalysis.buttons.forEach((button: any) => {
                if (button.text) filters.push(button.text);
            });
        }
        
        // Extract from dropdowns
        if (uiAnalysis.dropdowns) {
            uiAnalysis.dropdowns.forEach((dropdown: any) => {
                if (dropdown.options) {
                    dropdown.options.forEach((option: any) => {
                        if (option.text) filters.push(option.text);
                    });
                }
            });
        }
        
        // Extract from inputs
        if (uiAnalysis.inputs) {
            uiAnalysis.inputs.forEach((input: any) => {
                if (input.name) filters.push(input.name);
                if (input.placeholder) filters.push(input.placeholder);
            });
        }
        
        // Extract from tables
        if (uiAnalysis.tables) {
            uiAnalysis.tables.forEach((table: any) => {
                if (table.columns) {
                    table.columns.forEach((column: any) => {
                        if (column.name) filters.push(column.name);
                    });
                }
            });
        }
        
        return filters.filter(f => f && f.length > 2); // Remove empty/short filters
    }

    // Helper method to store LLM responses with enhanced debugging
    private storeLLMResponse(type: string, prompt: string, response: any, parsed: any) {
        const startTime = Date.now();
        const endTime = Date.now();
        
        const llmCall = {
            id: `llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            timestamp: new Date().toISOString(),
            duration: endTime - startTime,
            prompt: {
                content: prompt,
                length: prompt.length,
                tokenEstimate: Math.ceil(prompt.length / 4)
            },
            response: {
                content: response.content || response,
                length: response.content?.length || 0,
                tokenEstimate: Math.ceil((response.content?.length || 0) / 4),
                truncated: this.checkIfTruncated(response.content)
            },
            parsed: {
                success: !!parsed,
                totalFields: parsed?.totalFields || 0,
                elementCount: this.calculateElementCount(parsed, type),
                confidence: parsed?.confidence || 0
            },
            status: 'completed'
        };
        
        // Store in global tracker
        this.llmCallTracker.push(llmCall);
        if (this.llmCallTracker.length > 20) {
            this.llmCallTracker = this.llmCallTracker.slice(-20); // Keep last 20 calls
        }
        
        // Emit to frontend via WebSocket/Socket.IO
        this.emitLLMCall(llmCall);
        
        // Enhanced console logging
        console.log(`🧠 LLM Call ${llmCall.id}: ${type} - ${llmCall.duration}ms`);
    }

    // New method to emit LLM data to frontend
    private emitLLMCall(llmCall: any) {
        try {
            // Send via existing socket if available
            if (typeof global !== 'undefined' && global.io) {
                global.io.emit('llmCallUpdate', llmCall);
            }
            
            // Also store in browser-accessible global
            if (typeof global !== 'undefined') {
                if (!global.realtimeLLMCalls) {
                    global.realtimeLLMCalls = [];
                }
                global.realtimeLLMCalls.push(llmCall);
                if (global.realtimeLLMCalls.length > 50) {
                    global.realtimeLLMCalls = global.realtimeLLMCalls.slice(-50);
                }
            }
        } catch (error) {
            console.error('Failed to emit LLM call:', error);
        }
    }

    // Helper methods
    private checkIfTruncated(content: string): boolean {
        if (!content) return false;
        return content.endsWith('...') || content.length > 3000;
    }

    private calculateElementCount(parsed: any, type: string): number {
        if (type === 'UI_ANALYSIS') {
            return (parsed?.forms?.length || 0) + 
                   (parsed?.buttons?.length || 0) + 
                   (parsed?.tables?.length || 0) + 
                   (parsed?.inputs?.length || 0) + 
                   (parsed?.links?.length || 0) + 
                   (parsed?.dropdowns?.length || 0);
        }
        return parsed?.totalFields || 0;
    }

    // Add this method to display analysis results
    private displayAnalysisResults(uiAnalysis: any, dbAnalysis: any, mappingAnalysis: any) {
        console.log('\n=== ANALYSIS RESULTS DISPLAY ===');
        console.log('UI Elements Found:');
        console.log(`  Forms: ${uiAnalysis?.forms?.length || 0}`);
        console.log(`  Buttons: ${uiAnalysis?.buttons?.length || 0}`);
        console.log(`  Tables: ${uiAnalysis?.tables?.length || 0}`);
        console.log(`  Inputs: ${uiAnalysis?.inputs?.length || 0}`);
        console.log(`  Links: ${uiAnalysis?.links?.length || 0}`);
        console.log(`  Dropdowns: ${uiAnalysis?.dropdowns?.length || 0}`);
        
        const totalUIElements = (uiAnalysis?.forms?.length || 0) + 
                               (uiAnalysis?.buttons?.length || 0) + 
                               (uiAnalysis?.tables?.length || 0) + 
                               (uiAnalysis?.inputs?.length || 0) + 
                               (uiAnalysis?.links?.length || 0) + 
                               (uiAnalysis?.dropdowns?.length || 0);
        
        console.log(`  Total UI Elements: ${totalUIElements}`);
        console.log(`  Database Fields: ${dbAnalysis?.totalFields || 0}`);
        console.log(`  Test Cases: ${mappingAnalysis?.testCases?.length || 0}`);
        console.log(`  Relationships: ${mappingAnalysis?.dataRelationships?.length || 0}`);
    }

    // Helper methods for converting hybrid UI analysis to UIPatterns
    private convertHybridUIToPatterns(uiAnalysis: any): any {
        console.log('🔄 Converting hybrid UI analysis to UIPatterns...');
        console.log('🔄 Input uiAnalysis:', uiAnalysis);
        
        const uiPatterns = {
            filters: this.convertToFilterElements(uiAnalysis),
            search: this.convertToSearchElements(uiAnalysis),
            tables: this.convertToTableElements(uiAnalysis),
            sortable: this.convertToSortableElements(uiAnalysis),
            pagination: this.convertToPaginationElements(uiAnalysis),
            buttons: this.convertToButtonElements(uiAnalysis),
            forms: this.convertToFormElements(uiAnalysis)
        };
        
        console.log('🔄 Converted UIPatterns:', uiPatterns);
        return uiPatterns;
    }

    private convertToFilterElements(uiAnalysis: any): any[] {
        const filters: any[] = [];
        
        // Convert screenshot-detected filters
        if (uiAnalysis.filters && uiAnalysis.filters.length > 0) {
            uiAnalysis.filters.forEach(filter => {
                filters.push({
                    selector: `[data-filter="${filter.label}"]`,
                    type: filter.type,
                    options: filter.options
                });
            });
        }
        
        // Convert forms that are filters (dropdowns, checkboxes)
        if (uiAnalysis.forms && uiAnalysis.forms.length > 0) {
            uiAnalysis.forms.forEach(form => {
                if (form.type === 'dropdown' || form.type === 'checkbox') {
                    filters.push({
                        selector: form.selector,
                        type: form.type,
                        options: form.options || []
                    });
                }
            });
        }
        
        // Convert interactive elements that are filters
        if (uiAnalysis.interactiveElements && uiAnalysis.interactiveElements.length > 0) {
            uiAnalysis.interactiveElements.forEach(element => {
                if (element.type === 'dropdown' || element.type === 'checkbox') {
                    filters.push({
                        selector: element.selector,
                        type: element.type,
                        options: element.options || []
                    });
                }
            });
        }
        
        console.log('🔄 Converted filters:', filters);
        return filters;
    }

    private convertToSearchElements(uiAnalysis: any): any[] {
        const search: any[] = [];
        
        // Convert forms that are search inputs
        if (uiAnalysis.forms && uiAnalysis.forms.length > 0) {
            uiAnalysis.forms.forEach(form => {
                if (form.type === 'search') {
                    search.push({
                        selector: form.selector,
                        type: 'search',
                        placeholder: form.placeholder
                    });
                }
            });
        }
        
        // Convert inputs that are search
        if (uiAnalysis.inputs && uiAnalysis.inputs.length > 0) {
            uiAnalysis.inputs.forEach(input => {
                if (input.type === 'search' || input.type === 'text') {
                    search.push({
                        selector: input.selector,
                        type: input.type,
                        placeholder: input.placeholder
                    });
                }
            });
        }
        
        console.log('🔄 Converted search elements:', search);
        return search;
    }

    private convertToTableElements(uiAnalysis: any): any[] {
        const tables: any[] = [];
        
        if (uiAnalysis.tables && uiAnalysis.tables.length > 0) {
            uiAnalysis.tables.forEach(table => {
                tables.push({
                    selector: table.selector,
                    columns: table.columns || [],
                    rowCount: table.rowCount || 0
                });
            });
        }
        
        // Convert data components that are tables
        if (uiAnalysis.dataComponents && uiAnalysis.dataComponents.length > 0) {
            uiAnalysis.dataComponents.forEach(component => {
                if (component.columns && component.columns.length > 0) {
                    tables.push({
                        selector: component.selector || '[data-table]',
                        columns: component.columns,
                        rowCount: component.rowCount || 0
                    });
                }
            });
        }
        
        console.log('🔄 Converted table elements:', tables);
        return tables;
    }

    private convertToSortableElements(uiAnalysis: any): any[] {
        const sortable: any[] = [];
        
        // Convert tables that are sortable
        if (uiAnalysis.tables && uiAnalysis.tables.length > 0) {
            uiAnalysis.tables.forEach(table => {
                if (table.sortable) {
                    sortable.push({
                        selector: table.selector,
                        type: 'header',
                        sortableFields: table.columns || []
                    });
                }
            });
        }
        
        console.log('🔄 Converted sortable elements:', sortable);
        return sortable;
    }

    private convertToPaginationElements(uiAnalysis: any): any[] {
        const pagination: any[] = [];
        
        // Convert navigation elements that are pagination
        if (uiAnalysis.navigation && uiAnalysis.navigation.length > 0) {
            uiAnalysis.navigation.forEach(nav => {
                if (nav.type === 'pagination') {
                    pagination.push({
                        selector: '[data-pagination]',
                        type: 'pagination'
                    });
                }
            });
        }
        
        console.log('🔄 Converted pagination elements:', pagination);
        return pagination;
    }

    private convertToButtonElements(uiAnalysis: any): any[] {
        const buttons: any[] = [];
        
        if (uiAnalysis.buttons && uiAnalysis.buttons.length > 0) {
            uiAnalysis.buttons.forEach(button => {
                buttons.push({
                    selector: button.selector,
                    type: button.type,
                    text: button.text,
                    ariaLabel: button.ariaLabel
                });
            });
        }
        
        console.log('🔄 Converted button elements:', buttons);
        return buttons;
    }

    private convertToFormElements(uiAnalysis: any): any[] {
        const forms: any[] = [];
        
        if (uiAnalysis.forms && uiAnalysis.forms.length > 0) {
            uiAnalysis.forms.forEach(form => {
                forms.push({
                    selector: form.selector,
                    inputs: form.inputs || [],
                    submitButton: form.submitButton
                });
            });
        }
        
        console.log('🔄 Converted form elements:', forms);
        return forms;
    }

    // Helper methods for UI-based mapping generation
    private generateMappingsFromUIAnalysis(uiAnalysis: any): any[] {
        const mappings = [];
        
        console.log('🎯 generateMappingsFromUIAnalysis called with:', uiAnalysis);
        console.log('🎯 interactiveElements:', uiAnalysis.interactiveElements);
        console.log('🎯 dataComponents:', uiAnalysis.dataComponents);
        
        // Map interactive elements
        if (uiAnalysis.interactiveElements && uiAnalysis.interactiveElements.length > 0) {
            console.log('🎯 Found interactive elements:', uiAnalysis.interactiveElements.length);
            uiAnalysis.interactiveElements.forEach((element: any, index: number) => {
                mappings.push({
                    dbField: `interactive_field_${index + 1}`,
                    uiElement: element.text || element.label || element.selector,
                    type: element.type || 'interactive',
                    source: element.source || 'ui-analysis',
                    description: `Maps to ${element.text || element.label || 'interactive element'}`
                });
            });
        } else {
            console.log('🎯 No interactive elements found');
        }
        
        // Map data components
        if (uiAnalysis.dataComponents && uiAnalysis.dataComponents.length > 0) {
            console.log('🎯 Found data components:', uiAnalysis.dataComponents.length);
            uiAnalysis.dataComponents.forEach((component: any, index: number) => {
                mappings.push({
                    dbField: `data_field_${index + 1}`,
                    uiElement: component.title || component.selector || 'data-component',
                    type: component.type || 'data',
                    source: component.source || 'ui-analysis',
                    description: `Maps to ${component.title || 'data component'}`
                });
            });
        } else {
            console.log('🎯 No data components found');
        }
        
        console.log('🎯 Generated mappings:', mappings);
        return mappings;
    }

    private generateTestCasesFromUIAnalysis(uiAnalysis: any): any[] {
        const testCases = [];
        
        console.log('🎯 generateTestCasesFromUIAnalysis called with:', uiAnalysis);
        console.log('🎯 interactiveElements for test cases:', uiAnalysis.interactiveElements);
        console.log('🎯 dataComponents for test cases:', uiAnalysis.dataComponents);
        
        // Generate test cases for interactive elements
        if (uiAnalysis.interactiveElements && uiAnalysis.interactiveElements.length > 0) {
            console.log('🎯 Found interactive elements for test cases:', uiAnalysis.interactiveElements.length);
            uiAnalysis.interactiveElements.forEach((element: any, index: number) => {
                // STRICT VALIDATION: Only generate if element has required data
                if (!element.text && !element.label) {
                    console.warn(`⚠️ Skipping interactive element ${index}: No text/label`);
                    return;
                }
                if (!element.selector) {
                    console.warn(`⚠️ Skipping interactive element ${index}: No selector`);
                    return;
                }
                
                testCases.push({
                    name: `test_interactive_${index + 1}`,
                    description: `Test interaction with ${element.text || element.label}`,
                    steps: [
                        `Navigate to the page`,
                        `Locate ${element.text || element.label}`,
                        `Interact with ${element.text || element.label}`,
                        `Verify expected behavior`
                    ],
                    selectors: [element.selector],
                    category: 'functionality',
                    type: element.type || 'interactive',
                    priority: 'medium',
                    source: element.source || 'ui-analysis'
                    // REMOVED: Default dataField, testValues, websiteUrl
                    // These MUST come from actual TSV data, not defaults
                });
            });
        } else {
            console.log('🎯 No interactive elements found for test cases');
        }
        
        // Generate test cases for data components
        if (uiAnalysis.dataComponents && uiAnalysis.dataComponents.length > 0) {
            console.log('🎯 Found data components for test cases:', uiAnalysis.dataComponents.length);
            uiAnalysis.dataComponents.forEach((component: any, index: number) => {
                // STRICT VALIDATION: Only generate if component has required data
                if (!component.title && !component.text) {
                    console.warn(`⚠️ Skipping data component ${index}: No title/text`);
                    return;
                }
                if (!component.selector) {
                    console.warn(`⚠️ Skipping data component ${index}: No selector`);
                    return;
                }
                
                testCases.push({
                    name: `test_data_${index + 1}`,
                    description: `Test data component: ${component.title || 'data-component'}`,
                    steps: [
                        `Navigate to the page`,
                        `Locate data component`,
                        `Verify data is displayed correctly`,
                        `Test data interactions if applicable`
                    ],
                    selectors: [component.selector],
                    category: 'data-validation',
                    type: 'data-validation',
                    priority: 'high',
                    source: component.source || 'ui-analysis'
                    // REMOVED: Default dataField, testValues, websiteUrl
                    // These MUST come from actual TSV data, not defaults
                });
            });
        } else {
            console.log('🎯 No data components found for test cases');
        }
        
        console.log('🎯 Generated test cases:', testCases);
        return testCases;
    }

    private extractValidationRulesFromUI(uiAnalysis: any): string[] {
        const rules = [];
        
        if (uiAnalysis.interactiveElements) {
            uiAnalysis.interactiveElements.forEach((element: any) => {
                if (element.type === 'dropdown' || element.type === 'select') {
                    rules.push(`${element.label || element.text} must have valid options`);
                }
                if (element.type === 'search' || element.type === 'input') {
                    rules.push(`${element.label || element.text} must accept valid input`);
                }
            });
        }
        
        return rules;
    }

    private extractDataRelationshipsFromUI(uiAnalysis: any): string[] {
        const relationships = [];
        
        if (uiAnalysis.dataComponents) {
            uiAnalysis.dataComponents.forEach((component: any) => {
                if (component.columns) {
                    relationships.push(`Table columns: ${component.columns.join(', ')}`);
                }
                if (component.type === 'chart') {
                    relationships.push(`Chart data relationship: ${component.title}`);
                }
            });
        }
        
        if (uiAnalysis.interactionPatterns) {
            relationships.push(...uiAnalysis.interactionPatterns);
        }
        
        return relationships;
    }
}