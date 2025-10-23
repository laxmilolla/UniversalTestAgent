import { MCPPlaywrightClient } from '../chatbot/mcp-client';

export interface UIState {
    url: string;
    queryParams: { [key: string]: string };
    resultCount: number | null;
    resultCountText: string;
    dropdownStates: { [selector: string]: { isOpen: boolean; options: string[] } };
    tableRowCount: number;
    screenshotPath: string;
    timestamp: string;
}

export interface StateChanges {
    resultCount?: { before: number | null; after: number | null };
    cascadingFilters?: { [element: string]: any };
    newElements?: string[];
    urlChange?: { before: string; after: string };
    tableRowChange?: { before: number; after: number };
}

export class UIStateCapturer {
    constructor(private mcpClient: MCPPlaywrightClient) {}

    async captureState(): Promise<UIState> {
        console.log('📸 Capturing UI state...');
        
        try {
            // 1. Get current URL
            const url = this.getCurrentUrl();
            const queryParams = this.parseQueryParams(url);

            // 2. Get result count text
            const resultCountText = await this.getResultCountText();
            const resultCount = this.extractResultCount(resultCountText);

            // 3. Get dropdown states
            const dropdownStates = await this.getDropdownStates();

            // 4. Get table row count
            const tableRowCount = await this.getTableRowCount();

            // 5. Take screenshot
            const screenshotPath = await this.takeScreenshot();

            const state: UIState = {
                url,
                queryParams,
                resultCount,
                resultCountText,
                dropdownStates,
                tableRowCount,
                screenshotPath,
                timestamp: new Date().toISOString()
            };

            console.log(`✅ UI state captured: ${resultCountText}, ${tableRowCount} table rows, ${Object.keys(dropdownStates).length} dropdowns`);
            return state;

        } catch (error: any) {
            console.error('❌ Failed to capture UI state:', error);
            throw new Error(`UI state capture failed: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    detectChanges(before: UIState, after: UIState): StateChanges {
        console.log('🔍 Detecting state changes...');
        
        const changes: StateChanges = {};

        // Check result count change
        if (before.resultCount !== after.resultCount) {
            changes.resultCount = {
                before: before.resultCount,
                after: after.resultCount
            };
            console.log(`📊 Result count changed: ${before.resultCount} → ${after.resultCount}`);
        }

        // Check URL change
        if (before.url !== after.url) {
            changes.urlChange = {
                before: before.url,
                after: after.url
            };
            console.log(`🔗 URL changed: ${before.url} → ${after.url}`);
        }

        // Check table row count change
        if (before.tableRowCount !== after.tableRowCount) {
            changes.tableRowChange = {
                before: before.tableRowCount,
                after: after.tableRowCount
            };
            console.log(`📋 Table rows changed: ${before.tableRowCount} → ${after.tableRowCount}`);
        }

        // Check cascading filter changes
        const cascadingChanges: { [element: string]: any } = {};
        for (const [selector, beforeState] of Object.entries(before.dropdownStates)) {
            const afterState = after.dropdownStates[selector];
            if (beforeState.options.length !== afterState.options.length) {
                cascadingChanges[selector] = {
                    before: beforeState.options.length,
                    after: afterState.options.length,
                    optionsChanged: true
                };
                console.log(`🔄 Cascading change: ${selector} options ${beforeState.options.length} → ${afterState.options.length}`);
            }
        }
        
        if (Object.keys(cascadingChanges).length > 0) {
            changes.cascadingFilters = cascadingChanges;
        }

        console.log(`✅ Detected ${Object.keys(changes).length} changes`);
        return changes;
    }

    private async getResultCountText(): Promise<string> {
        try {
            // Look for common result count patterns
            const selectors = [
                '.result-count',
                '.total-count',
                '.count',
                '[class*="count"]',
                '[class*="result"]',
                'span:contains("results")',
                'div:contains("Showing")',
                'p:contains("results")'
            ];

            for (const selector of selectors) {
                try {
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
                        id: `get-count-${Date.now()}`
                    }]);
                    
                    const elements = result[0]?.result || [];
                    for (const element of elements) {
                        const text = element.textContent?.trim() || '';
                        if (text.match(/\d+.*result/i) || text.match(/showing.*\d+/i)) {
                            return text;
                        }
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }

            return 'No result count found';
        } catch (error) {
            return 'Error getting result count';
        }
    }

    private extractResultCount(text: string): number | null {
        const match = text.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    private async getDropdownStates(): Promise<{ [selector: string]: { isOpen: boolean; options: string[] } }> {
        const states: { [selector: string]: { isOpen: boolean; options: string[] } } = {};

        try {
            // Find all dropdown elements
            const dropdownSelectors = [
                'select',
                '[role="combobox"]',
                '.dropdown',
                '[class*="dropdown"]',
                '[class*="select"]'
            ];

            for (const selector of dropdownSelectors) {
                try {
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
                        id: `get-dropdowns-${Date.now()}`
                    }]);
                    
                    const elements = result[0]?.result || [];
                    for (const element of elements) {
                        const elementSelector = element.id ? `#${element.id}` : 
                                             element.className ? `.${element.className.split(' ')[0]}` : 
                                             `${selector}:nth-child(${elements.indexOf(element) + 1})`;
                        
                        // Get options
                        const options: string[] = [];
                        if (element.tagName === 'SELECT') {
                            const optionElements = element.querySelectorAll?.('option') || [];
                            for (const option of optionElements) {
                                const optionText = option.textContent?.trim();
                                if (optionText) {
                                    options.push(optionText);
                                }
                            }
                        }

                        states[elementSelector] = {
                            isOpen: false, // We'll detect this by checking aria-expanded or similar
                            options
                        };
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }
        } catch (error) {
            console.error('Error getting dropdown states:', error);
        }

        return states;
    }

    private async getTableRowCount(): Promise<number> {
        try {
            const result = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `Array.from(document.querySelectorAll('table tbody tr')).map(el => ({
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
                id: `get-table-rows-${Date.now()}`
            }]);
            
            return result[0]?.result?.length || 0;
        } catch (error) {
            return 0;
        }
    }

    private async takeScreenshot(): Promise<string> {
        try {
            const result = await this.mcpClient.callTools([{
                name: 'playwright_screenshot',
                parameters: {},
                id: `screenshot-${Date.now()}`
            }]);
            
            // Return the screenshot path/URL
            return result[0]?.result?.path || `screenshot-${Date.now()}.png`;
        } catch (error) {
            console.error('Error taking screenshot:', error);
            return `screenshot-error-${Date.now()}.png`;
        }
    }

    private getCurrentUrl(): string {
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

    private parseQueryParams(url: string): { [key: string]: string } {
        try {
            const urlObj = new URL(url);
            const params: { [key: string]: string } = {};
            urlObj.searchParams.forEach((value, key) => {
                params[key] = value;
            });
            return params;
        } catch (error) {
            return {};
        }
    }
}
