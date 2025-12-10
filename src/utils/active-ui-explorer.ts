import { MCPPlaywrightClient } from '../chatbot/mcp-client';
import { UIStateCapturer, UIState, StateChanges } from './ui-state-capturer';
import { VectorRAGClient } from './vector-rag-client';
import { BedrockClient } from '../chatbot/bedrock-client';

// Option with selector for expandable panel checkboxes
export interface OptionWithSelector {
    label: string;
    selector: string;
    index: number;
}

// Type for options: can be strings (legacy) or objects with selectors (new)
export type DropdownOption = string | OptionWithSelector;

export interface UIExplorationResult {
    elementType: string;
    label: string;
    selector: string;
    allOptions: DropdownOption[];
    optionSelectors?: Map<string, string>; // Map of label -> selector for quick lookup
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
    allOptions: DropdownOption[];
    optionCount: number;
    optionSelectors?: Map<string, string>; // Map of label -> selector
}

export interface PrioritizedDropdown extends DiscoveredWithOptions {
    priority: number;
    reason: string;
    tsvField: string;
}

// Helper functions to work with DropdownOption
export function getOptionLabel(option: DropdownOption): string {
    return typeof option === 'string' ? option : option.label;
}

export function getOptionSelector(option: DropdownOption, panelSelector?: string): string | null {
    if (typeof option === 'string') {
        return null; // No selector for legacy string format
    }
    return option.selector;
}

export function normalizeOptions(options: DropdownOption[]): string[] {
    return options.map(getOptionLabel);
}

export function buildOptionSelectorMap(options: DropdownOption[], panelSelector?: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const option of options) {
        const label = getOptionLabel(option);
        const selector = getOptionSelector(option, panelSelector);
        if (selector) {
            map.set(label, selector);
        }
    }
    return map;
}

export class ActiveUIExplorer {
    private readonly MAX_DROPDOWNS_TO_EXPLORE = 7; // Reduced from 10 to prevent timeout
    private readonly SAMPLES_PER_DROPDOWN = 3; // Reduced from 5 to 3 to prevent timeout

    constructor(
        private mcpClient: MCPPlaywrightClient,
        private stateCapturer: UIStateCapturer,
        private vectorRAG: VectorRAGClient,
        private bedrockClient: BedrockClient,
        private studyFilterInfo: {studyName: string, panelSelector: string, checkboxLabel: string} | null = null
    ) {}

