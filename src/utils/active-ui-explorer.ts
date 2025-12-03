import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { UIStateCapturer, UIState, StateChanges } from './ui-state-capturer';
import { VectorRAGClient } from './vector-rag-client';
import { BedrockClient } from '../chatbot/bedrock-client';

export interface UIExplorationResult {
    elementType: string;
    label: string;
    selector: string;
    allOptions: string[];
    sampledTests: Array<{
        option: string;
        changes: StateChanges;
    }>;
    // For checkboxes and radio buttons
    states?: Array<{
        state: string;
        changes: StateChanges;
    }>;
}

export interface DiscoveredElement {
    type: string;
    label: string;
    selector: string;
    text?: string;
    placeholder?: string;
    ariaLabel?: string;
}

export interface DiscoveredCheckbox extends DiscoveredElement {
    checked: boolean;
}

export interface DiscoveredRadioGroup {
    groupName: string;
    options: DiscoveredElement[];
}

export interface DiscoveredWithOptions extends DiscoveredElement {
    allOptions: string[];
    optionCount: number;
}

export interface PrioritizedDropdown extends DiscoveredWithOptions {
    priority: number;
    reason: string;
    tsvField: string;
}

export class ActiveUIExplorer {
    private readonly MAX_DROPDOWNS_TO_EXPLORE = 10;
    private readonly SAMPLES_PER_DROPDOWN = 5; // Increased from 2 to 5

    constructor(
        private mcpClient: MCPPlaywrightClient,
        private stateCapturer: UIStateCapturer,
        private vectorRAG: VectorRAGClient,
        private bedrockClient: BedrockClient
    ) {}

