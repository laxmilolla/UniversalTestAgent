// src/utils/test-generation-orchestrator.ts
// Main orchestrator for Phase 2 - LLM-First Test Generation

import * as fs from 'fs';
import * as path from 'path';
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

  // Main test generation method - uses mappings from learningResults first, RAG as fallback
  async generateTestCases(learningResults: LearningResults, testOptions?: any): Promise<{success: boolean, testCases?: TestCase[], statistics?: any, error?: string}> {
    try {
      console.log('🔍 Test Generation: Using mappings from learning results...');
      
      // First, try to use mappings and test cases from learningResults
      const mappingAnalysis = (learningResults as any).analysis?.mappingAnalysis;
      const mappings = mappingAnalysis?.mappings || [];
      const existingTestCases = mappingAnalysis?.testCases || [];
      
      console.log(`📊 Found ${mappings.length} mappings in learningResults`);
      console.log(`📋 Found ${existingTestCases.length} test cases in learningResults`);
      
      // If we have test cases from learning phase, return them
      if (existingTestCases.length > 0) {
        console.log(`✅ Using ${existingTestCases.length} test cases from learning phase`);
        return {
          success: true,
          testCases: existingTestCases,
          statistics: {
            totalTestCases: existingTestCases.length,
            mappingsUsed: mappings.length,
            source: 'learning-phase'
          }
        };
      }
      
      // If we have mappings but no test cases, we can still proceed
      if (mappings.length > 0) {
        console.log(`✅ Using ${mappings.length} mappings from learning phase`);
        // Return empty test cases array - they should have been generated during learning
        return {
          success: true,
          testCases: [],
          statistics: {
            totalTestCases: 0,
            mappingsUsed: mappings.length,
            source: 'learning-phase',
            message: 'Test cases should have been generated during learning phase. Check learningResults.analysis.mappingAnalysis.testCases'
          }
        };
      }
      
      // Fallback: Try RAG query if no mappings in learningResults
      console.log('⚠️ No mappings in learningResults, trying RAG query as fallback...');
      const vectorRAG = (this.playwrightLearningOrchestrator as any).vectorRAG;
      if (!vectorRAG) {
        return {
          success: false,
          error: 'No mappings found in learning results and VectorRAG client not available'
        };
      }
      
      // Query RAG for all mappings
      const ragMappings = await vectorRAG.queryMappings("Get all UI to TSV mappings");
      console.log(`📊 Found ${ragMappings.length} mappings in RAG`);
      
      if (ragMappings.length === 0) {
        console.warn('No mappings found in RAG');
        return {
          success: false,
          error: 'No mappings found in learning results or RAG vector store'
        };
      }
      
      // Query RAG for test cases
      const suggestedTests = await vectorRAG.queryUIKnowledge("What test cases should be generated?");
      console.log(`📋 Found ${suggestedTests.length} suggested tests in RAG`);
      
      // Generate tests based on RAG knowledge
      const testCases = suggestedTests.map(test => ({
        name: test.name || `Test ${test.metadata?.uiLabel || 'Unknown'}`,
        dataField: test.metadata?.tsvField || 'unknown',
        uiSelector: test.metadata?.uiSelector || 'unknown',
        testValues: test.metadata?.sampleValues || ['test'],
        expectedCount: test.metadata?.expectedCount || 0,
        steps: this.generateTestSteps(test)
      }));
      
      console.log(`✅ Generated ${testCases.length} test cases from RAG`);
      
      return {
        success: true,
        testCases: testCases,
        statistics: {
          totalTestCases: testCases.length,
          mappingsUsed: ragMappings.length,
          source: 'rag-fallback'
        }
      };
      
    } catch (error: any) {
      console.error('❌ Test generation failed:', error);
      return {
        success: false,
        error: `Test generation failed: ${error.message}`
      };
    }
  }

  private generateTestSteps(test: any): any[] {
    // Generate test steps based on RAG knowledge
    return [
      {
        action: 'click',
        selector: test.metadata?.uiSelector || 'unknown',
        description: `Click on ${test.metadata?.uiLabel || 'element'}`
      },
      {
        action: 'select',
        value: test.metadata?.sampleValues?.[0] || 'test',
        description: `Select value "${test.metadata?.sampleValues?.[0] || 'test'}"`
      },
      {
        action: 'validate',
        expectedCount: test.metadata?.expectedCount || 0,
        description: `Validate result count matches expected ${test.metadata?.expectedCount || 0}`
      }
    ];
  }

  // Execute test cases method (required by express-server)
  async executeTestCases(testCaseIds: string[], options?: any, providedTestCases?: any[]): Promise<{success: boolean, results?: any, statistics?: any, error?: string}> {
    try {
      console.log('🚀 Executing test cases:', testCaseIds);
      
      // Get test cases - prioritize provided test cases, then learning results, then storage
      const testCases: any[] = [];
      let learningResults: any = null;
      
      // If test cases are provided directly, use them
      if (providedTestCases && Array.isArray(providedTestCases) && providedTestCases.length > 0) {
        console.log(`📋 Using ${providedTestCases.length} provided test cases`);
        // Match provided test cases with IDs
        for (const id of testCaseIds) {
          const testCase = providedTestCases.find(tc => tc.id === id);
          if (testCase) {
            testCases.push(testCase);
          } else {
            // Try to match by index
            const index = parseInt(id.replace('test-', '')) - 1;
            if (index >= 0 && index < providedTestCases.length) {
              testCases.push({
                ...providedTestCases[index],
                id: id
              });
            }
          }
        }
      }
      
      // If no test cases found yet, try to get from learning results
      if (testCases.length === 0) {
        try {
          // Try multiple ways to access learning results
          learningResults = (this.playwrightLearningOrchestrator as any).lastLearningResults || 
                           (this.playwrightLearningOrchestrator as any).getLearningResults?.() ||
                           (this.playwrightLearningOrchestrator as any).learningResults ||
                           null;
          
          // Also try to get from vectorRAG if available
          const vectorRAG = (this.playwrightLearningOrchestrator as any).vectorRAG;
          if (!learningResults && vectorRAG) {
            // Try to reconstruct from RAG metadata
            const tsvMetadata = vectorRAG.getTSVMetadata?.();
            if (tsvMetadata) {
              console.log('📊 Found TSV metadata, but no learning results');
            }
          }
        } catch (e) {
          console.warn('Could not access learning results:', e);
        }
        
        if (learningResults?.analysis?.mapping?.testCases) {
          const phase1TestCases = learningResults.analysis.mapping.testCases;
          for (const id of testCaseIds) {
            // Match by index or find by name/description
            const index = parseInt(id.replace('test-', '')) - 1;
            if (index >= 0 && index < phase1TestCases.length) {
              const testCase = phase1TestCases[index];
              // Ensure test case has required fields
              testCases.push({
                ...testCase,
                id: id,
                websiteUrl: testCase.websiteUrl || (this.playwrightLearningOrchestrator as any).currentWebsiteUrl || 'https://caninecommons.cancer.gov/#/explore'
              });
            }
          }
        }
      }
      
      // Fallback to storage if not found in learning results
      if (testCases.length === 0) {
        for (const id of testCaseIds) {
          const testCase = await this.storage.getTestCase(id);
          if (testCase) {
            testCases.push(testCase);
          }
        }
      }
      
      if (testCases.length === 0) {
        throw new Error('No test cases found for the provided IDs');
      }
      
      console.log(`📋 Found ${testCases.length} test cases to execute`);
      
      // Execute each test case
      const testResults: any[] = [];
      const startTime = Date.now();
      
      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const testCaseId = testCaseIds[i] || `test-${i + 1}`;
        const testStartTime = Date.now();
        
        try {
          console.log(`\n🧪 Executing test case ${i + 1}/${testCases.length}: ${testCase.name || testCaseId}`);
          
          // Get website URL from test case, orchestrator, or learning results
          const websiteUrl = testCase.websiteUrl || 
                            (this.playwrightLearningOrchestrator as any).currentWebsiteUrl ||
                            (learningResults as any)?.websiteUrl || 
                            'https://caninecommons.cancer.gov/#/explore';
          
          // Navigate to website
          console.log(`  📍 Navigating to: ${websiteUrl}`);
          await this.mcpClient.callTools([{
            id: `navigate-${testCaseId}`,
            name: 'playwright_navigate',
            parameters: { url: websiteUrl }
          }]);
          
          // Wait for page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Dismiss any modals/popups that might block test execution
          await this.dismissModals();
          
          // Execute test steps
          const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
          const selectors = testCase.selectors || {};
          const testValues = Array.isArray(testCase.testValues) ? testCase.testValues : [];
          
          console.log(`  📝 Executing ${steps.length} steps`);
          
          // Execute each step
          for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
            const step = steps[stepIndex];
            console.log(`    Step ${stepIndex + 1}: ${step}`);
            
            // Parse step to determine action
            if (step.toLowerCase().includes('navigate') || step.toLowerCase().includes('go to')) {
              // Already navigated, skip
              continue;
            } else if (step.toLowerCase().includes('click') || step.toLowerCase().includes('select')) {
              // Find selector for this action
              const selector = this.findSelectorForStep(selectors, step, testCase.dataField);
              if (selector) {
                try {
                  // Check if this is an expandable panel (like Diagnosis, Breed, etc.)
                  const panelCheck = await this.mcpClient.callTools([{
                    id: `check-panel-click-${testCaseId}-${stepIndex}`,
                    name: 'playwright_evaluate',
                    parameters: {
                      script: `(() => {
                        const el = document.querySelector('${selector}');
                        if (!el) return { isPanel: false, isExpanded: false };
                        const isPanel = el.getAttribute('aria-expanded') !== null || 
                                       el.className.includes('ExpansionPanel') ||
                                       el.className.includes('expansion');
                        return { 
                          isPanel: isPanel, 
                          isExpanded: el.getAttribute('aria-expanded') === 'true' 
                        };
                      })()`
                    }
                  }]);
                  
                  let isExpandablePanel = false;
                  let isExpanded = false;
                  if (panelCheck[0]?.result && Array.isArray(panelCheck[0].result)) {
                    const checkData = panelCheck[0].result.find((r: any) => r.type === 'text');
                    if (checkData?.text) {
                      try {
                        const parsed = JSON.parse(checkData.text);
                        isExpandablePanel = parsed.isPanel === true;
                        isExpanded = parsed.isExpanded === true;
                      } catch (e) {}
                    }
                  }
                  
                  if (isExpandablePanel) {
                    // It's an expandable panel
                    if (!isExpanded) {
                      // Expand it first
                      console.log(`    🔍 Detected expandable panel, expanding: ${selector}`);
                      await this.mcpClient.callTools([{
                        id: `expand-panel-click-${testCaseId}-${stepIndex}`,
                        name: 'playwright_evaluate',
                        parameters: {
                          script: `(() => {
                            const el = document.querySelector('${selector}');
                            if (el && el.getAttribute('aria-expanded') === 'false') {
                              el.click();
                              return { expanded: true };
                            }
                            return { expanded: false };
                          })()`
                        }
                      }]);
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      console.log(`    ✅ Panel expanded`);
                    }
                    
                    // If there's a test value in the step or testValues, try to find and click the checkbox
                    const stepLower = step.toLowerCase();
                    // Check if step contains "select" or has testValues - this indicates we should find a checkbox
                    const hasValueInStep = testValues.length > 0 || stepLower.includes('select');
                    
                    if (hasValueInStep && (isExpanded || !isExpanded)) {
                      // Find the value to select - check testValues first, then try to extract from step
                      let valueToSelect = testValues[0] || '';
                      if (!valueToSelect) {
                        // Try to extract value from step text (e.g., "Select Osteosarcoma" -> "Osteosarcoma")
                        const selectMatch = step.match(/select\s+(.+)/i);
                        if (selectMatch) {
                          valueToSelect = selectMatch[1].trim();
                        }
                      }
                      
                      if (valueToSelect) {
                        console.log(`    🔍 Looking for checkbox with value: ${valueToSelect}`);
                        // Find and click the checkbox with matching label
                        const checkboxResult = await this.mcpClient.callTools([{
                          id: `find-checkbox-click-${testCaseId}-${stepIndex}`,
                          name: 'playwright_evaluate',
                          parameters: {
                            script: `(() => {
                              const panel = document.querySelector('${selector}');
                              if (!panel) return { found: false };
                              
                              // Find expanded content area
                              const expandedContent = panel.closest('[id]')?.parentElement?.querySelector('[role="region"]') ||
                                                     panel.parentElement?.querySelector('[role="region"]');
                              if (!expandedContent) return { found: false };
                              
                              // Find checkbox with matching label text
                              const checkboxes = expandedContent.querySelectorAll('input[type="checkbox"]');
                              const searchValue = ${JSON.stringify(valueToSelect)};
                              
                              for (const cb of checkboxes) {
                                const row = cb.closest('div[role="button"]');
                                if (!row) continue;
                                
                                // Look for label in p.filter_by_casesNameUnChecked or similar
                                const labelEl = row.querySelector('p.filter_by_casesNameUnChecked, p[class*="filter_by_casesName"], p[class*="filter_by"]');
                                const labelText = labelEl ? labelEl.textContent?.trim() : '';
                                
                                // Match exact or partial (for values like "Osteosarcoma" matching "Osteosarcoma (123)")
                                if (labelText && (
                                  labelText === searchValue || 
                                  labelText.includes(searchValue) ||
                                  searchValue.includes(labelText.split('(')[0].trim())
                                )) {
                                  cb.click();
                                  return { found: true, clicked: true, label: labelText };
                                }
                              }
                              
                              return { found: false, clicked: false };
                            })()`
                          }
                        }]);
                        
                        if (checkboxResult[0]?.result && Array.isArray(checkboxResult[0].result)) {
                          const checkboxData = checkboxResult[0].result.find((r: any) => r.type === 'text');
                          if (checkboxData?.text) {
                            try {
                              const parsed = JSON.parse(checkboxData.text);
                              if (parsed.found && parsed.clicked) {
                                console.log(`    ✅ Selected checkbox: ${parsed.label || valueToSelect}`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                continue; // Success, move to next step
                              } else {
                                console.warn(`    ⚠️ Checkbox not found for value: ${valueToSelect}`);
                              }
                            } catch (e) {}
                          }
                        }
                      }
                    }
                    
                    // If no value to select or checkbox not found, just do a regular click
                    if (!hasValueInStep || !valueToSelect) {
                      await this.mcpClient.callTools([{
                        id: `click-${testCaseId}-${stepIndex}`,
                        name: 'playwright_click',
                        parameters: { selector: selector }
                      }]);
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                  } else {
                    // Regular click for non-panel elements
                    await this.mcpClient.callTools([{
                      id: `click-${testCaseId}-${stepIndex}`,
                      name: 'playwright_click',
                      parameters: { selector: selector }
                    }]);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  }
                } catch (error: any) {
                  console.warn(`    ⚠️ Click failed: ${error.message}`);
                }
              }
            } else if (step.toLowerCase().includes('fill') || step.toLowerCase().includes('enter') || step.toLowerCase().includes('input')) {
              // Find selector and value for fill action
              const selector = this.findSelectorForStep(selectors, step, testCase.dataField);
              const value = testValues[0] || '';
              if (selector && value) {
                try {
                  await this.mcpClient.callTools([{
                    id: `fill-${testCaseId}-${stepIndex}`,
                    name: 'playwright_fill',
                    parameters: { selector: selector, value: String(value) }
                  }]);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error: any) {
                  console.warn(`    ⚠️ Fill failed: ${error.message}`);
                }
              }
            } else if (step.toLowerCase().includes('filter') && testValues.length > 0) {
              // Filter action - handle expandable panels and dropdowns
              const selector = this.findSelectorForStep(selectors, step, testCase.dataField);
              if (selector) {
                for (const value of testValues) {
                  try {
                    // First, check if it's an expandable panel
                    const panelCheck = await this.mcpClient.callTools([{
                      id: `check-panel-${testCaseId}-${stepIndex}`,
                      name: 'playwright_evaluate',
                      parameters: {
                        script: `(() => {
                          const el = document.querySelector('${selector}');
                          if (!el) return { isPanel: false, isExpanded: false };
                          const isPanel = el.getAttribute('aria-expanded') !== null || 
                                         el.className.includes('ExpansionPanel') ||
                                         el.className.includes('expansion');
                          return { 
                            isPanel: isPanel, 
                            isExpanded: el.getAttribute('aria-expanded') === 'true' 
                          };
                        })()`
                      }
                    }]);
                    
                    let isExpandablePanel = false;
                    let isExpanded = false;
                    if (panelCheck[0]?.result && Array.isArray(panelCheck[0].result)) {
                      const checkData = panelCheck[0].result.find((r: any) => r.type === 'text');
                      if (checkData?.text) {
                        try {
                          const parsed = JSON.parse(checkData.text);
                          isExpandablePanel = parsed.isPanel === true;
                          isExpanded = parsed.isExpanded === true;
                        } catch (e) {}
                      }
                    }
                    
                    if (isExpandablePanel) {
                      // Handle expandable panel (like Diagnosis filter)
                      console.log(`    🔍 Handling expandable panel filter: ${selector}`);
                      
                      // Expand panel if not already expanded
                      if (!isExpanded) {
                        await this.mcpClient.callTools([{
                          id: `expand-panel-${testCaseId}-${stepIndex}`,
                          name: 'playwright_evaluate',
                          parameters: {
                            script: `(() => {
                              const el = document.querySelector('${selector}');
                              if (el && el.getAttribute('aria-expanded') === 'false') {
                                el.click();
                                return { expanded: true };
                              }
                              return { expanded: false };
                            })()`
                          }
                        }]);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                      }
                      
                      // Find and click the checkbox with matching label
                      const checkboxResult = await this.mcpClient.callTools([{
                        id: `find-checkbox-${testCaseId}-${stepIndex}`,
                        name: 'playwright_evaluate',
                        parameters: {
                          script: `(() => {
                            const panel = document.querySelector('${selector}');
                            if (!panel) return { found: false };
                            
                            // Find expanded content area
                            const expandedContent = panel.closest('[id]')?.parentElement?.querySelector('[role="region"]') ||
                                                   panel.parentElement?.querySelector('[role="region"]');
                            if (!expandedContent) return { found: false };
                            
                            // Find checkbox with matching label text
                            const checkboxes = expandedContent.querySelectorAll('input[type="checkbox"]');
                            const searchValue = ${JSON.stringify(value)};
                            
                            for (const cb of checkboxes) {
                              const row = cb.closest('div[role="button"]');
                              if (!row) continue;
                              
                              // Look for label in p.filter_by_casesNameUnChecked or similar
                              const labelEl = row.querySelector('p.filter_by_casesNameUnChecked, p[class*="filter_by_casesName"], p[class*="filter_by"]');
                              const labelText = labelEl ? labelEl.textContent?.trim() : '';
                              
                              // Match exact or partial (for values like "Osteosarcoma" matching "Osteosarcoma (123)")
                              if (labelText && (
                                labelText === searchValue || 
                                labelText.includes(searchValue) ||
                                searchValue.includes(labelText.split('(')[0].trim())
                              )) {
                                cb.click();
                                return { found: true, clicked: true, label: labelText };
                              }
                            }
                            
                            return { found: false, clicked: false };
                          })()`
                        }
                      }]);
                      
                      if (checkboxResult[0]?.result && Array.isArray(checkboxResult[0].result)) {
                        const checkboxData = checkboxResult[0].result.find((r: any) => r.type === 'text');
                        if (checkboxData?.text) {
                          try {
                            const parsed = JSON.parse(checkboxData.text);
                            if (parsed.found && parsed.clicked) {
                              console.log(`    ✅ Selected filter value: ${parsed.label || value}`);
                              await new Promise(resolve => setTimeout(resolve, 1000));
                              break; // Success, move to next value
                            }
                          } catch (e) {}
                        }
                      }
                      
                      console.warn(`    ⚠️ Could not find checkbox for value: ${value}`);
                    } else {
                      // Try standard dropdown selection
                      try {
                        await this.mcpClient.callTools([{
                          id: `select-${testCaseId}-${stepIndex}`,
                          name: 'playwright_select',
                          parameters: { selector: selector, value: String(value) }
                        }]);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        break; // Use first value
                      } catch (error: any) {
                        // Fallback: try simple click and text search
                        try {
                          await this.mcpClient.callTools([{
                            id: `click-filter-${testCaseId}-${stepIndex}`,
                            name: 'playwright_click',
                            parameters: { selector: selector }
                          }]);
                          await new Promise(resolve => setTimeout(resolve, 500));
                          
                          // Try to find and click the value option
                          await this.mcpClient.callTools([{
                            id: `select-value-${testCaseId}-${stepIndex}`,
                            name: 'playwright_evaluate',
                            parameters: {
                              script: `(() => {
                                const value = ${JSON.stringify(value)};
                                const elements = Array.from(document.querySelectorAll('*'));
                                for (const el of elements) {
                                  if (el.textContent && el.textContent.includes(value) && el.click) {
                                    el.click();
                                    return { clicked: true, value: value };
                                  }
                                }
                                return { clicked: false, value: value };
                              })()`
                            }
                          }]);
                          await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (e: any) {
                          console.warn(`    ⚠️ Filter selection failed: ${e.message}`);
                        }
                      }
                    }
                  } catch (error: any) {
                    console.warn(`    ⚠️ Filter action failed: ${error.message}`);
                  }
                }
              }
            }
          }
          
          // Wait for results to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Validate results
          const validation = await this.validateTestResults(testCase, learningResults);
          
          // Dismiss any modals before taking screenshot
          await this.dismissModals();
          
          // Capture screenshot and convert to base64 data URL
          let screenshot: string | null = null;
          try {
            const screenshotResult = await this.mcpClient.callTools([{
              id: `screenshot-${testCaseId}`,
              name: 'playwright_screenshot',
              parameters: {}
            }]);
            
            if (screenshotResult[0]?.result && Array.isArray(screenshotResult[0].result)) {
              // Extract file path from screenshot result
              const screenshotData = screenshotResult[0].result.find((r: any) => r.type === 'text');
              const screenshotText = screenshotData?.text || '';
              
              // Extract file path from text like "Screenshot saved to: ../Downloads/screenshot-..."
              const filePathMatch = screenshotText.match(/Screenshot saved to:\s*(.+)/);
              if (filePathMatch) {
                const filePath = filePathMatch[1].trim();
                try {
                  // Try multiple path resolution strategies
                  let absolutePath: string | null = null;
                  
                  // Strategy 1: If absolute, use as-is
                  if (path.isAbsolute(filePath)) {
                    absolutePath = filePath;
                  } else {
                    // Strategy 2: Try resolving from current working directory
                    absolutePath = path.resolve(process.cwd(), filePath);
                    if (!fs.existsSync(absolutePath)) {
                      // Strategy 3: Try resolving from home directory (common for Downloads)
                      const homePath = path.resolve(process.env.HOME || process.env.USERPROFILE || '', filePath.replace(/^\.\.\//, ''));
                      if (fs.existsSync(homePath)) {
                        absolutePath = homePath;
                      } else {
                        // Strategy 4: Try resolving from project root
                        const projectPath = path.resolve(__dirname, '../../', filePath);
                        if (fs.existsSync(projectPath)) {
                          absolutePath = projectPath;
                        }
                      }
                    }
                  }
                  
                  // Check if file exists and read it
                  if (absolutePath && fs.existsSync(absolutePath)) {
                    // Read file and convert to base64
                    const imageBuffer = fs.readFileSync(absolutePath);
                    const base64Image = imageBuffer.toString('base64');
                    const mimeType = 'image/png'; // Screenshots are typically PNG
                    screenshot = `data:${mimeType};base64,${base64Image}`;
                    console.log(`  📸 Screenshot converted to base64: ${absolutePath}`);
                  } else {
                    console.warn(`  ⚠️ Screenshot file not found. Tried: ${filePath}, resolved: ${absolutePath || 'N/A'}`);
                    // Store the file path as-is for debugging
                    screenshot = filePath;
                  }
                } catch (fileError: any) {
                  console.warn(`  ⚠️ Failed to read screenshot file: ${fileError.message}`);
                  // Store the file path as-is for debugging
                  screenshot = filePath;
                }
              } else {
                console.warn(`  ⚠️ Could not extract file path from screenshot result: ${screenshotText.substring(0, 100)}`);
              }
            }
          } catch (error: any) {
            console.warn(`    ⚠️ Screenshot capture failed: ${error.message}`);
          }
          
          const duration = Date.now() - testStartTime;
          const status = validation.passed ? 'passed' : 'failed';
          
          testResults.push({
            testCaseId: testCaseId,
            testCaseName: testCase.name || 'Unnamed Test',
            status: status,
            duration: duration,
            startTime: new Date(testStartTime).toISOString(),
            validation: validation,
            screenshots: screenshot ? [screenshot] : [],
            error: validation.passed ? undefined : validation.message
          });
          
          console.log(`  ✅ Test ${i + 1} ${status}: ${duration}ms`);
          
        } catch (error: any) {
          const duration = Date.now() - testStartTime;
          console.error(`  ❌ Test ${i + 1} failed:`, error.message);
          
          testResults.push({
            testCaseId: testCaseId,
            testCaseName: testCase.name || 'Unnamed Test',
            status: 'error',
            duration: duration,
            startTime: new Date(testStartTime).toISOString(),
            error: error.message,
            screenshots: []
          });
        }
      }
      
      const totalDuration = Date.now() - startTime;
      const passed = testResults.filter(r => r.status === 'passed').length;
      const failed = testResults.filter(r => r.status === 'failed' || r.status === 'error').length;
      
      console.log(`\n📊 Test execution complete: ${passed} passed, ${failed} failed in ${totalDuration}ms`);
      
      return {
        success: true,
        results: testResults, // Return as array
        statistics: {
          total: testResults.length,
          passed: passed,
          failed: failed,
          duration: totalDuration,
          runId: `run-${Date.now()}`
        }
      };
      
    } catch (error: any) {
      console.error('❌ Test execution failed:', error);
      return {
        success: false,
        error: `Test execution failed: ${error.message}`
      };
    }
  }

  private findSelectorForStep(selectors: any, step: string, dataField?: string): string | null {
    // If selectors is an object, try to find by field name
    if (typeof selectors === 'object' && selectors !== null && !Array.isArray(selectors)) {
      if (dataField && selectors[dataField]) {
        return selectors[dataField];
      }
      // Try to find by key matching step
      for (const [key, value] of Object.entries(selectors)) {
        if (step.toLowerCase().includes(key.toLowerCase())) {
          return value as string;
        }
      }
      // Return first value
      const firstKey = Object.keys(selectors)[0];
      return firstKey ? selectors[firstKey] as string : null;
    }
    
    // If selectors is an array, return first one
    if (Array.isArray(selectors) && selectors.length > 0) {
      return selectors[0];
    }
    
    return null;
  }

  private async validateTestResults(testCase: any, learningResults: any): Promise<any> {
    try {
      // Extract expected count from expectedResults
      const expectedResults = Array.isArray(testCase.expectedResults) ? testCase.expectedResults : [];
      let expectedCount = 0;
      
      // Parse expected results to find count
      for (const result of expectedResults) {
        const match = result.match(/(\d+)\s+cases\s+should\s+be\s+displayed/);
        if (match) {
          expectedCount = parseInt(match[1]);
          break;
        }
      }
      
      if (expectedCount === 0) {
        return {
          passed: true,
          expectedCount: 0,
          actualCount: 0,
          message: 'No expected count specified, validation skipped'
        };
      }
      
      // Get actual count from UI
      const actualCount = await this.getActualResultCount();
      
      const passed = actualCount === expectedCount;
      
      return {
        passed: passed,
        expectedCount: expectedCount,
        actualCount: actualCount,
        message: passed 
          ? `✅ Count matches: ${actualCount} cases displayed`
          : `❌ Count mismatch: Expected ${expectedCount}, got ${actualCount}`,
        validationChecks: {
          countMatch: {
            passed: passed,
            message: passed ? 'Count matches expected' : 'Count does not match expected'
          }
        }
      };
      
    } catch (error: any) {
      return {
        passed: false,
        expectedCount: 0,
        actualCount: 0,
        message: `Validation error: ${error.message}`
      };
    }
  }

  private async getActualResultCount(): Promise<number> {
    try {
      // Try to extract count from visible text
      const textResult = await this.mcpClient.callTools([{
        id: `get-text-${Date.now()}`,
        name: 'playwright_get_visible_text',
        parameters: {}
      }]);
      
      if (textResult[0]?.result && Array.isArray(textResult[0].result)) {
        const textData = textResult[0].result.find((r: any) => r.type === 'text');
        const text = textData?.text || '';
        
        // Try to find count patterns in text
        const countPatterns = [
          /(\d+)\s+results?/i,
          /showing\s+(\d+)/i,
          /(\d+)\s+items?/i,
          /(\d+)\s+cases?/i,
          /total[:\s]+(\d+)/i
        ];
        
        for (const pattern of countPatterns) {
          const match = text.match(pattern);
          if (match) {
            return parseInt(match[1]);
          }
        }
        
        // Try to count table rows
        const tableRowResult = await this.mcpClient.callTools([{
          id: `count-rows-${Date.now()}`,
            name: 'playwright_evaluate',
            parameters: {
            script: `(() => {
              const tables = document.querySelectorAll('table');
              if (tables.length > 0) {
                const rows = tables[0].querySelectorAll('tbody tr, tbody > tr');
                return rows.length;
              }
              return 0;
            })()`
        }
      }]);
        
        if (tableRowResult[0]?.result && Array.isArray(tableRowResult[0].result)) {
          const evalData = tableRowResult[0].result.find((r: any) => r.type === 'text');
          const count = parseInt(evalData?.text || '0');
          if (count > 0) {
            return count;
          }
        }
      }
      
      return 0;
    } catch (error: any) {
      console.warn('Failed to get actual result count:', error.message);
      return 0;
    }
  }

  /**
   * Dismiss any modals, popups, or banners that might block test execution
   * Looks for common modal patterns and dismiss buttons (Continue, Go, OK, Close, etc.)
   */
  private async dismissModals(): Promise<void> {
    try {
      console.log('  🔍 Checking for modals/popups to dismiss...');
      
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await this.mcpClient.callTools([{
          id: `dismiss-modals-${Date.now()}`,
          name: 'playwright_evaluate',
          parameters: {
            script: `(() => {
              // Find modals/popups/banners
              const modalSelectors = [
                '[role="dialog"]',
                '.MuiDialog-root',
                '.MuiDialog-container',
                '.modal',
                '.popup',
                '[class*="banner"]',
                '[class*="modal"]',
                '[class*="dialog"]',
                '[class*="popup"]'
              ];
              
              let modal = null;
              for (const selector of modalSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                  const style = window.getComputedStyle(el);
                  const isVisible = style.display !== 'none' && 
                                   style.visibility !== 'hidden' && 
                                   style.opacity !== '0' &&
                                   el.offsetWidth > 0 && 
                                   el.offsetHeight > 0;
                  if (isVisible) {
                    modal = el;
                    break;
                  }
                }
                if (modal) break;
              }
              
              if (!modal) {
                return { found: false, dismissed: false, message: 'No modal found' };
              }
              
              // Find dismiss buttons - look for common button texts
              const dismissTexts = ['Continue', 'Go', 'OK', 'Close', 'Dismiss', 'Got it', 'Got It', 'Got It!', 'I Understand', 'Accept', 'Agree'];
              const dismissSelectors = [
                'button',
                '[role="button"]',
                'a[role="button"]',
                '[class*="button"]',
                '[class*="Button"]'
              ];
              
              let button = null;
              
              // First, try to find button by text within modal
              for (const selector of dismissSelectors) {
                const buttons = modal.querySelectorAll(selector);
                for (const btn of buttons) {
                  const text = (btn.textContent || '').trim();
                  const ariaLabel = btn.getAttribute('aria-label') || '';
                  
                  // Check if button text matches dismiss texts
                  for (const dismissText of dismissTexts) {
                    if (text.toLowerCase().includes(dismissText.toLowerCase()) ||
                        ariaLabel.toLowerCase().includes(dismissText.toLowerCase()) ||
                        ariaLabel.toLowerCase().includes('close') ||
                        ariaLabel.toLowerCase().includes('dismiss')) {
                      button = btn;
                      break;
                    }
                  }
                  if (button) break;
                }
                if (button) break;
              }
              
              // If no button found by text, try aria-label patterns
              if (!button) {
                const ariaButtons = modal.querySelectorAll('[aria-label*="close"], [aria-label*="dismiss"], [aria-label*="continue"]');
                if (ariaButtons.length > 0) {
                  button = ariaButtons[0];
                }
              }
              
              // If still no button, try to find close icon (X button)
              if (!button) {
                const closeIcons = modal.querySelectorAll('[aria-label*="Close"], [class*="close"], [class*="Close"], [class*="icon-close"]');
                if (closeIcons.length > 0) {
                  button = closeIcons[0];
                }
              }
              
              if (button) {
                // Click the button using JavaScript (more reliable for modals)
                try {
                  button.click();
                  // Wait a bit for modal to start disappearing
                  return { found: true, dismissed: true, buttonText: (button.textContent || '').trim(), message: 'Modal dismissed' };
                } catch (e) {
                  return { found: true, dismissed: false, error: e.message, message: 'Failed to click button' };
                }
              }
              
              return { found: true, dismissed: false, message: 'Modal found but no dismiss button found' };
            })()`
          }
        }]);
        
        if (result[0]?.result && Array.isArray(result[0].result)) {
          const evalData = result[0].result.find((r: any) => r.type === 'text');
          if (evalData?.text) {
            try {
              const dismissResult = JSON.parse(evalData.text);
              if (dismissResult.found && dismissResult.dismissed) {
                console.log(`  ✅ Modal dismissed (attempt ${attempt}): ${dismissResult.buttonText || 'button clicked'}`);
                // Wait for modal to disappear
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Verify modal is gone
                const verifyResult = await this.mcpClient.callTools([{
                  id: `verify-modal-gone-${Date.now()}`,
                  name: 'playwright_evaluate',
                  parameters: {
                    script: `(() => {
                      const modals = document.querySelectorAll('[role="dialog"], .MuiDialog-root, .modal, [class*="banner"]');
                      for (const modal of modals) {
                        const style = window.getComputedStyle(modal);
                        const isVisible = style.display !== 'none' && 
                                         style.visibility !== 'hidden' && 
                                         style.opacity !== '0' &&
                                         modal.offsetWidth > 0 && 
                                         modal.offsetHeight > 0;
                        if (isVisible) {
                          return { gone: false };
                        }
                      }
                      return { gone: true };
                    })()`
                  }
                }]);
                
                if (verifyResult[0]?.result && Array.isArray(verifyResult[0].result)) {
                  const verifyData = verifyResult[0].result.find((r: any) => r.type === 'text');
                  if (verifyData?.text) {
                    const verify = JSON.parse(verifyData.text);
                    if (verify.gone) {
                      console.log('  ✅ Modal confirmed gone');
                      return; // Success - modal dismissed
                    }
                  }
                }
              } else if (dismissResult.found && !dismissResult.dismissed) {
                console.log(`  ⚠️ Modal found but could not dismiss (attempt ${attempt}): ${dismissResult.message}`);
                if (attempt < maxAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  continue; // Retry
                }
              } else if (!dismissResult.found) {
                // No modal found - we're done
                if (attempt === 1) {
                  console.log('  ✅ No modals found');
                }
                return;
              }
            } catch (parseError) {
              // If JSON parse fails, modal might still be there, continue to next attempt
              if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }
            }
          }
        }
        
        // If we've exhausted attempts, break
        if (attempt >= maxAttempts) {
          console.log(`  ⚠️ Could not dismiss modal after ${maxAttempts} attempts`);
          break;
        }
      }
    } catch (error: any) {
      console.warn(`  ⚠️ Error dismissing modals: ${error.message}`);
      // Don't throw - continue with test execution even if modal dismissal fails
    }
  }
}