    // TSV-Driven: Focused filter panel exploration using TSV columns as source of truth
    async exploreFilterPanelByTSVColumns(tsvColumns: string[], panelSelector: string): Promise<UIExplorationResult[]> {
        console.log('🎯 TSV-Driven Focused Exploration: Filter Panel');
        console.log(`📊 TSV Columns: ${tsvColumns.join(', ')}`);
        console.log(`🎯 Panel Selector: ${panelSelector}`);
        
        const results: UIExplorationResult[] = [];
        
        try {
            // Step 1: Find the filter panel
            const panelResult = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: {
                    script: `(() => {
                        const panel = document.querySelector(${JSON.stringify(panelSelector)});
                        if (!panel) return { found: false, selector: null };
                        return { found: true, selector: ${JSON.stringify(panelSelector)} };
                    })()`
                },
                id: `find-filter-panel-${Date.now()}`
            }]);
            
            if (!panelResult[0]?.success || !JSON.parse(panelResult[0].result[0].text).found) {
                console.warn(`⚠️ Filter panel not found with selector: ${panelSelector}`);
                return results;
            }
            
            console.log(`✅ Filter panel found: ${panelSelector}`);
            
            // Step 2: For each TSV column, find matching UI filter in panel
            for (const tsvColumn of tsvColumns) {
                console.log(`\n🔍 Looking for UI filter matching TSV column: "${tsvColumn}"`);
                
                // Find matching filter element using direct name matching
                const matchingFilter = await this.findMatchingFilter(tsvColumn, panelSelector);
                
                if (matchingFilter) {
                    console.log(`✅ Found matching filter: ${matchingFilter.label} (${matchingFilter.type})`);
                    
                    // Explore this filter based on its type
                    let explorationResult: UIExplorationResult | null = null;
                    
                    if (matchingFilter.type === 'dropdown') {
                        explorationResult = await this.exploreDropdown(matchingFilter);
                    } else if (matchingFilter.type === 'checkbox') {
                        // Convert to DiscoveredCheckbox format
                        const checkbox: DiscoveredCheckbox = {
                            ...matchingFilter,
                            checked: (matchingFilter as any).checked || false
                        };
                        explorationResult = await this.exploreCheckbox(checkbox);
                    } else if (matchingFilter.type === 'searchBox') {
                        explorationResult = await this.exploreSearchBox(matchingFilter);
                    } else if (matchingFilter.type === 'radio') {
                        // For radio groups, we need to find all options first
                        // For now, skip radio groups in TSV-driven mode (can be enhanced later)
                        console.log(`⚠️ Radio group exploration not yet implemented in TSV-driven mode`);
                        continue;
                    }
                    
                    if (explorationResult) {
                        // Add TSV column mapping to result
                        (explorationResult as any).tsvColumn = tsvColumn;
                        results.push(explorationResult);
                    }
                } else {
                    console.log(`⚠️ No UI filter found matching TSV column: "${tsvColumn}"`);
                }
            }
            
            console.log(`\n✅ TSV-Driven Exploration Complete: ${results.length} filters matched and explored`);
            return results;
            
        } catch (error: any) {
            console.error('❌ TSV-Driven exploration failed:', error);
            throw new Error(`TSV-Driven exploration failed: ${error.message}`);
        }
    }

    // TSV-Driven: Find UI filter matching TSV column name (direct fuzzy matching)
    private async findMatchingFilter(tsvColumn: string, panelSelector: string): Promise<(DiscoveredElement & { type: string, checked?: boolean }) | null> {
        try {
            const result = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: {
                    script: `(() => {
                        const panel = document.querySelector(${JSON.stringify(panelSelector)});
                        if (!panel) return { found: false };
                        
                        const tsvColumn = ${JSON.stringify(tsvColumn.toLowerCase())};
                        
                        // Normalize TSV column name for matching
                        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
                        const normalizedTSV = normalize(tsvColumn);
                        
                        // Search for dropdowns, checkboxes, search boxes, radio groups
                        const allElements = [];
                        
                        // 1. Check dropdowns (expandable panels with options)
                        const dropdownPanels = panel.querySelectorAll('div.customExpansionPanelSummaryRoot[role="button"]');
                        for (const panel of dropdownPanels) {
                            const label = panel.textContent?.trim() || '';
                            const normalizedLabel = normalize(label);
                            
                            // Fuzzy match: exact, contains, or similar
                            if (normalizedLabel.includes(normalizedTSV) || 
                                normalizedTSV.includes(normalizedLabel) ||
                                normalizedLabel === normalizedTSV) {
                                allElements.push({
                                    type: 'dropdown',
                                    label: label,
                                    selector: panel.id ? '#' + panel.id : null,
                                    text: label
                                });
                            }
                        }
                        
                        // 2. Check checkboxes
                        const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
                        for (const cb of checkboxes) {
                            const row = cb.closest('div[role="button"]');
                            if (!row) continue;
                            
                            const nameDiv = row.querySelector('div.filter_by_casesNameUnChecked, div[class*="filter_by_casesName"]');
                            const labelEl = nameDiv ? nameDiv.querySelector('p') : null;
                            const label = labelEl ? labelEl.textContent?.trim() : '';
                            
                            if (!label) continue;
                            
                            const normalizedLabel = normalize(label);
                            if (normalizedLabel.includes(normalizedTSV) || 
                                normalizedTSV.includes(normalizedLabel) ||
                                normalizedLabel === normalizedTSV) {
                                allElements.push({
                                    type: 'checkbox',
                                    label: label,
                                    selector: cb.id ? '#' + cb.id : null,
                                    text: label,
                                    checked: cb.checked
                                });
                            }
                        }
                        
                        // 3. Check search boxes
                        const searchBoxes = panel.querySelectorAll('input[type="text"], input[type="search"]');
                        for (const sb of searchBoxes) {
                            const label = sb.getAttribute('placeholder') || 
                                         sb.getAttribute('aria-label') || 
                                         sb.closest('label')?.textContent?.trim() || '';
                            
                            if (!label) continue;
                            
                            const normalizedLabel = normalize(label);
                            if (normalizedLabel.includes(normalizedTSV) || 
                                normalizedTSV.includes(normalizedLabel) ||
                                normalizedLabel === normalizedTSV) {
                                allElements.push({
                                    type: 'searchBox',
                                    label: label,
                                    selector: sb.id ? '#' + sb.id : 'input[type="' + sb.type + '"]',
                                    text: label,
                                    placeholder: sb.getAttribute('placeholder') || ''
                                });
                            }
                        }
                        
                        // Return first match (prioritize dropdowns)
                        const dropdownMatch = allElements.find(e => e.type === 'dropdown');
                        if (dropdownMatch) return { found: true, filter: dropdownMatch };
                        if (allElements.length > 0) return { found: true, filter: allElements[0] };
                        
                        return { found: false };
                    })()`
                },
                id: `find-matching-filter-${Date.now()}`
            }]);
            
            if (result[0]?.success && result[0].result?.[0]?.text) {
                const parsed = JSON.parse(result[0].result[0].text);
                if (parsed.found && parsed.filter) {
                    // Convert to DiscoveredElement format
                    const filter = parsed.filter;
                    return {
                        type: filter.type,
                        label: filter.label,
                        selector: filter.selector || this.generateFilterSelector(filter.type, filter.label),
                        text: filter.text,
                        placeholder: filter.placeholder,
                        ariaLabel: filter.ariaLabel
                    } as DiscoveredElement;
                }
            }
            
            return null;
        } catch (error: any) {
            console.error(`❌ Error finding matching filter for "${tsvColumn}":`, error);
            return null;
        }
    }

    // Helper: Generate selector if not provided (TSV-driven specific)
    private generateFilterSelector(type: string, label: string): string {
        const normalized = label.toLowerCase().replace(/[^a-z0-9]/g, '-');
        if (type === 'dropdown') {
            return `div[role="button"]:has-text("${label}")`;
        } else if (type === 'checkbox') {
            return `input[type="checkbox"]`;
        } else if (type === 'searchBox') {
            return `input[type="text"], input[type="search"]`;
        }
        return '';
    }

    // TSV-Driven: Match discovered filters to TSV columns using fuzzy label matching
    private matchFiltersToTSVColumns(
        dropdowns: DiscoveredWithOptions[],
        searchBoxes: DiscoveredElement[],
        checkboxes: DiscoveredCheckbox[],
        radioGroups: DiscoveredRadioGroup[],
        tsvColumns: string[]
    ): {
        dropdowns: DiscoveredWithOptions[];
        searchBoxes: DiscoveredElement[];
        checkboxes: DiscoveredCheckbox[];
        radioGroups: DiscoveredRadioGroup[];
    } {
        console.log(`🎯 Matching filters to TSV columns: ${tsvColumns.join(', ')}`);
        
        // Normalize function for fuzzy matching
        const normalize = (str: string): string => {
            return str.toLowerCase().replace(/[^a-z0-9]/g, '');
        };
        
        // Match function: checks if filter label matches TSV column
        const matchesTSVColumn = (filterLabel: string, tsvColumn: string): boolean => {
            const normalizedLabel = normalize(filterLabel);
            const normalizedColumn = normalize(tsvColumn);
            
            // Check for exact match, contains, or partial match
            return normalizedLabel === normalizedColumn ||
                   normalizedLabel.includes(normalizedColumn) ||
                   normalizedColumn.includes(normalizedLabel);
        };
        
        // Match dropdowns
        const matchedDropdowns = dropdowns.filter(dropdown => {
            const matches = tsvColumns.some(col => matchesTSVColumn(dropdown.label, col));
            if (matches) {
                const matchedColumn = tsvColumns.find(col => matchesTSVColumn(dropdown.label, col));
                console.log(`  ✓ Matched dropdown "${dropdown.label}" ↔ TSV column "${matchedColumn}"`);
            } else {
                console.log(`  ✗ Skipped dropdown "${dropdown.label}" (no TSV match)`);
            }
            return matches;
        });
        
        // Match search boxes
        const matchedSearchBoxes = searchBoxes.filter(searchBox => {
            const matches = tsvColumns.some(col => matchesTSVColumn(searchBox.label || searchBox.placeholder || '', col));
            if (matches) {
                const matchedColumn = tsvColumns.find(col => matchesTSVColumn(searchBox.label || searchBox.placeholder || '', col));
                console.log(`  ✓ Matched search box "${searchBox.label || searchBox.placeholder}" ↔ TSV column "${matchedColumn}"`);
            } else {
                console.log(`  ✗ Skipped search box "${searchBox.label || searchBox.placeholder}" (no TSV match)`);
            }
            return matches;
        });
        
        // Match checkboxes
        const matchedCheckboxes = checkboxes.filter(checkbox => {
            const matches = tsvColumns.some(col => matchesTSVColumn(checkbox.label, col));
            if (matches) {
                const matchedColumn = tsvColumns.find(col => matchesTSVColumn(checkbox.label, col));
                console.log(`  ✓ Matched checkbox "${checkbox.label}" ↔ TSV column "${matchedColumn}"`);
            } else {
                console.log(`  ✗ Skipped checkbox "${checkbox.label}" (no TSV match)`);
            }
            return matches;
        });
        
        // Match radio groups (match by group name)
        const matchedRadioGroups = radioGroups.filter(radioGroup => {
            const matches = tsvColumns.some(col => matchesTSVColumn(radioGroup.groupName, col));
            if (matches) {
                const matchedColumn = tsvColumns.find(col => matchesTSVColumn(radioGroup.groupName, col));
                console.log(`  ✓ Matched radio group "${radioGroup.groupName}" ↔ TSV column "${matchedColumn}"`);
            } else {
                console.log(`  ✗ Skipped radio group "${radioGroup.groupName}" (no TSV match)`);
            }
            return matches;
        });
        
        console.log(`\n📊 Matching Summary:`);
        console.log(`  Dropdowns: ${matchedDropdowns.length}/${dropdowns.length} matched`);
        console.log(`  Search Boxes: ${matchedSearchBoxes.length}/${searchBoxes.length} matched`);
        console.log(`  Checkboxes: ${matchedCheckboxes.length}/${checkboxes.length} matched`);
        console.log(`  Radio Groups: ${matchedRadioGroups.length}/${radioGroups.length} matched`);
        
        return {
            dropdowns: matchedDropdowns,
            searchBoxes: matchedSearchBoxes,
            checkboxes: matchedCheckboxes,
            radioGroups: matchedRadioGroups
        };
    }

    async exploreAllElements(tsvColumns: string[] = []): Promise<UIExplorationResult[]> {
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
            
            // TSV-Driven: Match discovered filters to TSV columns
            let matchedFilters: {
                dropdowns: DiscoveredWithOptions[];
                searchBoxes: DiscoveredElement[];
                checkboxes: DiscoveredCheckbox[];
                radioGroups: DiscoveredRadioGroup[];
            } = {
                dropdowns: discoveredDropdowns,
                searchBoxes: searchBoxes,
                checkboxes: checkboxes,
                radioGroups: radioGroups
            };
            
            // Create a map of dropdown labels to TSV columns for filling in null values
            const dropdownToTSVMap = new Map<string, string>();
            
            if (tsvColumns.length > 0) {
                console.log(`🎯 TSV-Driven: Matching ${tsvColumns.length} TSV columns to discovered filters...`);
                matchedFilters = this.matchFiltersToTSVColumns(
                    discoveredDropdowns,
                    searchBoxes,
                    checkboxes,
                    radioGroups,
                    tsvColumns
                );
                console.log(`✅ TSV-Driven: ${matchedFilters.dropdowns.length} dropdowns, ${matchedFilters.searchBoxes.length} search boxes, ${matchedFilters.checkboxes.length} checkboxes matched`);
                
                // Build mapping of dropdown labels to TSV columns
                const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
                matchedFilters.dropdowns.forEach(dropdown => {
                    const matchedCol = tsvColumns.find(col => {
                        const normalizedLabel = normalize(dropdown.label);
                        const normalizedCol = normalize(col);
                        return normalizedLabel.includes(normalizedCol) || normalizedCol.includes(normalizedLabel);
                    });
                    if (matchedCol) {
                        dropdownToTSVMap.set(dropdown.label, matchedCol);
                    }
                });
            } else {
                console.log('🔍 No TSV columns provided, exploring all discovered filters');
            }
            
            // Phase 2: LLM prioritization - rank elements by TSV field relevance (only for matched dropdowns)
            console.log('🧠 Phase 2: LLM Prioritization - START');
            // NO FALLBACK - let error propagate if prioritization fails
            const prioritized = await this.prioritizeWithLLM(matchedFilters.dropdowns, dropdownToTSVMap);
            console.log(`🧠 Phase 2: COMPLETE - Prioritized ${prioritized.length} dropdowns`);
            
            // Convert ALL discovered elements to results format (not just matched ones)
            // This ensures UI elements are always shown, even if they don't match TSV columns
            // Matched elements will be explored in Phase 3, but all discovered elements should be returned
            for (const dropdown of discoveredDropdowns) {
                results.push({
                    elementType: 'dropdown',
                    label: dropdown.label,
                    selector: dropdown.selector,
                    allOptions: dropdown.allOptions,
                    sampledTests: [] // Will be populated in Phase 3 if time permits
                });
            }
            for (const searchBox of searchBoxes) {
                results.push({
                    elementType: 'searchBox',
                    label: searchBox.label,
                    selector: searchBox.selector,
                    allOptions: [],
                    sampledTests: []
                });
            }
            for (const checkbox of checkboxes) {
                results.push({
                    elementType: 'checkbox',
                    label: checkbox.label,
                    selector: checkbox.selector,
                    allOptions: ['checked', 'unchecked'],
                    sampledTests: [],
                    states: []
                });
            }
            for (const radioGroup of radioGroups) {
                results.push({
                    elementType: 'radio',
                    label: radioGroup.groupName,
                    selector: radioGroup.options[0]?.selector || '',
                    allOptions: radioGroup.options.map(o => o.label),
                    sampledTests: [],
                    states: []
                });
            }
            console.log(`✅ Converted ${results.length} discovered elements to results format (${matchedFilters.dropdowns.length} dropdowns, ${matchedFilters.searchBoxes.length} search boxes matched to TSV)`);
            
            // Phase 3: Deep exploration of top priority only (enhances existing results)
            console.log('🎯 Phase 3: Targeted Exploration - START');
            const topPriority = prioritized.slice(0, this.MAX_DROPDOWNS_TO_EXPLORE);
            console.log(`🎯 Exploring top ${topPriority.length} priority dropdowns`);
            
            // Update results with detailed exploration (if time permits)
            // Skip dropdowns with 0 options to save time
            const dropdownsToExplore = topPriority.filter(d => d.optionCount > 0);
            console.log(`🎯 Skipping ${topPriority.length - dropdownsToExplore.length} empty dropdowns, exploring ${dropdownsToExplore.length} with options`);
            
            for (const dropdown of dropdownsToExplore) {
                try {
                    console.log(`🔍 Exploring priority dropdown: ${dropdown.label} (${dropdown.priority}) - ${dropdown.optionCount} options`);
                    const dropdownResult = await this.exploreDropdown(dropdown);
                    
                    // Update the existing result with detailed exploration
                    const existingIndex = results.findIndex(r => r.label === dropdown.label && r.elementType === 'dropdown');
                    if (existingIndex >= 0) {
                        results[existingIndex] = dropdownResult;
                    } else {
                        results.push(dropdownResult);
                    }
                    
                    // Store in RAG immediately
                    await this.vectorRAG.indexUIExplorationData([dropdownResult]);
                    console.log(`✅ Stored ${dropdown.label} exploration in RAG`);
                } catch (error: any) {
                    console.warn(`⚠️ Could not complete detailed exploration for ${dropdown.label}: ${error.message}`);
                    // Keep the basic result from Phase 1
                    continue;
                }
            }
            
            // Explore search boxes with dynamic TSV terms (updates existing results)
            for (const searchBox of matchedFilters.searchBoxes) {
                try {
                    console.log(`🔍 Exploring search box: ${searchBox.label}`);
                    const searchResult = await Promise.race([
                        this.exploreSearchBox(searchBox),
                        new Promise<UIExplorationResult>((_, reject) => 
                            setTimeout(() => reject(new Error('timeout')), 30000)
                        )
                    ]);
                    
                    // Update existing result
                    const existingIndex = results.findIndex(r => r.label === searchBox.label && r.elementType === 'searchBox');
                    if (existingIndex >= 0) {
                        results[existingIndex] = searchResult;
                    }
                    
                    await this.vectorRAG.indexUIExplorationData([searchResult]);
                    console.log(`✅ Stored ${searchBox.label} exploration in RAG`);
                } catch (error) {
                    console.warn(`⚠️ Could not complete detailed exploration for search box ${searchBox.label}: ${error.message}`);
                    // Keep the basic result from Phase 1
                    continue;
                }
            }
            
            // Explore all checkboxes (fast - only 2 states each) (updates existing results)
            for (const checkbox of matchedFilters.checkboxes) {
                try {
                    console.log(`🔍 Exploring checkbox: ${checkbox.label}`);
                    const checkboxResult = await this.exploreCheckbox(checkbox);
                    
                    // Update existing result
                    const existingIndex = results.findIndex(r => r.label === checkbox.label && r.elementType === 'checkbox');
                    if (existingIndex >= 0) {
                        results[existingIndex] = checkboxResult;
                    }
                    
                    await this.vectorRAG.indexUIExplorationData([checkboxResult]);
                    console.log(`✅ Stored ${checkbox.label} exploration in RAG`);
                } catch (error) {
                    console.warn(`⚠️ Could not complete detailed exploration for checkbox ${checkbox.label}: ${error.message}`);
                    // Keep the basic result from Phase 1
                    continue;
                }
            }
            
            // Explore all radio button groups (updates existing results)
            for (const radioGroup of matchedFilters.radioGroups) {
                try {
                    console.log(`🔍 Exploring radio group: ${radioGroup.groupName}`);
                    const radioResult = await this.exploreRadioGroup(radioGroup);
                    
                    // Update existing result
                    const existingIndex = results.findIndex(r => r.label === radioGroup.groupName && r.elementType === 'radio');
                    if (existingIndex >= 0) {
                        results[existingIndex] = radioResult;
                    }
                    
                    await this.vectorRAG.indexUIExplorationData([radioResult]);
                    console.log(`✅ Stored ${radioGroup.groupName} exploration in RAG`);
                } catch (error) {
                    console.warn(`⚠️ Could not complete detailed exploration for radio group ${radioGroup.groupName}: ${error.message}`);
                    // Keep the basic result from Phase 1
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
                // Ensure selector is a string
                if (typeof dropdown.selector !== 'string') {
                    console.error(`❌ Invalid selector for dropdown "${dropdown.label}":`, dropdown.selector);
                    console.error(`   Selector type: ${typeof dropdown.selector}`);
                    // Skip this dropdown
                    continue;
                }
                
                // Just get options, don't test yet - with timeout to prevent blocking
                const options = await Promise.race([
                    this.getDropdownOptions(dropdown.selector),
                    new Promise<DropdownOption[]>((_, reject) => 
                        setTimeout(() => reject(new Error('timeout')), 10000) // 10 second timeout per dropdown
                    )
                ]);
                
                // Normalize options to handle both string[] and OptionWithSelector[]
                const normalizedOptions: DropdownOption[] = Array.isArray(options) ? options : [];
                const optionSelectors = buildOptionSelectorMap(normalizedOptions, dropdown.selector);
                
                results.push({
                    ...dropdown,
                    allOptions: normalizedOptions,
                    optionCount: normalizedOptions.length,
                    optionSelectors: optionSelectors.size > 0 ? optionSelectors : undefined
                });
                console.log(`📋 ${dropdown.label}: ${normalizedOptions.length} options`);
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

    /**
     * Extract JSON from text that may contain explanatory text before/after JSON
     */
    private extractJSON(text: string): any {
        // Try to find JSON array or object in the text
        const jsonMatch = text.match(/\[[\s\S]*\]|{[\s\S]*}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) {
                // If parsing fails, try the whole text
                try {
                    return JSON.parse(text);
                } catch (e2) {
                    throw new Error(`Failed to parse JSON from LLM response. First 200 chars: ${text.substring(0, 200)}. NO FALLBACK AVAILABLE.`);
                }
            }
        }
        // If no JSON found, throw error (no fallback)
        throw new Error(`No JSON found in LLM response. Response: ${text.substring(0, 200)}. NO FALLBACK AVAILABLE.`);
    }

    async prioritizeWithLLM(dropdowns: DiscoveredWithOptions[], dropdownToTSVMap?: Map<string, string>): Promise<PrioritizedDropdown[]> {
        console.log('🧠 LLM prioritization: Analyzing dropdowns against TSV fields...');
        
        try {
            // Use TSV metadata directly instead of RAG query (more reliable)
            const tsvMetadata = this.vectorRAG.getTSVMetadata();
            if (!tsvMetadata || Object.keys(tsvMetadata).length === 0) {
                throw new Error('TSV metadata is empty. Cannot prioritize dropdowns. NO FALLBACK AVAILABLE.');
            }
            
            // Extract all field names from TSV metadata
            const tsvFields = Object.keys(tsvMetadata).flatMap(fileName => 
                (tsvMetadata[fileName].headers || []).map((header: string) => ({
                    text: header,
                    fileName: fileName
                }))
            );
            
            if (tsvFields.length === 0) {
                throw new Error('RAG query returned 0 TSV fields. Cannot prioritize dropdowns. NO FALLBACK AVAILABLE.');
            }
            
            console.log(`📊 Using ${tsvFields.length} TSV fields from metadata for prioritization`);
            
            // Ask LLM to prioritize
            const prompt = `You are analyzing a data exploration website.

UI DROPDOWNS FOUND:
${dropdowns.map(d => {
    const optionLabels = normalizeOptions(d.allOptions);
    return `- ${d.label}: ${d.optionCount} options (${optionLabels.slice(0, 3).join(', ')}...)`;
}).join('\n')}

TSV DATABASE FIELDS:
${tsvFields.map(f => `- ${f.text}`).join('\n')}

TASK: Rank dropdowns by testing priority (1=highest).
Prioritize dropdowns that:
1. Map to TSV fields (semantic match)
2. Filter critical data (diagnosis, breed vs cosmetic filters)
3. Have reasonable option counts (5-50 options, not 1 or 500)

IMPORTANT: Return ONLY a valid JSON array, no explanatory text before or after.
For each dropdown, include the tsvField that it maps to (use null if no match).

Example format:
[
  {"label": "Breed", "priority": 1, "reason": "Maps to 'breed' TSV field, 20 options", "tsvField": "breed"},
  {"label": "Diagnosis", "priority": 2, "reason": "Maps to 'diagnosis', critical filter", "tsvField": "diagnosis"}
]`;

            const response = await this.bedrockClient.generateResponse([{
                role: 'user',
                content: prompt
            }], []);
            
            // Extract JSON from response (may contain explanatory text)
            const prioritized = this.extractJSON(response.content);
            
            // Validate it's an array
            if (!Array.isArray(prioritized)) {
                throw new Error('LLM response is not a JSON array');
            }
            
            // Fill in null tsvField values using the TSV column mapping
            if (dropdownToTSVMap) {
                for (const item of prioritized) {
                    if (!item.tsvField || item.tsvField === null || item.tsvField === 'null') {
                        const mappedTSV = dropdownToTSVMap.get(item.label);
                        if (mappedTSV) {
                            item.tsvField = mappedTSV;
                            console.log(`  ✓ Filled in tsvField for "${item.label}": ${mappedTSV}`);
                        } else {
                            item.tsvField = 'unknown';
                        }
                    }
                }
            } else {
                // If no mapping provided, set unknown for null values
                for (const item of prioritized) {
                    if (!item.tsvField || item.tsvField === null || item.tsvField === 'null') {
                        item.tsvField = 'unknown';
                    }
                }
            }
            
            // Sort by priority and return
            const sorted = prioritized.sort((a: any, b: any) => a.priority - b.priority);
            
            console.log(`✅ LLM prioritization complete: ${sorted.length} dropdowns ranked`);
            sorted.forEach((d: any, i: number) => {
                console.log(`  ${i + 1}. ${d.label} (${d.priority}): ${d.reason} [tsvField: ${d.tsvField}]`);
            });
            
            return sorted;
            
        } catch (error: any) {
            console.error('❌ LLM prioritization failed:', error);
            console.error('❌ Response content (first 200 chars):', error.message?.substring(0, 200));
            // NO FALLBACK - fail loudly as requested
            throw new Error(`LLM prioritization failed: ${error.message}. NO FALLBACK AVAILABLE.`);
        }
    }

    async exploreDropdown(dropdown: DiscoveredElement): Promise<UIExplorationResult> {
        console.log(`🔍 Exploring dropdown: ${dropdown.label}`);
        
        try {
            // 1. Capture before state
            const before = await this.stateCapturer.captureState();
            
            // 2. Get all available options (getDropdownOptions handles expansion for expandable panels)
            // Skip the playwright_click step - getDropdownOptions will handle it
            const options = await this.getDropdownOptions(dropdown.selector);
            const normalizedOptions: DropdownOption[] = Array.isArray(options) ? options : [];
            const optionLabels = normalizeOptions(normalizedOptions);
            const optionSelectors = buildOptionSelectorMap(normalizedOptions, dropdown.selector);
            
            console.log(`📋 Found ${normalizedOptions.length} options: ${optionLabels.slice(0, 5).join(', ')}${normalizedOptions.length > 5 ? '...' : ''}`);
            
            // 4. Sample 2-3 options to test (use labels for sampling)
            const samplesToTest = this.sampleOptions(optionLabels, this.SAMPLES_PER_DROPDOWN);
            console.log(`🎯 Testing samples: ${samplesToTest.join(', ')}`);
            
            const sampleResults = [];
            for (const optionLabel of samplesToTest) {
                console.log(`🔍 Testing option: ${optionLabel}`);
                
                // Select option (pass selector if available)
                const optionSelector = optionSelectors.get(optionLabel);
                await this.selectOption(dropdown.selector, optionLabel, optionSelector);
                
                // Wait for changes
                await this.waitForStability();
                
                // Capture after state
                const after = await this.stateCapturer.captureState();
                
                // Detect changes
                const changes = this.stateCapturer.detectChanges(before, after);
                
                sampleResults.push({ option: optionLabel, changes });
                
                console.log(`📊 Option "${optionLabel}" changes:`, changes);
                
                // Reset filter before next test
                await this.resetFilters();
                await this.waitForStability();
            }
            
            const result: UIExplorationResult = {
                elementType: 'dropdown',
                label: dropdown.label,
                selector: dropdown.selector,
                allOptions: normalizedOptions,
                optionSelectors: optionSelectors.size > 0 ? optionSelectors : undefined,
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
            // These are expandable filter panels, not traditional dropdowns
            // Target: div.customExpansionPanelSummaryRoot[role="button"] with id="Study", "Program", etc.
            const selectors = [
                'div.customExpansionPanelSummaryRoot[role="button"]', // Primary: expandable filter panels
                'select', // Fallback: native selects
                '[role="combobox"]', // Fallback: comboboxes
                '.dropdown', // Fallback: dropdown classes
                '[class*="dropdown"]', // Fallback: any dropdown
                '[class*="select"]' // Fallback: any select
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
                    
                    // Parse MCP result - check actual structure
                    console.log(`🔍 DEBUG: result[0] structure:`, JSON.stringify(result[0]).substring(0, 300));
                    console.log(`🔍 DEBUG: result[0].result type:`, typeof result[0]?.result);
                    console.log(`🔍 DEBUG: result[0].result isArray:`, Array.isArray(result[0]?.result));
                    if (result[0]?.result?.content) {
                        console.log(`🔍 DEBUG: result[0].result.content length:`, result[0].result.content.length);
                        if (result[0].result.content[0]) {
                            console.log(`🔍 DEBUG: result[0].result.content[0] keys:`, Object.keys(result[0].result.content[0]));
                        }
                    }
                    
                    // Parse MCP result - result[0].result is an array of content items
                    // Format: [{type:"text", text:"Executed JavaScript:"}, {type:"text", text:"<script>"}, {type:"text", text:"Result:"}, {type:"text", text:"<JSON array>"}]
                    let elements: any[] = [];
                    if (result[0]?.result && Array.isArray(result[0].result)) {
                        // Find the element that contains the JSON array (usually after "Result:")
                        let foundResult = false;
                        for (const item of result[0].result) {
                            if (item.type === 'text' && item.text) {
                                if (item.text === 'Result:') {
                                    foundResult = true;
                                    continue; // Next item should be the actual data
                                }
                                if (foundResult || item.text.startsWith('[') || item.text.startsWith('{')) {
                                    // This should be the JSON data
                                    try {
                                        const parsed = JSON.parse(item.text);
                                        if (Array.isArray(parsed)) {
                                            elements = parsed;
                                            break;
                                        }
                                    } catch (e) {
                                        // Not valid JSON, continue
                                    }
                                }
                            }
                        }
                    }
                    
                    console.log(`🔍 Selector "${selector}" found ${elements.length} elements`);
                    
                    // Debug: Log first element structure to understand format
                    if (elements.length > 0 && elements[0]) {
                        console.log(`🔍 DEBUG: First element keys:`, Object.keys(elements[0]));
                        console.log(`🔍 DEBUG: First element:`, JSON.stringify(elements[0]).substring(0, 500));
                    }
                    
                    for (const element of elements) {
                        // Skip obvious non-interactive elements
                        const className = String(element.className || '');
                        const textContent = element.textContent?.trim() || '';
                        
                        // Skip buttons, tooltips, and action items
                        if (className.includes('dropdownIconTextWrapper') ||
                            className.includes('add_selected_file') ||
                            className.includes('tooltip') ||
                            textContent.includes('Add Files') ||
                            textContent.includes('Filter By Cases') ||
                            textContent.includes('Add Selected') ||
                            textContent.length > 100) { // Too long text is likely not a dropdown label
                            console.log(`⚠️ Skipped non-dropdown element: "${textContent.substring(0, 30)}"`);
                            continue;
                        }
                        
                        // Extract label using improved method
                        let label = this.extractElementLabel(element);
                        
                        // Skip if label is empty or too generic
                        if (!label || label.length === 0 || label.length > 50) {
                            console.log(`⚠️ Skipped element with invalid label: "${label}"`);
                            continue;
                        }
                        
                        // Use same selector generation as UI state capturer
                        // Ensure element.id and element.className are strings
                        const elementId = typeof element.id === 'string' ? element.id : '';
                        const elementClassName = typeof element.className === 'string' ? element.className : '';
                        
                        const elementSelector = elementId ? `#${elementId}` : 
                                             elementClassName ? `.${elementClassName.split(' ')[0]}` : 
                                             `${selector}:nth-child(${elements.indexOf(element) + 1})`;
                        
                        // Ensure selector is a valid string
                        if (typeof elementSelector !== 'string' || elementSelector.length === 0) {
                            console.error(`❌ Invalid selector generated for "${label}":`, elementSelector);
                            continue;
                        }
                        
                        // Check if it's actually an interactive dropdown
                        if (!this.isInteractiveDropdown(element)) {
                            console.log(`⚠️ Skipped non-interactive element: "${label}"`);
                            continue;
                        }
                        
                        // Deduplicate: Check if we already have this dropdown (by selector or text)
                        const isDuplicate = dropdowns.some(d => 
                            d.selector === elementSelector || 
                            (d.text && textContent && d.text === textContent)
                        );
                        
                        if (isDuplicate) {
                            console.log(`⚠️ Skipped duplicate dropdown: ${label}`);
                            continue;
                        }
                        
                        dropdowns.push({
                            type: 'dropdown',
                            label: label,
                            selector: elementSelector,
                            text: textContent,
                            ariaLabel: element.attributes?.ariaLabel || element.attributes?.['aria-label']
                        });
                        console.log(`✅ Added dropdown ${dropdowns.length}: "${label}" (${elementSelector})`);
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
        const className = String(element.className || '');
        const tagName = element.tagName?.toLowerCase();
        const role = element.attributes?.role;
        
        // PRIORITY: Expandable filter panels (customExpansionPanelSummaryRoot)
        // These are the main filter sections like "Study", "Program", "Breed"
        if (className.includes('customExpansionPanelSummaryRoot') && role === 'button') {
            return true;
        }
        
        // Skip obvious non-interactive elements (section headers, labels, etc.)
        if (className.includes('dropdownIconTextWrapper') || 
            className.includes('facetSectionName') ||
            className.includes('facetHeader') ||
            (className.includes('header') && !className.includes('select') && !className.includes('dropdown'))) {
            return false;
        }
        
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

    async discoverSearchBoxes(): Promise<DiscoveredElement[]> {
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

    private async getDropdownOptions(selector: string): Promise<string[] | Array<{label: string, selector: string, index: number}>> {
        try {
            // Ensure selector is a string (safety check)
            if (typeof selector !== 'string') {
                console.error(`❌ Invalid selector type: ${typeof selector}, value:`, selector);
                throw new Error(`Selector must be a string, got ${typeof selector}`);
            }
            
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
            
            // Parse native options
            let nativeOptions: string[] = [];
            if (nativeResult[0]?.result && Array.isArray(nativeResult[0].result)) {
                // Find JSON array in result
                for (const item of nativeResult[0].result) {
                    if (item.type === 'text' && item.text && (item.text.startsWith('[') || item.text === '[]')) {
                        try {
                            const parsed = JSON.parse(item.text);
                            if (Array.isArray(parsed)) {
                                nativeOptions = parsed.map((el: any) => el.textContent?.trim()).filter((t: string) => t && t !== '');
                                break;
                            }
                        } catch (e) {
                            // Not JSON
                        }
                    }
                }
            }
            
            if (nativeOptions.length > 0) {
                return nativeOptions;
            }
            
            // Check if this is an expandable filter panel (customExpansionPanelSummaryRoot)
            // Check by examining the element's class directly
            const elementCheck = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `(() => {
                        const el = document.querySelector('${selector}');
                        if (!el) return { isExpandable: false };
                        const className = String(el.className || '');
                        return { 
                            isExpandable: className.includes('customExpansionPanelSummaryRoot') || 
                                        (el.getAttribute('role') === 'button' && el.getAttribute('aria-expanded') !== null)
                        };
                    })()`
                },
                id: `check-expandable-${Date.now()}`
            }]);
            
            let isExpandablePanel = false;
            if (elementCheck[0]?.result && Array.isArray(elementCheck[0].result)) {
                for (const item of elementCheck[0].result) {
                    if (item.type === 'text' && item.text && item.text.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(item.text);
                            isExpandablePanel = parsed.isExpandable === true;
                            break;
                        } catch (e) {}
                    }
                }
            }
            
            if (isExpandablePanel) {
                console.log(`🔍 Detected expandable filter panel, expanding to get checkbox options...`);
                
                // Check if already expanded
                const expandedCheck = await this.mcpClient.callTools([{
                    name: 'playwright_evaluate',
                    parameters: { 
                        script: `(() => {
                            const el = document.querySelector('${selector}');
                            if (!el) return { expanded: false };
                            return { expanded: el.getAttribute('aria-expanded') === 'true' };
                        })()`
                    },
                    id: `check-expanded-${Date.now()}`
                }]);
                
                let isExpanded = false;
                if (expandedCheck[0]?.result && Array.isArray(expandedCheck[0].result)) {
                    for (const item of expandedCheck[0].result) {
                        if (item.type === 'text' && item.text && item.text.startsWith('{')) {
                            try {
                                const parsed = JSON.parse(item.text);
                                isExpanded = parsed.expanded === true;
                                break;
                            } catch (e) {}
                        }
                    }
                }
                
                // Try to expand if not already expanded (but continue even if click fails)
                if (!isExpanded) {
                    try {
                        // Try using JavaScript to expand instead of click (more reliable)
                        await this.mcpClient.callTools([{
                            name: 'playwright_evaluate',
                            parameters: { 
                                script: `(() => {
                                    const el = document.querySelector('${selector}');
                                    if (el && el.getAttribute('aria-expanded') === 'false') {
                                        el.click();
                                    }
                                    return { clicked: true };
                                })()`
                            },
                            id: `expand-panel-js-${Date.now()}`
                        }]);
                        await this.waitForStability();
                    } catch (error) {
                        console.warn(`⚠️ Failed to expand panel, trying to extract options anyway...`);
                    }
                }
                
                // Get all checkboxes within this filter panel
                // Pattern: checkbox labels are in <p class="filter_by_casesNameUnChecked">COTC007B (000001)</p>
                const checkboxResult = await this.mcpClient.callTools([{
                    name: 'playwright_evaluate',
                    parameters: { 
                        script: `(() => {
                            const panel = document.querySelector('${selector}');
                            if (!panel) return [];
                            
                            // Find the expanded content area - look for sibling div with role="region"
                            // Structure: panel -> parent -> next sibling with role="region"
                            let expandedContent = null;
                            
                            // Method 1: Find parent container, then look for role="region" within it
                            const parentContainer = panel.closest('div[id]')?.parentElement || panel.parentElement?.parentElement;
                            if (parentContainer) {
                                expandedContent = parentContainer.querySelector('div[role="region"]');
                            }
                            
                            // Method 2: Look for next sibling with role="region"
                            if (!expandedContent) {
                                let sibling = panel.parentElement?.nextElementSibling;
                                while (sibling && !expandedContent) {
                                    if (sibling.getAttribute('role') === 'region') {
                                        expandedContent = sibling;
                                        break;
                                    }
                                    sibling = sibling.nextElementSibling;
                                }
                            }
                            
                            // Method 3: Find any div[role="region"] that contains checkboxes related to this panel
                            if (!expandedContent) {
                                const allRegions = document.querySelectorAll('div[role="region"]');
                                for (const region of allRegions) {
                                    const checkboxes = region.querySelectorAll('input[type="checkbox"]');
                                    if (checkboxes.length > 0) {
                                        // Check if this region is near our panel (within same parent)
                                        const panelParent = panel.closest('div[id]')?.parentElement;
                                        const regionParent = region.closest('div[id]')?.parentElement;
                                        if (panelParent === regionParent || region.contains(panel) || panel.contains(region)) {
                                            expandedContent = region;
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            if (!expandedContent) return [];
                            
                            // Find all checkbox labels WITH their selectors
                            // Target the actual name div, not count paragraphs
                            const checkboxData = Array.from(expandedContent.querySelectorAll('input[type="checkbox"]')).map((cb, index) => {
                                // Find the label text next to the checkbox
                                const row = cb.closest('div[role="button"]');
                                if (!row) return null;
                                
                                // Target the name div specifically (not count divs)
                                const nameDiv = row.querySelector('div.filter_by_casesNameUnChecked, div[class*="filter_by_casesName"]');
                                const labelEl = nameDiv ? nameDiv.querySelector('p') : null;
                                const labelText = labelEl ? labelEl.textContent?.trim() : null;
                                
                                // Filter out numeric-only labels (likely counts)
                                if (labelText && /^\d+$/.test(labelText)) {
                                    return null;
                                }
                                
                                if (!labelText) return null;
                                
                                // Generate selector for this checkbox
                                // Try multiple strategies for stable selector
                                let checkboxSelector = null;
                                
                                // Strategy 1: Use ID if available
                                if (cb.id) {
                                    checkboxSelector = '#' + cb.id;
                                } else {
                                    // Strategy 2: Use data attributes if available
                                    const dataTestId = cb.getAttribute('data-testid');
                                    if (dataTestId) {
                                        checkboxSelector = '[data-testid="' + dataTestId + '"]';
                                    } else {
                                        // Strategy 3: Use aria-label if available
                                        const ariaLabel = cb.getAttribute('aria-label');
                                        if (ariaLabel) {
                                            checkboxSelector = 'input[type="checkbox"][aria-label="' + ariaLabel + '"]';
                                        } else {
                                            // Strategy 4: Use panel selector + nth-of-type (relative to expanded content)
                                            // Count checkboxes before this one in the expanded content
                                            const allCheckboxes = Array.from(expandedContent.querySelectorAll('input[type="checkbox"]'));
                                            const checkboxIndex = allCheckboxes.indexOf(cb);
                                            const panelId = panel.id || ${JSON.stringify(selector)};
                                            checkboxSelector = panelId + ' ~ [role="region"] input[type="checkbox"]:nth-of-type(' + (checkboxIndex + 1) + ')';
                                        }
                                    }
                                }
                                
                                return {
                                    label: labelText,
                                    selector: checkboxSelector,
                                    index: index
                                };
                            }).filter(item => item !== null && item.label && item.label.length > 0);
                            
                            return checkboxData;
                        })()`
                    },
                    id: `get-checkbox-options-${Date.now()}`
                }]);
                
                // Parse checkbox options with selectors
                const checkboxOptions: Array<{label: string, selector: string, index: number}> = [];
                if (checkboxResult[0]?.result && Array.isArray(checkboxResult[0].result)) {
                    for (const item of checkboxResult[0].result) {
                        if (item.type === 'text' && item.text && (item.text.startsWith('[') || item.text.startsWith('{'))) {
                            try {
                                const parsed = JSON.parse(item.text);
                                if (Array.isArray(parsed)) {
                                    // Check if it's the new format with objects
                                    if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0].label) {
                                        checkboxOptions.push(...parsed.filter((opt: any) => opt && opt.label && opt.selector));
                                    } else {
                                        // Old format: just strings, convert to new format
                                        parsed.filter((opt: any) => opt && typeof opt === 'string' && opt.length > 0).forEach((label: string, index: number) => {
                                            checkboxOptions.push({
                                                label: label,
                                                selector: `${selector} ~ [role="region"] input[type="checkbox"]:nth-of-type(${index + 1})`,
                                                index: index
                                            });
                                        });
                                    }
                                    break;
                                }
                            } catch (e) {
                                console.warn(`⚠️ Failed to parse checkbox options: ${e}`);
                            }
                        }
                    }
                }
                
                if (checkboxOptions.length > 0) {
                    return checkboxOptions;
                }
            }
            
            // Fallback: Try to click dropdown and get MUI/Ant Design options
            console.log(`🔍 No native options found, trying to open dropdown for MUI/Ant Design...`);
            
            // Click to open dropdown using JavaScript (more reliable than playwright_click)
            await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `(() => {
                        const el = document.querySelector('${selector}');
                        if (el) el.click();
                        return { clicked: true };
                    })()`
                },
                id: `open-dropdown-js-${Date.now()}`
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
            // Parse menu options
            if (menuResult[0]?.result && Array.isArray(menuResult[0].result)) {
                for (const item of menuResult[0].result) {
                    if (item.type === 'text' && item.text && item.text.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(item.text);
                            if (Array.isArray(parsed)) {
                                parsed.forEach((el: any) => {
                                    const text = el.textContent?.trim();
                                    if (text && text !== '' && text !== 'All' && text !== 'None') {
                                        menuOptions.push(text);
                                    }
                                });
                                break;
                            }
                        } catch (e) {}
                    }
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

    private async selectOption(selector: string, option: string, optionSelector?: string | null): Promise<void> {
        try {
            // Check if this is an expandable filter panel by examining the element's class
            const elementCheck = await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: { 
                    script: `(() => {
                        const el = document.querySelector('${selector}');
                        if (!el) return { isExpandable: false };
                        const className = String(el.className || '');
                        return { 
                            isExpandable: className.includes('customExpansionPanelSummaryRoot') || 
                                        (el.getAttribute('role') === 'button' && el.getAttribute('aria-expanded') !== null)
                        };
                    })()`
                },
                id: `check-expandable-for-select-${Date.now()}`
            }]);
            
            let isExpandablePanel = false;
            if (elementCheck[0]?.result && Array.isArray(elementCheck[0].result)) {
                for (const item of elementCheck[0].result) {
                    if (item.type === 'text' && item.text && item.text.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(item.text);
                            isExpandablePanel = parsed.isExpandable === true;
                            break;
                        } catch (e) {}
                    }
                }
            }
            
            if (isExpandablePanel) {
                console.log(`🔍 Selecting checkbox option in expandable filter panel: "${option}"`);
                
                // Expand panel if not already expanded
                const expandedCheck = await this.mcpClient.callTools([{
                    name: 'playwright_evaluate',
                    parameters: { 
                        script: `(() => {
                            const el = document.querySelector('${selector}');
                            if (!el) return { expanded: false };
                            return { expanded: el.getAttribute('aria-expanded') === 'true' };
                        })()`
                    },
                    id: `check-expanded-for-select-${Date.now()}`
                }]);
                
                let isExpanded = false;
                if (expandedCheck[0]?.result && Array.isArray(expandedCheck[0].result)) {
                    for (const item of expandedCheck[0].result) {
                        if (item.type === 'text' && item.text && item.text.startsWith('{')) {
                            try {
                                const parsed = JSON.parse(item.text);
                                isExpanded = parsed.expanded === true;
                                break;
                            } catch (e) {}
                        }
                    }
                }
                
                if (!isExpanded) {
                    // Use MCP playwright_click to expand panel (more reliable)
                    await this.mcpClient.callTools([{
                        name: 'playwright_click',
                        parameters: { selector: selector },
                        id: `expand-panel-for-select-${Date.now()}`
                    }]);
                    await this.waitForStability();
                }
                
                // Use provided selector if available, otherwise find by label
                let checkboxSelector = optionSelector;
                
                if (!checkboxSelector) {
                    // Fallback: Find checkbox by label text
                    // Pattern: checkbox label is in <p class="filter_by_casesNameUnChecked">OSA04 (000018)</p>
                    const checkboxClick = await this.mcpClient.callTools([{
                        name: 'playwright_evaluate',
                        parameters: { 
                            script: `(() => {
                                const panel = document.querySelector('${selector}');
                                if (!panel) return { found: false, selector: null };
                                const expandedContent = panel.closest('[id]')?.parentElement?.querySelector('[role="region"]') ||
                                                       panel.parentElement?.querySelector('[role="region"]');
                                if (!expandedContent) return { found: false, selector: null };
                                // Find checkbox with matching label text
                                const checkboxes = expandedContent.querySelectorAll('input[type="checkbox"]');
                                for (const cb of checkboxes) {
                                    const row = cb.closest('div[role="button"]');
                                    if (!row) continue;
                                    const labelEl = row.querySelector('p.filter_by_casesNameUnChecked, p[class*="filter_by_casesName"]');
                                    if (labelEl && labelEl.textContent?.trim() === '${option}') {
                                        return { found: true, selector: cb.id ? '#' + cb.id : null };
                                    }
                                }
                                return { found: false, selector: null };
                            })()`
                        },
                        id: `find-checkbox-${Date.now()}`
                    }]);
                    
                    // Parse result to get checkbox selector
                    if (checkboxClick[0]?.result && Array.isArray(checkboxClick[0].result)) {
                        for (const item of checkboxClick[0].result) {
                            if (item.type === 'text' && item.text && item.text.startsWith('{')) {
                                try {
                                    const parsed = JSON.parse(item.text);
                                    if (parsed.found && parsed.selector) {
                                        checkboxSelector = parsed.selector;
                                        break;
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                }
                
                if (checkboxSelector) {
                    // Check if checkbox is already checked before clicking (prevent toggling)
                    const checkState = await this.mcpClient.callTools([{
                        name: 'playwright_evaluate',
                        parameters: {
                            script: `(() => {
                                const cb = document.querySelector('${checkboxSelector}');
                                if (!cb) return { exists: false, checked: false };
                                return { exists: true, checked: cb.checked || cb.getAttribute('aria-checked') === 'true' };
                            })()`
                        },
                        id: `check-checkbox-state-${Date.now()}`
                    }]);
                    
                    let isChecked = false;
                    if (checkState[0]?.result && Array.isArray(checkState[0].result)) {
                        for (const item of checkState[0].result) {
                            if (item.type === 'text' && item.text && item.text.startsWith('{')) {
                                try {
                                    const parsed = JSON.parse(item.text);
                                    isChecked = parsed.checked === true;
                                    break;
                                } catch (e) {}
                            }
                        }
                    }
                    
                    if (isChecked) {
                        console.log(`ℹ️ Checkbox "${option}" is already checked, skipping click`);
                        return;
                    }
                    
                    // Click the checkbox using MCP playwright_click
                    await this.mcpClient.callTools([{
                        name: 'playwright_click',
                        parameters: { selector: checkboxSelector },
                        id: `click-checkbox-${Date.now()}`
                    }]);
                    console.log(`✅ Selected checkbox option: "${option}"`);
                    await this.waitForStability();
                    return;
                } else {
                    console.warn(`⚠️ Could not find checkbox with label "${option}"`);
                }
            }
            
            // Fallback: Try native select option selection
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
                    
                    // After resetting, re-apply study filter if it was set
                    if (this.studyFilterInfo) {
                        await this.reapplyStudyFilter();
                    }
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
            
            // After clearing search boxes, re-apply study filter if it was set
            if (this.studyFilterInfo) {
                await this.reapplyStudyFilter();
            }
            
        } catch (error) {
            console.error('Error resetting filters:', error);
        }
    }
    
    private async reapplyStudyFilter(): Promise<void> {
        if (!this.studyFilterInfo) return;
        
        console.log(`🔄 Re-applying study filter: ${this.studyFilterInfo.studyName}`);
        
        try {
            const { panelSelector, checkboxLabel } = this.studyFilterInfo;
            const escapedLabel = JSON.stringify(checkboxLabel);
            
            // Expand panel if needed
            await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: {
                    script: `(() => {
                        const panel = document.querySelector('${panelSelector}');
                        if (panel && panel.getAttribute('aria-expanded') === 'false') {
                            panel.click();
                            return { expanded: true };
                        }
                        return { expanded: false };
                    })()`
                },
                id: `expand-study-panel-${Date.now()}`
            }]);
            
            await new Promise(resolve => setTimeout(resolve, 800)); // Reduced from 1000ms
            
            // Click the study checkbox (check if already checked first to avoid unnecessary clicks)
            await this.mcpClient.callTools([{
                name: 'playwright_evaluate',
                parameters: {
                    script: `(() => {
                        const panel = document.querySelector('${panelSelector}');
                        if (!panel) return { clicked: false, alreadyChecked: false };
                        
                        let expandedContent = null;
                        const parentContainer = panel.closest('div[id]')?.parentElement || panel.parentElement?.parentElement;
                        if (parentContainer) {
                            expandedContent = parentContainer.querySelector('div[role="region"]');
                        }
                        if (!expandedContent) {
                            const allRegions = document.querySelectorAll('div[role="region"]');
                            for (const region of allRegions) {
                                const checkboxes = region.querySelectorAll('input[type="checkbox"]');
                                if (checkboxes.length > 0) {
                                    const panelParent = panel.closest('div[id]')?.parentElement;
                                    const regionParent = region.closest('div[id]')?.parentElement;
                                    if (panelParent === regionParent || region.contains(panel) || panel.contains(region)) {
                                        expandedContent = region;
                                        break;
                                    }
                                }
                            }
                        }
                        if (!expandedContent) return { clicked: false, alreadyChecked: false };
                        
                        const targetLabel = ${escapedLabel};
                        const checkboxes = expandedContent.querySelectorAll('input[type="checkbox"]');
                        for (const cb of checkboxes) {
                            const row = cb.closest('div[role="button"]');
                            if (!row) continue;
                            const nameDiv = row.querySelector('div.filter_by_casesNameUnChecked, div[class*="filter_by_casesName"]');
                            const labelEl = nameDiv ? nameDiv.querySelector('p') : null;
                            const labelText = labelEl ? labelEl.textContent?.trim() : '';
                            if (labelText === targetLabel) {
                                // Check if already checked
                                if (cb.checked) {
                                    return { clicked: false, alreadyChecked: true, label: labelText };
                                }
                                cb.click();
                                return { clicked: true, alreadyChecked: false, label: labelText };
                            }
                        }
                        return { clicked: false, alreadyChecked: false };
                    })()`
                },
                id: `reapply-study-filter-${Date.now()}`
            }]);
            
            await new Promise(resolve => setTimeout(resolve, 1500)); // Reduced from 2000ms, wait for filter to apply
            console.log(`✅ Study filter re-applied: ${this.studyFilterInfo.studyName}`);
        } catch (error: any) {
            console.warn(`⚠️ Failed to re-apply study filter: ${error.message}`);
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
        // Wait for UI to stabilize after interactions (reduced from 2000ms to 1500ms for faster exploration)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    private extractElementLabel(element: any): string {
        // PRIORITY 1: ID attribute (most reliable - contains "Study", "Program", "Breed", etc.)
        // Based on HTML: <div ... id="Study" class="customExpansionPanelSummaryRoot">
        if (element.id && element.id.length > 1 && element.id.length < 50) {
            // Skip IDs that look like object references or invalid
            if (element.id !== '[object Object]' && !element.id.includes('checkbox_')) {
                return element.id;
            }
        }

        // PRIORITY 2: Look for sectionSummaryText in innerHTML (exact pattern from HTML)
        // Pattern: <div id="Study" class="sectionSummaryText">Study</div>
        if (element.innerHTML) {
            // Try exact match first: <div id="..." class="sectionSummaryText">...</div>
            const sectionMatch = element.innerHTML.match(/<div[^>]*id="([^"]*)"[^>]*class="[^"]*sectionSummaryText[^"]*"[^>]*>/i);
            if (sectionMatch && sectionMatch[1]) {
                return sectionMatch[1].trim();
            }
            // Fallback: any div with sectionSummaryText class
            const sectionMatch2 = element.innerHTML.match(/<div[^>]*class="[^"]*sectionSummaryText[^"]*"[^>]*>([^<]+)<\/div>/i);
            if (sectionMatch2 && sectionMatch2[1]) {
                const text = sectionMatch2[1].trim();
                if (text.length > 0 && text.length < 50) {
                    return text;
                }
            }
        }

        // PRIORITY 3: Try aria-label
        const ariaLabel = element.attributes?.ariaLabel || element.attributes?.['aria-label'];
        if (ariaLabel && ariaLabel.length > 0 && ariaLabel.length < 50) return ariaLabel;
        
        // PRIORITY 4: Try placeholder
        const placeholder = element.attributes?.placeholder;
        if (placeholder && placeholder.length > 0 && placeholder.length < 50) return placeholder;

        // PRIORITY 5: Try textContent (but filter out long text)
        const text = element.textContent?.trim();
        if (text && text.length > 1 && text.length < 50) {
            // Clean up text - remove extra whitespace
            const cleaned = text.replace(/\s+/g, ' ').trim();
            if (cleaned && cleaned.length > 0 && cleaned.length < 50) {
                return cleaned;
            }
        }
        
        // PRIORITY 6: Fallback to title attribute
        const title = element.attributes?.title;
        if (title && title.length > 0 && title.length < 50) return title;

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