    async exploreAllElements(): Promise<UIExplorationResult[]> {
        console.log('🔍 Starting LLM-Guided Intelligent Exploration... [VERSION 3.0 - Enhanced]');
        
        const results: UIExplorationResult[] = [];
        
        try {
            // Phase 1: Fast discovery - find all UI elements and their options
            console.log('📋 Phase 1: Fast Discovery - START');
            const discoveredDropdowns = await this.discoverAllDropdownsWithOptions();
            console.log(`📋 Phase 1: COMPLETE - Found ${discoveredDropdowns.length} dropdowns`);
            
            const searchBoxes = await this.discoverSearchBoxes();
            console.log(`📋 Phase 1: COMPLETE - Found ${searchBoxes.length} search boxes`);
            
            const checkboxes = await this.discoverCheckboxes();
            console.log(`📋 Phase 1: COMPLETE - Found ${checkboxes.length} checkboxes`);
            
            const radioGroups = await this.discoverRadioButtons();
            console.log(`📋 Phase 1: COMPLETE - Found ${radioGroups.length} radio button groups`);
            
            // Phase 2: LLM prioritization - rank elements by TSV field relevance
            console.log('🧠 Phase 2: LLM Prioritization - START');
            let prioritized: PrioritizedDropdown[];
            try {
                prioritized = await this.prioritizeWithLLM(discoveredDropdowns);
                console.log(`🧠 Phase 2: COMPLETE - Prioritized ${prioritized.length} dropdowns`);
            } catch (error: any) {
                console.warn(`⚠️ LLM prioritization failed, using default priority: ${error.message}`);
                // Fallback: use dropdowns in original order
                prioritized = discoveredDropdowns.map((dropdown, index) => ({
                    ...dropdown,
                    priority: index + 1,
                    reason: 'Default priority due to LLM failure',
                    tsvField: 'unknown'
                }));
                console.log(`🧠 Phase 2: FALLBACK - Using ${prioritized.length} dropdowns with default priority`);
            }
            
            // Phase 3: Deep exploration of top priority only
            console.log('🎯 Phase 3: Targeted Exploration - START');
            const topPriority = prioritized.slice(0, this.MAX_DROPDOWNS_TO_EXPLORE);
            console.log(`🎯 Exploring top ${topPriority.length} priority dropdowns`);
            
            for (const dropdown of topPriority) {
                console.log(`🔍 Exploring priority dropdown: ${dropdown.label} (${dropdown.priority})`);
                const dropdownResult = await this.exploreDropdown(dropdown);
                results.push(dropdownResult);
                
                // Store in RAG immediately
                await this.vectorRAG.indexUIExplorationData([dropdownResult]);
                console.log(`✅ Stored ${dropdown.label} exploration in RAG`);
            }
            
            // Explore search boxes with dynamic TSV terms
            for (const searchBox of searchBoxes) {
                try {
                    console.log(`🔍 Exploring search box: ${searchBox.label}`);
                    const searchResult = await Promise.race([
                        this.exploreSearchBox(searchBox),
                        new Promise<UIExplorationResult>((_, reject) => 
                            setTimeout(() => reject(new Error('timeout')), 30000)
                        )
                    ]);
                    results.push(searchResult);
                    
                    await this.vectorRAG.indexUIExplorationData([searchResult]);
                    console.log(`✅ Stored ${searchBox.label} exploration in RAG`);
                } catch (error) {
                    console.warn(`⚠️ Skipping search box ${searchBox.label}: ${error.message}`);
                    continue;
                }
            }
            
            // Explore all checkboxes (fast - only 2 states each)
            for (const checkbox of checkboxes) {
                try {
                    console.log(`🔍 Exploring checkbox: ${checkbox.label}`);
                    const checkboxResult = await this.exploreCheckbox(checkbox);
                    results.push(checkboxResult);
                    
                    await this.vectorRAG.indexUIExplorationData([checkboxResult]);
                    console.log(`✅ Stored ${checkbox.label} exploration in RAG`);
                } catch (error) {
                    console.warn(`⚠️ Skipping checkbox ${checkbox.label}: ${error.message}`);
                    continue;
                }
            }
            
            // Explore all radio button groups
            for (const radioGroup of radioGroups) {
                try {
                    console.log(`🔍 Exploring radio group: ${radioGroup.groupName}`);
                    const radioResult = await this.exploreRadioGroup(radioGroup);
                    results.push(radioResult);
                    
                    await this.vectorRAG.indexUIExplorationData([radioResult]);
                    console.log(`✅ Stored ${radioGroup.groupName} exploration in RAG`);
                } catch (error) {
                    console.warn(`⚠️ Skipping radio group ${radioGroup.groupName}: ${error.message}`);
                    continue;
                }
            }
            
            console.log(`✅ Enhanced LLM-Guided Exploration COMPLETE: ${results.length} elements explored`);
            return results;
            
        } catch (error: any) {
            console.error('❌ Enhanced LLM-Guided exploration FAILED:', error);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Enhanced LLM-Guided exploration failed: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    async discoverAllDropdownsWithOptions(): Promise<DiscoveredWithOptions[]> {
        console.log('🔍 Fast discovery: Getting all dropdowns with their options...');
        const dropdowns = await this.discoverDropdowns();
        console.log(`📊 discoverDropdowns() returned ${dropdowns.length} dropdowns`);
        
        if (dropdowns.length === 0) {
            console.warn('⚠️ NO DROPDOWNS FOUND! Fast discovery will return empty results.');
        }
        
        const results: DiscoveredWithOptions[] = [];
        
        for (const dropdown of dropdowns) {
            try {
                // Just get options, don't test yet
                const options = await this.getDropdownOptions(dropdown.selector);
                results.push({
                    ...dropdown,
                    allOptions: options,
                    optionCount: options.length
                });
                console.log(`📋 ${dropdown.label}: ${options.length} options`);
            } catch (error) {
                console.warn(`⚠️ Could not get options for ${dropdown.label}: ${error.message}`);
                // Still add it with empty options
                results.push({
                    ...dropdown,
                    allOptions: [],
                    optionCount: 0
                });
            }
        }
        
        console.log(`✅ Fast discovery complete: ${results.length} dropdowns catalogued`);
        return results;
    }

    async prioritizeWithLLM(dropdowns: DiscoveredWithOptions[]): Promise<PrioritizedDropdown[]> {
        console.log('🧠 LLM prioritization: Analyzing dropdowns against TSV fields...');
        
        try {
            // Query RAG for TSV fields
            const tsvFields = await this.vectorRAG.queryTSVKnowledge(
                "List all TSV field names and their data types"
            );
            
            // Ask LLM to prioritize
            const prompt = `You are analyzing a data exploration website.

UI DROPDOWNS FOUND:
${dropdowns.map(d => `- ${d.label}: ${d.optionCount} options (${d.allOptions.slice(0, 3).join(', ')}...)`).join('\n')}

TSV DATABASE FIELDS:
${tsvFields.map(f => `- ${f.text}`).join('\n')}

TASK: Rank dropdowns by testing priority (1=highest).
Prioritize dropdowns that:
1. Map to TSV fields (semantic match)
2. Filter critical data (diagnosis, breed vs cosmetic filters)
3. Have reasonable option counts (5-50 options, not 1 or 500)

Return JSON array:
[
  {"label": "Breed", "priority": 1, "reason": "Maps to 'breed' TSV field, 20 options", "tsvField": "breed"},
  {"label": "Diagnosis", "priority": 2, "reason": "Maps to 'diagnosis', critical filter", "tsvField": "diagnosis"}
]`;

            const response = await this.bedrockClient.generateResponse([{
                role: 'user',
                content: prompt
            }], []);
            
            const prioritized = JSON.parse(response.content);
            
            // Sort by priority and return
            const sorted = prioritized.sort((a: any, b: any) => a.priority - b.priority);
            
            console.log(`✅ LLM prioritization complete: ${sorted.length} dropdowns ranked`);
            sorted.forEach((d: any, i: number) => {
                console.log(`  ${i + 1}. ${d.label} (${d.priority}): ${d.reason}`);
            });
            
            return sorted;
            
        } catch (error: any) {
            console.error('❌ LLM prioritization failed:', error);
            // Fallback: return dropdowns in original order with default priority
            return dropdowns.map((dropdown, index) => ({
                ...dropdown,
                priority: index + 1,
                reason: 'Default priority due to LLM failure',
                tsvField: 'unknown'
            }));
        }
    }

    async exploreDropdown(dropdown: DiscoveredElement): Promise<UIExplorationResult> {
        console.log(`🔍 Exploring dropdown: ${dropdown.label}`);
        
        try {
            // 1. Capture before state
            const before = await this.stateCapturer.captureState();
            
            // 2. Click dropdown to see all options
            await this.mcpClient.callTools([{
                name: 'playwright_click',
                parameters: { selector: dropdown.selector },
                id: `click-dropdown-${Date.now()}`
            }]);
            
            // Wait for dropdown to open
            await this.waitForStability();
            
            // 3. Get all available options
            const options = await this.getDropdownOptions(dropdown.selector);
            console.log(`📋 Found ${options.length} options: ${options.slice(0, 5).join(', ')}${options.length > 5 ? '...' : ''}`);
            
            // 4. Sample 2-3 options to test
            const samplesToTest = this.sampleOptions(options, this.SAMPLES_PER_DROPDOWN);
            console.log(`🎯 Testing samples: ${samplesToTest.join(', ')}`);
            
            const sampleResults = [];
            for (const option of samplesToTest) {
                console.log(`🔍 Testing option: ${option}`);
                
                // Select option
                await this.selectOption(dropdown.selector, option);
                
                // Wait for changes
                await this.waitForStability();
                
                // Capture after state
                const after = await this.stateCapturer.captureState();
                
                // Detect changes
                const changes = this.stateCapturer.detectChanges(before, after);
                
                sampleResults.push({ option, changes });
                
                console.log(`📊 Option "${option}" changes:`, changes);
                
                // Reset filter before next test
                await this.resetFilters();
                await this.waitForStability();
            }
            
            const result: UIExplorationResult = {
                elementType: 'dropdown',
                label: dropdown.label,
                selector: dropdown.selector,
                allOptions: options,
                sampledTests: sampleResults
            };
            
            console.log(`✅ Explored dropdown ${dropdown.label}: ${options.length} options, ${sampleResults.length} tests`);
            return result;
            
        } catch (error: any) {
            console.error(`❌ Failed to explore dropdown ${dropdown.label}:`, error);
            throw new Error(`Dropdown exploration failed for ${dropdown.label}: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    async exploreSearchBox(searchBox: DiscoveredElement): Promise<UIExplorationResult> {
        console.log(`🔍 Exploring search box: ${searchBox.label}`);
        
        try {
            const before = await this.stateCapturer.captureState();
            
            // Extract dynamic search terms from TSV data
            const sampleTerms = await this.extractSearchTermsFromTSV();
            const sampleResults = [];
            
            for (const term of sampleTerms) {
                console.log(`🔍 Testing search term: "${term}"`);
                
                // Type search term
                await this.mcpClient.callTools([{
                    name: 'playwright_fill',
                    parameters: { 
                        selector: searchBox.selector,
                        value: term 
                    },
                    id: `fill-search-${Date.now()}`
                }]);
                
                // Press Enter or click search
                await this.mcpClient.callTools([{
                    name: 'playwright_press_key',
                    parameters: { key: 'Enter' },
                    id: `press-enter-${Date.now()}`
                }]);
                
                await this.waitForStability();
                
                const after = await this.stateCapturer.captureState();
                const changes = this.stateCapturer.detectChanges(before, after);
                
                sampleResults.push({ option: term, changes });
                
                // Clear search
                await this.mcpClient.callTools([{
                    name: 'playwright_fill',
                    parameters: { 
                        selector: searchBox.selector,
                        value: '' 
                    },
                    id: `clear-search-${Date.now()}`
                }]);
                
                await this.waitForStability();
            }
            
            return {
                elementType: 'searchBox',
                label: searchBox.label,
                selector: searchBox.selector,
                allOptions: sampleTerms,
                sampledTests: sampleResults
            };
            
        } catch (error: any) {
            console.error(`❌ Failed to explore search box ${searchBox.label}:`, error);
            throw new Error(`Search box exploration failed for ${searchBox.label}: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    private async getCurrentUrl(): Promise<string> {
        try {
            const page = this.mcpClient.getPage();
            if (page && typeof page.url === 'function') {
                return page.url();
            }
            // Fallback: try to get URL from MCP tools if page not available
            return '';
        } catch (error) {
            console.error('Error getting current URL:', error);
            return '';
        }
    }

    private async discoverDropdowns(): Promise<DiscoveredElement[]> {
        console.log('🔍🔍🔍 discoverDropdowns() CALLED - Method entry point');
        const dropdowns: DiscoveredElement[] = [];
        
        console.log('🔍 discoverDropdowns(): Starting dropdown discovery...');
        
        try {
            console.log('🔍 discoverDropdowns(): Inside try block');
            // Target actual interactive dropdowns
            // Include broad selectors like UI state capturer but filter results
            const selectors = [
                'select', // Native HTML select
                '[role="combobox"]', // MUI/Ant Design dropdowns
                '[role="button"][aria-expanded]', // MUI Select components
                '.MuiSelect-select', // MUI specific
                '.MuiSelect-root', // MUI Select root
                '[class*="MuiSelect-select"]', // MUI Select variants
                '[class*="ant-select-selector"]', // Ant Design selector
                'button[data-toggle="dropdown"]', // Bootstrap dropdown triggers
                'button[aria-haspopup="listbox"]', // ARIA dropdown buttons
                '[class*="select"]', // Broad selector (will be filtered)
                '[class*="dropdown"]' // Broad selector (will be filtered)
            ];
            
            console.log(`🔍 Testing ${selectors.length} dropdown selectors...`);
            
            for (const selector of selectors) {
                console.log(`🔍 Testing selector: ${selector}`);
                const result = await this.mcpClient.callTools([{
                    name: 'playwright_evaluate',
                    parameters: { 
                        script: `Array.from(document.querySelectorAll('${selector}')).map(el => ({
                            tagName: el.tagName,
                            id: el.id,
                            className: el.className,
                            textContent: el.textContent?.trim(),
                            innerHTML: el.innerHTML,
                            attributes: Array.from(el.attributes).reduce((acc, attr) => {
                                acc[attr.name] = attr.value;
                                return acc;
                            }, {})
                        }))`
                    },
                    id: `discover-dropdowns-${Date.now()}`
                }]);
                    
                    // Parse MCP result format - use same approach as UI state capturer (which finds 20 dropdowns)
                    const elements = result[0]?.result || [];
                    console.log(`🔍 Selector "${selector}" - Raw result type: ${typeof result[0]?.result}, IsArray: ${Array.isArray(result[0]?.result)}, Length: ${Array.isArray(result[0]?.result) ? result[0].result.length : 'N/A'}`);
                    
                    console.log(`🔍 Selector "${selector}" found ${elements.length} elements`);
                    
                    for (const element of elements) {
                        const label = this.extractElementLabel(element);
                        const elementSelector = this.generateSelector(element, selector);
                        
                        // Log all elements found for debugging
                        console.log(`🔍 Element found: tagName=${element.tagName}, className=${element.className?.substring(0, 50)}, text=${element.textContent?.trim()?.substring(0, 30)}`);
                        
                        // Only process interactive dropdowns
                        const isInteractive = this.isInteractiveDropdown(element);
                        console.log(`   → isInteractive: ${isInteractive}`);
                        
                        if (!isInteractive) {
                            console.log(`⚠️ Skipped non-interactive element: ${element.textContent?.trim()?.substring(0, 50)}`);
                            continue;
                        }
                        
                        // Deduplicate: Check if we already have this dropdown (by selector or text)
                        const isDuplicate = dropdowns.some(d => 
                            d.selector === elementSelector || 
                            (d.text && element.textContent?.trim() && d.text === element.textContent.trim())
                        );
                        
                        if (isDuplicate) {
                            console.log(`⚠️ Skipped duplicate dropdown: ${label || elementSelector}`);
                            continue;
                        }
                        
                        dropdowns.push({
                            type: 'dropdown',
                            label: label || `Dropdown ${dropdowns.length + 1}`,
                            selector: elementSelector,
                            text: element.textContent?.trim(),
                            ariaLabel: element.attributes?.ariaLabel || element.attributes?.['aria-label']
                        });
                        console.log(`✅ Added dropdown ${dropdowns.length}: ${label || `Dropdown ${dropdowns.length}`} (${elementSelector})`);
                    }
                }
            
            console.log(`✅ discoverDropdowns(): Found ${dropdowns.length} total dropdowns`);
            
            // Print all discovered dropdowns for verification
            console.log('\n📋 ALL DISCOVERED DROPDOWNS:');
            dropdowns.forEach((dropdown, index) => {
                console.log(`  ${index + 1}. "${dropdown.label}"`);
                console.log(`     Selector: ${dropdown.selector}`);
                console.log(`     Text: ${dropdown.text?.substring(0, 50) || 'N/A'}`);
                console.log(`     Aria Label: ${dropdown.ariaLabel || 'N/A'}`);
            });
            console.log('');
            
            return dropdowns;
            
        } catch (error) {
            console.error('❌ discoverDropdowns() FAILED:', error);
            return [];
        }
    }

    private isInteractiveDropdown(element: any): boolean {
        // Skip obvious non-interactive elements (section headers, labels, etc.)
        const className = element.className || '';
        if (className.includes('dropdownIconTextWrapper') || 
            className.includes('facetSectionName') ||
            className.includes('facetHeader') ||
            (className.includes('header') && !className.includes('select') && !className.includes('dropdown'))) {
            return false;
        }
        
        const tagName = element.tagName?.toLowerCase();
        const role = element.attributes?.role;
        
        // Native select elements are always interactive
        if (tagName === 'select') {
            return true;
        }
        
        // Buttons are potentially interactive
        if (tagName === 'button') {
            return true;
        }
        
        // Elements with combobox or button role
        if (role === 'combobox' || role === 'button') {
            return true;
        }
        
        // MUI Select components
        if (className.includes('MuiSelect')) {
            return true;
        }
        
        // Ant Design select components
        if (className.includes('ant-select')) {
            return true;
        }
        
        // For broad selectors: accept div/span elements with select/dropdown in class
        // that might be interactive (will be tested during exploration)
        if ((className.includes('select') || className.includes('dropdown')) && 
            (tagName === 'div' || tagName === 'span')) {
            // Accept if it has interactive attributes or is clickable
            if (element.attributes?.['onclick'] ||
                element.attributes?.['tabindex'] !== undefined ||
                element.attributes?.['aria-expanded'] !== undefined) {
                return true;
            }
            // Also accept if it doesn't look like just text (has nested elements or specific structure)
            const hasNestedElements = element.innerHTML && 
                (element.innerHTML.includes('<svg') || 
                 element.innerHTML.includes('<input') ||
                 element.innerHTML.includes('class='));
            if (hasNestedElements) {
                return true;
            }
        }
        
        return false;
    }

    private async discoverSearchBoxes(): Promise<DiscoveredElement[]> {
        const searchBoxes: DiscoveredElement[] = [];
        
        try {
            const selectors = [
                'input[type="search"]',
                'input[type="text"]',
                'input[placeholder*="search"]',
                'input[placeholder*="Search"]',
                '.search-input',
                '.search-box'
            ];
            
            for (const selector of selectors) {
            const result = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `Array.from(document.querySelectorAll('${selector}')).map(el => ({
                        tagName: el.tagName,
                        id: el.id,
                        className: el.className,
                        textContent: el.textContent?.trim(),
                        innerHTML: el.innerHTML,
                        attributes: Array.from(el.attributes).reduce((acc, attr) => {
                            acc[attr.name] = attr.value;
                            return acc;
                        }, {})
                    }))`
                },
                id: `discover-search-${Date.now()}`
            }]);
                
                // Parse MCP result format - handle multiple possible formats
                let elements: any[] = [];
                if (!result || !result[0] || !result[0].result) {
                    console.warn(`⚠️ No result returned for search selector "${selector}"`);
                } else if (Array.isArray(result[0].result)) {
                    // Format 1: Result is directly an array (like UI state capturer uses)
                    elements = result[0].result;
                } else if (result[0].result?.content?.[0]?.text) {
                    // Format 2: Result is in content[0].text as JSON string
                    try {
                        elements = JSON.parse(result[0].result.content[0].text);
                    } catch (e) {
                        console.warn(`⚠️ Failed to parse JSON for search selector "${selector}":`, e);
                    }
                } else {
                    console.warn(`⚠️ Unexpected result format for search selector "${selector}":`, JSON.stringify(result[0].result).substring(0, 200));
                }
                
                for (const element of elements) {
                    const label = this.extractElementLabel(element);
                    const elementSelector = this.generateSelector(element, selector);
                    
                    searchBoxes.push({
                        type: 'searchBox',
                        label: label || `Search Box ${searchBoxes.length + 1}`,
                        selector: elementSelector,
                        placeholder: element.placeholder,
                        ariaLabel: element.getAttribute?.('aria-label')
                    });
                }
            }
        } catch (error) {
            console.error('Error discovering search boxes:', error);
        }
        
        return searchBoxes;
    }

    private async discoverFilters(): Promise<DiscoveredElement[]> {
        // For now, treat filters as dropdowns
        // This can be enhanced to detect other filter types
        return [];
    }

    private async getDropdownOptions(selector: string): Promise<string[]> {
        try {
            // First try to get options from native select elements
            const nativeResult = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `Array.from(document.querySelectorAll('${selector} option')).map(el => ({
                        tagName: el.tagName,
                        id: el.id,
                        className: el.className,
                        textContent: el.textContent?.trim(),
                        value: el.value,
                        attributes: Array.from(el.attributes).reduce((acc, attr) => {
                            acc[attr.name] = attr.value;
                            return acc;
                        }, {})
                    }))`
                },
                id: `get-native-options-${Date.now()}`
            }]);
            
            const nativeOptions: string[] = [];
            const nativeElements = nativeResult[0]?.result || [];
            
            for (const element of nativeElements) {
                const text = element.textContent?.trim();
                if (text && text !== '') {
                    nativeOptions.push(text);
                }
            }
            
            if (nativeOptions.length > 0) {
                return nativeOptions;
            }
            
            // If no native options, try to click dropdown and get MUI/Ant Design options
            console.log(`🔍 No native options found, trying to open dropdown for MUI/Ant Design...`);
            
            // Click to open dropdown
            await this.mcpClient.callTools([{
                name: 'playwright_click',
                parameters: { selector },
                id: `open-dropdown-${Date.now()}`
            }]);
            
            // Wait for dropdown to open
            await this.waitForStability();
            
            // Look for dropdown menu items
            const menuResult = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `Array.from(document.querySelectorAll('[role="option"], .MuiMenuItem-root, .ant-select-item, [class*="menu-item"], [class*="dropdown-item"]')).map(el => ({
                        tagName: el.tagName,
                        id: el.id,
                        className: el.className,
                        textContent: el.textContent?.trim(),
                        innerHTML: el.innerHTML,
                        attributes: Array.from(el.attributes).reduce((acc, attr) => {
                            acc[attr.name] = attr.value;
                            return acc;
                        }, {})
                    }))`
                },
                id: `get-menu-options-${Date.now()}`
            }]);
            
            const menuOptions: string[] = [];
            const menuElements = menuResult[0]?.result || [];
            
            for (const element of menuElements) {
                const text = element.textContent?.trim();
                if (text && text !== '' && text !== 'All' && text !== 'None') {
                    menuOptions.push(text);
                }
            }
            
            // Close dropdown by clicking outside or pressing Escape
            try {
                await this.mcpClient.callTools([{
                    name: 'playwright_press_key',
                    parameters: { key: 'Escape' },
                    id: `close-dropdown-${Date.now()}`
                }]);
            } catch (error) {
                // Ignore if escape doesn't work
            }
            
            return menuOptions;
            
        } catch (error) {
            console.error('Error getting dropdown options:', error);
            return [];
        }
    }

    private async selectOption(selector: string, option: string): Promise<void> {
        try {
            // First try native select option selection
            try {
                await this.mcpClient.callTools([{
                    name: 'playwright_click',
                    parameters: { 
                        selector: `${selector} option:contains("${option}")` 
                    },
                    id: `select-native-option-${Date.now()}`
                }]);
                return;
            } catch (error) {
                // Native selection failed, try MUI/Ant Design approach
            }
            
            // For MUI/Ant Design dropdowns: click dropdown, then click option
            console.log(`🔍 Selecting MUI/Ant Design option: "${option}"`);
            
            // Click dropdown to open
            await this.mcpClient.callTools([{
                name: 'playwright_click',
                parameters: { selector },
                id: `open-dropdown-for-select-${Date.now()}`
            }]);
            
            await this.waitForStability();
            
            // Look for the specific option and click it
            const optionSelectors = [
                `[role="option"]:contains("${option}")`,
                `.MuiMenuItem-root:contains("${option}")`,
                `.ant-select-item:contains("${option}")`,
                `[class*="menu-item"]:contains("${option}")`,
                `[class*="dropdown-item"]:contains("${option}")`
            ];
            
            for (const optionSelector of optionSelectors) {
                try {
                    await this.mcpClient.callTools([{
                        name: 'playwright_click',
                        parameters: { selector: optionSelector },
                        id: `select-option-${Date.now()}`
                    }]);
                    console.log(`✅ Selected option: "${option}"`);
                    return;
                } catch (error) {
                    // Try next selector
                }
            }
            
            console.warn(`⚠️ Could not select option "${option}" with any method`);
            
        } catch (error) {
            console.error(`Error selecting option "${option}":`, error);
        }
    }

    private async resetFilters(): Promise<void> {
        try {
            // Look for reset/clear buttons
            const resetSelectors = [
                'button[class*="reset"]',
                'button[class*="clear"]',
                'button:contains("Reset")',
                'button:contains("Clear")',
                '.reset-button',
                '.clear-button'
            ];
            
            for (const selector of resetSelectors) {
                try {
                    await this.mcpClient.callTools([{
                        name: 'playwright_click',
                        parameters: { selector },
                        id: `reset-filters-${Date.now()}`
                    }]);
                    console.log('🔄 Reset filters clicked');
                    return;
                } catch (error) {
                    // Continue to next selector
                }
            }
            
            // If no reset button, try to clear search boxes
            const searchBoxes = await this.discoverSearchBoxes();
            for (const searchBox of searchBoxes) {
                try {
                    await this.mcpClient.callTools([{
                        name: 'playwright_fill',
                        parameters: { 
                            selector: searchBox.selector,
                            value: '' 
                        },
                        id: `clear-search-${Date.now()}`
                    }]);
                } catch (error) {
                    // Continue
                }
            }
            
        } catch (error) {
            console.error('Error resetting filters:', error);
        }
    }

    private sampleOptions(options: string[], count: number): string[] {
        if (options.length <= count) {
            return options;
        }
        
        // Intelligent sampling: first, last, 2 random middle, 1 TSV match
        const samples = new Set<string>();
        
        // Always include first option
        samples.add(options[0]);
        
        // Always include last option
        samples.add(options[options.length - 1]);
        
        // Add 2 random middle options
        const middleStart = Math.floor(options.length * 0.25);
        const middleEnd = Math.floor(options.length * 0.75);
        for (let i = 0; i < 2 && samples.size < count; i++) {
            const randomIndex = middleStart + Math.floor(Math.random() * (middleEnd - middleStart));
            samples.add(options[randomIndex]);
        }
        
        // Try to find one option that might match TSV data (simple heuristic)
        // Look for common categorical values
        const categoricalPatterns = [
            /male|female/i,
            /yes|no/i,
            /active|inactive/i,
            /enabled|disabled/i,
            /public|private/i,
            /open|closed/i
        ];
        
        for (const option of options) {
            if (samples.size >= count) break;
            
            for (const pattern of categoricalPatterns) {
                if (pattern.test(option) && !samples.has(option)) {
                    samples.add(option);
                    break;
                }
            }
        }
        
        // Fill remaining slots with random options if needed
        while (samples.size < count && samples.size < options.length) {
            const randomIndex = Math.floor(Math.random() * options.length);
            samples.add(options[randomIndex]);
        }
        
        return Array.from(samples);
    }

    private async waitForStability(): Promise<void> {
        // Wait for UI to stabilize after interactions
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    private extractElementLabel(element: any): string {
        // Try to get label from various sources
        const ariaLabel = element.getAttribute?.('aria-label');
        if (ariaLabel) return ariaLabel;
        
        const placeholder = element.placeholder;
        if (placeholder) return placeholder;
        
        const text = element.textContent?.trim();
        if (text && text.length < 50) return text;
        
        // Look for associated label
        const id = element.id;
        if (id) {
            // This would need to be implemented with additional DOM queries
            return `Element with ID ${id}`;
        }
        
        return '';
    }

    private generateSelector(element: any, baseSelector: string): string {
        if (element.id) {
            return `#${element.id}`;
        }
        
        if (element.className) {
            const firstClass = element.className.split(' ')[0];
            return `.${firstClass}`;
        }
        
        return baseSelector;
    }

    // ===== NEW METHODS FOR CHECKBOX AND RADIO BUTTON SUPPORT =====

    async discoverCheckboxes(): Promise<DiscoveredCheckbox[]> {
        console.log('🔍 Discovering checkboxes...');
        
        const checkboxSelectors = [
            'input[type="checkbox"]',
            '[role="checkbox"]',
            '.MuiCheckbox-root',
            '[class*="ant-checkbox"]',
            '[class*="checkbox"]'
        ];
        
        const checkboxes: DiscoveredCheckbox[] = [];
        
        for (const selector of checkboxSelectors) {
            try {
                const result = await this.mcpClient.callTools([{
                    name: 'playwright_evaluate',
                    parameters: {
                        script: `
                            Array.from(document.querySelectorAll('${selector}')).map(el => ({
                                selector: '${selector}',
                                label: el.getAttribute('aria-label') || 
                                       el.getAttribute('title') || 
                                       el.closest('label')?.textContent?.trim() ||
                                       el.parentElement?.textContent?.trim() ||
                                       'Checkbox',
                                checked: el.checked || el.getAttribute('aria-checked') === 'true',
                                id: el.id,
                                className: el.className
                            }))
                        `
                    },
                    id: `discover-checkboxes-${Date.now()}`
                }]);
                
                if (result[0]?.result?.content && result[0].result.content[0]?.text) {
                    const elements = JSON.parse(result[0].result.content[0].text);
                    elements.forEach((el: any) => {
                        const checkbox: DiscoveredCheckbox = {
                            type: 'checkbox',
                            label: el.label,
                            selector: el.id ? `#${el.id}` : `${selector}:nth-child(${checkboxes.length + 1})`,
                            checked: el.checked
                        };
                        checkboxes.push(checkbox);
                    });
                }
            } catch (error) {
                console.warn(`⚠️ Failed to discover checkboxes with selector ${selector}:`, error);
            }
        }
        
        console.log(`✅ Discovered ${checkboxes.length} checkboxes`);
        return checkboxes;
    }

    async discoverRadioButtons(): Promise<DiscoveredRadioGroup[]> {
        console.log('🔍 Discovering radio button groups...');
        
        const radioSelectors = [
            'input[type="radio"]',
            '[role="radio"]',
            '.MuiRadio-root',
            '[class*="ant-radio"]',
            '[class*="radio"]'
        ];
        
        const radioGroups: DiscoveredRadioGroup[] = [];
        const processedGroups = new Set<string>();
        
        for (const selector of radioSelectors) {
            try {
                const result = await this.mcpClient.callTools([{
                    name: 'playwright_evaluate',
                    parameters: {
                        script: `
                            Array.from(document.querySelectorAll('${selector}')).map(el => ({
                                selector: '${selector}',
                                label: el.getAttribute('aria-label') || 
                                       el.getAttribute('title') || 
                                       el.closest('label')?.textContent?.trim() ||
                                       el.parentElement?.textContent?.trim() ||
                                       'Radio Option',
                                name: el.name || el.getAttribute('name') || 'unnamed',
                                value: el.value || el.getAttribute('value') || '',
                                checked: el.checked || el.getAttribute('aria-checked') === 'true',
                                id: el.id,
                                className: el.className
                            }))
                        `
                    },
                    id: `discover-radios-${Date.now()}`
                }]);
                
                if (result[0]?.result?.content && result[0].result.content[0]?.text) {
                    const elements = JSON.parse(result[0].result.content[0].text);
                    
                    // Group by name attribute
                    const groups: { [key: string]: any[] } = {};
                    elements.forEach((el: any) => {
                        const groupName = el.name || 'unnamed';
                        if (!groups[groupName]) {
                            groups[groupName] = [];
                        }
                        groups[groupName].push(el);
                    });
                    
                    // Create radio groups
                    Object.entries(groups).forEach(([groupName, options]) => {
                        if (!processedGroups.has(groupName) && options.length > 1) {
                            const radioGroup: DiscoveredRadioGroup = {
                                groupName: groupName,
                                options: options.map((el: any, index: number) => ({
                                    type: 'radio',
                                    label: el.label,
                                    selector: el.id ? `#${el.id}` : `${selector}:nth-child(${index + 1})`,
                                    text: el.value
                                }))
                            };
                            radioGroups.push(radioGroup);
                            processedGroups.add(groupName);
                        }
                    });
                }
            } catch (error) {
                console.warn(`⚠️ Failed to discover radio buttons with selector ${selector}:`, error);
            }
        }
        
        console.log(`✅ Discovered ${radioGroups.length} radio button groups`);
        return radioGroups;
    }

    async exploreCheckbox(checkbox: DiscoveredCheckbox): Promise<UIExplorationResult> {
        console.log(`🔍 Exploring checkbox: ${checkbox.label}`);
        
        try {
            const states = [];
            
            // Test unchecked state (if currently checked)
            if (checkbox.checked) {
                console.log(`🔍 Testing unchecked state for ${checkbox.label}`);
                const beforeUncheck = await this.stateCapturer.captureState();
                
                await this.mcpClient.callTools([{
                    name: 'playwright_click',
                    parameters: { selector: checkbox.selector },
                    id: `uncheck-${Date.now()}`
                }]);
                
                await this.waitForStability();
                const afterUncheck = await this.stateCapturer.captureState();
                const uncheckChanges = this.stateCapturer.detectChanges(beforeUncheck, afterUncheck);
                
                states.push({
                    state: 'unchecked',
                    changes: uncheckChanges
                });
                
                console.log(`📊 Unchecked changes:`, uncheckChanges);
            }
            
            // Test checked state
            console.log(`🔍 Testing checked state for ${checkbox.label}`);
            const beforeCheck = await this.stateCapturer.captureState();
            
            await this.mcpClient.callTools([{
                name: 'playwright_click',
                parameters: { selector: checkbox.selector },
                id: `check-${Date.now()}`
            }]);
            
            await this.waitForStability();
            const afterCheck = await this.stateCapturer.captureState();
            const checkChanges = this.stateCapturer.detectChanges(beforeCheck, afterCheck);
            
            states.push({
                state: 'checked',
                changes: checkChanges
            });
            
            console.log(`📊 Checked changes:`, checkChanges);
            
            const result: UIExplorationResult = {
                elementType: 'checkbox',
                label: checkbox.label,
                selector: checkbox.selector,
                allOptions: ['checked', 'unchecked'],
                sampledTests: [], // Not used for checkboxes
                states: states
            };
            
            console.log(`✅ Explored checkbox ${checkbox.label}: ${states.length} states tested`);
            return result;
            
        } catch (error: any) {
            console.error(`❌ Failed to explore checkbox ${checkbox.label}:`, error);
            throw new Error(`Checkbox exploration failed for ${checkbox.label}: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    async exploreRadioGroup(radioGroup: DiscoveredRadioGroup): Promise<UIExplorationResult> {
        console.log(`🔍 Exploring radio group: ${radioGroup.groupName}`);
        
        try {
            const sampledTests = [];
            
            for (const option of radioGroup.options) {
                console.log(`🔍 Testing radio option: ${option.label}`);
                
                const before = await this.stateCapturer.captureState();
                
                await this.mcpClient.callTools([{
                    name: 'playwright_click',
                    parameters: { selector: option.selector },
                    id: `radio-${Date.now()}`
                }]);
                
                await this.waitForStability();
                const after = await this.stateCapturer.captureState();
                const changes = this.stateCapturer.detectChanges(before, after);
                
                sampledTests.push({
                    option: option.label,
                    changes: changes
                });
                
                console.log(`📊 Radio option "${option.label}" changes:`, changes);
            }
            
            const result: UIExplorationResult = {
                elementType: 'radio',
                label: radioGroup.groupName,
                selector: radioGroup.options[0]?.selector || '',
                allOptions: radioGroup.options.map(opt => opt.label),
                sampledTests: sampledTests
            };
            
            console.log(`✅ Explored radio group ${radioGroup.groupName}: ${sampledTests.length} options tested`);
            return result;
            
        } catch (error: any) {
            console.error(`❌ Failed to explore radio group ${radioGroup.groupName}:`, error);
            throw new Error(`Radio group exploration failed for ${radioGroup.groupName}: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    async extractSearchTermsFromTSV(): Promise<string[]> {
        console.log('🔍 Extracting search terms from TSV data...');
        
        try {
            // Query RAG for TSV field values
            const tsvKnowledge = await this.vectorRAG.queryTSVKnowledge('What are all the string and categorical field values in the TSV data?');
            
            if (!tsvKnowledge || tsvKnowledge.length === 0) {
                throw new Error('No TSV data available in RAG for search term extraction. NO FALLBACK AVAILABLE.');
            }
            
            // Extract diverse sample values
            const searchTerms = new Set<string>();
            
            for (const knowledge of tsvKnowledge) {
                // Handle flat TSV records (actual structure found in logs)
                if (!knowledge.metadata && !knowledge.records && knowledge['type']) {
                    // Extract string/categorical values from flat record
                    Object.values(knowledge).forEach((value: any) => {
                        if (typeof value === 'string' && value.length > 0 && value.length < 50) {
                            // Skip IDs, codes, and very long values
                            if (!value.match(/^[A-Z0-9_-]+$/) && !value.includes('http')) {
                                searchTerms.add(value.trim());
                            }
                        }
                    });
                }
                // Handle records array structure (if it exists)
                else if (knowledge.metadata?.type === 'tsv_record' && knowledge.records) {
                    // Extract string/categorical values from records
                    knowledge.records.forEach((record: any) => {
                        Object.values(record).forEach((value: any) => {
                            if (typeof value === 'string' && value.length > 0 && value.length < 50) {
                                // Skip IDs, codes, and very long values
                                if (!value.match(/^[A-Z0-9_-]+$/) && !value.includes('http')) {
                                    searchTerms.add(value.trim());
                                }
                            }
                        });
                    });
                }
            }
            
            // Convert to array and take 3-5 diverse samples
            const terms = Array.from(searchTerms).slice(0, 5);
            
            if (terms.length === 0) {
                throw new Error('No suitable search terms found in TSV data. NO FALLBACK AVAILABLE.');
            }
            
            console.log(`✅ Extracted ${terms.length} search terms: ${terms.join(', ')}`);
            return terms;
            
        } catch (error: any) {
            console.error(`❌ Failed to extract search terms from TSV:`, error);
            throw new Error(`Search term extraction failed: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }
}
