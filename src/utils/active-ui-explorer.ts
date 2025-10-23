import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { UIStateCapturer, UIState, StateChanges } from './ui-state-capturer';
import { VectorRAGClient } from './vector-rag-client';

export interface UIExplorationResult {
    elementType: string;
    label: string;
    selector: string;
    allOptions: string[];
    sampledTests: Array<{
        option: string;
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

export class ActiveUIExplorer {
    constructor(
        private mcpClient: MCPPlaywrightClient,
        private stateCapturer: UIStateCapturer,
        private vectorRAG: VectorRAGClient
    ) {}

    async exploreAllElements(): Promise<UIExplorationResult[]> {
        console.log('🔍 Starting Active UI Exploration...');
        
        const results: UIExplorationResult[] = [];
        
        try {
            // 1. Discover all interactive elements
            const dropdowns = await this.discoverDropdowns();
            const searchBoxes = await this.discoverSearchBoxes();
            const filters = await this.discoverFilters();
            
            console.log(`📋 Discovered: ${dropdowns.length} dropdowns, ${searchBoxes.length} search boxes, ${filters.length} filters`);
            
            // 2. Explore each dropdown (hybrid: sample 2-3 options)
            for (const dropdown of dropdowns) {
                console.log(`🔍 Exploring dropdown: ${dropdown.label}`);
                const dropdownResult = await this.exploreDropdown(dropdown);
                results.push(dropdownResult);
                
                // Store in RAG immediately
                await this.vectorRAG.indexUIExplorationData([dropdownResult]);
                console.log(`✅ Stored ${dropdown.label} exploration in RAG`);
            }
            
            // 3. Explore search boxes
            for (const searchBox of searchBoxes) {
                console.log(`🔍 Exploring search box: ${searchBox.label}`);
                const searchResult = await this.exploreSearchBox(searchBox);
                results.push(searchResult);
                
                await this.vectorRAG.indexUIExplorationData([searchResult]);
                console.log(`✅ Stored ${searchBox.label} exploration in RAG`);
            }
            
            console.log(`✅ Explored ${results.length} UI elements total`);
            return results;
            
        } catch (error: any) {
            console.error('❌ Active UI exploration failed:', error);
            throw new Error(`Active UI exploration failed: ${error.message}. NO FALLBACK AVAILABLE.`);
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
            const samplesToTest = this.sampleOptions(options, 2);
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
            
            // Test with sample search terms
            const sampleTerms = ['test', 'sample', 'data'];
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
        const dropdowns: DiscoveredElement[] = [];
        
        try {
            const selectors = [
                'select',
                '[role="combobox"]',
                '.dropdown',
                '[class*="dropdown"]',
                '[class*="select"]'
            ];
            
            for (const selector of selectors) {
            const result = await this.mcpClient.callTools([{
                name: 'query_selector_all',
                parameters: { selector },
                id: `discover-dropdowns-${Date.now()}`
            }]);
                
                const elements = result[0]?.result || [];
                for (const element of elements) {
                    const label = this.extractElementLabel(element);
                    const elementSelector = this.generateSelector(element, selector);
                    
                    dropdowns.push({
                        type: 'dropdown',
                        label: label || `Dropdown ${dropdowns.length + 1}`,
                        selector: elementSelector,
                        text: element.textContent?.trim(),
                        ariaLabel: element.getAttribute?.('aria-label')
                    });
                }
            }
        } catch (error) {
            console.error('Error discovering dropdowns:', error);
        }
        
        return dropdowns;
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
                name: 'query_selector_all',
                parameters: { selector },
                id: `discover-search-${Date.now()}`
            }]);
                
                const elements = result[0]?.result || [];
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
            const result = await this.mcpClient.callTools([{
                name: 'query_selector_all',
                parameters: { selector: `${selector} option` },
                id: `get-options-${Date.now()}`
            }]);
            
            const options: string[] = [];
            const elements = result[0]?.result || [];
            
            for (const element of elements) {
                const text = element.textContent?.trim();
                if (text && text !== '') {
                    options.push(text);
                }
            }
            
            return options;
        } catch (error) {
            console.error('Error getting dropdown options:', error);
            return [];
        }
    }

    private async selectOption(selector: string, option: string): Promise<void> {
        try {
            // Try to select by option text
            await this.mcpClient.callTools([{
                name: 'playwright_click',
                parameters: { 
                    selector: `${selector} option:contains("${option}")` 
                },
                id: `select-option-${Date.now()}`
            }]);
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
        
        // Take first few options as samples
        return options.slice(0, count);
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
}
