import { DataPatterns, UIPatterns, CategoricalField, FilterElement, SearchableField, SearchElement } from './universal-pattern-detector';

export interface TestableConnection {
  dataField: string;
  uiElement: string;
  connectionType: 'categorical_filter' | 'searchable_search' | 'numerical_filter' | 'sortable_sort';
  confidence: number;
  testValues?: string[];
}

export interface TestableConnections {
  categoricalToFilters: TestableConnection[];
  searchableToSearch: TestableConnection[];
  numericalToFilters: TestableConnection[];
  sortableToSort: TestableConnection[];
}

export class UniversalPatternMatcher {
  
  // Universal pattern matching algorithm
  matchPatterns(dataPatterns: DataPatterns, uiPatterns: UIPatterns): TestableConnections {
    return {
      categoricalToFilters: this.matchCategoricalToFilters(dataPatterns.categorical, uiPatterns.filters),
      searchableToSearch: this.matchSearchableToSearch(dataPatterns.searchable, uiPatterns.search),
      numericalToFilters: this.matchNumericalToFilters(dataPatterns.numerical, uiPatterns.filters),
      sortableToSort: this.matchSortableToSort(dataPatterns.sortable, uiPatterns.sortable)
    };
  }

  // Match categorical fields to filter elements
  private matchCategoricalToFilters(categorical: CategoricalField[], filters: FilterElement[]): TestableConnection[] {
    const connections: TestableConnection[] = [];

    categorical.forEach(dataField => {
      // STRICT VALIDATION: Skip if no values
      if (!dataField.values || dataField.values.length === 0) {
        console.warn(`⚠️ Skipping ${dataField.name}: No values from TSV`);
        return;
      }
      
      filters.forEach(uiElement => {
        // STRICT VALIDATION: Skip if no selector
        if (!uiElement.selector || uiElement.selector === 'undefined') {
          console.warn(`⚠️ Skipping ${dataField.name}: No valid UI selector found`);
          return;
        }
        
        const confidence = this.calculateCategoricalFilterConfidence(dataField, uiElement);
        
        if (confidence > 0.2) { // Minimum confidence threshold
          connections.push({
            dataField: dataField.name,
            uiElement: uiElement.selector,
            connectionType: 'categorical_filter',
            confidence,
            testValues: dataField.values.slice(0, 3) // Use first 3 values for testing
          });
        }
      });
    });

    return connections;
  }

  // Match searchable fields to search elements
  private matchSearchableToSearch(searchable: SearchableField[], search: SearchElement[]): TestableConnection[] {
    const connections: TestableConnection[] = [];

    searchable.forEach(dataField => {
      // STRICT VALIDATION: Skip if no sample values
      if (!dataField.sampleValues || dataField.sampleValues.length === 0) {
        console.warn(`⚠️ Skipping ${dataField.name}: No sample values from TSV`);
        return;
      }
      
      search.forEach(uiElement => {
        // STRICT VALIDATION: Skip if no selector
        if (!uiElement.selector || uiElement.selector === 'undefined') {
          console.warn(`⚠️ Skipping ${dataField.name}: No valid UI selector found`);
          return;
        }
        
        const confidence = this.calculateSearchableSearchConfidence(dataField, uiElement);
        
        if (confidence > 0.2) {
          connections.push({
            dataField: dataField.name,
            uiElement: uiElement.selector,
            connectionType: 'searchable_search',
            confidence,
            testValues: dataField.sampleValues.slice(0, 3)
          });
        }
      });
    });

    return connections;
  }

  // Match numerical fields to filter elements
  private matchNumericalToFilters(numerical: any[], filters: FilterElement[]): TestableConnection[] {
    const connections: TestableConnection[] = [];

    numerical.forEach(dataField => {
      // STRICT VALIDATION: Skip if no min/max values
      if (typeof dataField.min === 'undefined' || typeof dataField.max === 'undefined') {
        console.warn(`⚠️ Skipping ${dataField.name}: No min/max values from TSV`);
        return;
      }
      
      filters.forEach(uiElement => {
        // STRICT VALIDATION: Skip if no selector
        if (!uiElement.selector || uiElement.selector === 'undefined') {
          console.warn(`⚠️ Skipping ${dataField.name}: No valid UI selector found`);
          return;
        }
        
        // Numerical fields work well with sliders and range inputs
        if (uiElement.type === 'slider' || uiElement.type === 'dropdown') {
          connections.push({
            dataField: dataField.name,
            uiElement: uiElement.selector,
            connectionType: 'numerical_filter',
            confidence: 0.7,
            testValues: [dataField.min.toString(), dataField.max.toString()]
          });
        }
      });
    });

    return connections;
  }

  // Match sortable fields to sort elements
  private matchSortableToSort(sortable: any[], sortElements: any[]): TestableConnection[] {
    const connections: TestableConnection[] = [];

    sortable.forEach(dataField => {
      // STRICT VALIDATION: Skip if no sample values
      if (!dataField.sampleValues || dataField.sampleValues.length === 0) {
        console.warn(`⚠️ Skipping ${dataField.name}: No sample values from TSV`);
        return;
      }
      
      sortElements.forEach(uiElement => {
        // STRICT VALIDATION: Skip if no selector
        if (!uiElement.selector || uiElement.selector === 'undefined') {
          console.warn(`⚠️ Skipping ${dataField.name}: No valid UI selector found`);
          return;
        }
        
        connections.push({
          dataField: dataField.name,
          uiElement: uiElement.selector,
          connectionType: 'sortable_sort',
          confidence: 0.8,
          testValues: this.generateSortTestValues()
        });
      });
    });

    return connections;
  }

  // Calculate confidence for categorical field + filter matching
  private calculateCategoricalFilterConfidence(dataField: CategoricalField, uiElement: FilterElement): number {
    let confidence = 0;

    // Base confidence for categorical + filter
    confidence += 0.4;

    // Boost confidence for dropdowns (perfect for categorical)
    if (uiElement.type === 'dropdown') {
      confidence += 0.3;
    }

    // Boost confidence for checkboxes (good for categorical)
    if (uiElement.type === 'checkbox') {
      confidence += 0.2;
    }

    // Boost confidence if field name appears in selector
    if (uiElement.selector.toLowerCase().includes(dataField.name.toLowerCase())) {
      confidence += 0.3;
    }

    // Boost confidence for reasonable number of values
    if (dataField.uniqueCount >= 2 && dataField.uniqueCount <= 20) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  // Calculate confidence for searchable field + search matching
  private calculateSearchableSearchConfidence(dataField: SearchableField, uiElement: SearchElement): number {
    let confidence = 0;

    // Base confidence for searchable + search
    confidence += 0.5;

    // Boost confidence for search type
    if (uiElement.type === 'search') {
      confidence += 0.3;
    }

    // Boost confidence if field name appears in selector or placeholder
    const searchText = (uiElement.selector + ' ' + (uiElement.placeholder || '')).toLowerCase();
    if (searchText.includes(dataField.name.toLowerCase())) {
      confidence += 0.2;
    }

    // Boost confidence for reasonable text length
    if (dataField.avgLength >= 3 && dataField.avgLength <= 50) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  // Generate dynamic sort test values
  private generateSortTestValues(): string[] {
    return ['asc', 'desc'];
  }
}