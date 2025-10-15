import { TestableConnections, TestableConnection } from './universal-pattern-matcher';

export interface UniversalTestCase {
  id: string;
  name: string;
  description: string;
  type: 'filter_test' | 'search_test' | 'sort_test' | 'numerical_filter_test';
  category: 'Data Integrity' | 'Search & Filter' | 'Data Relationships' | 'Performance' | 'Error Handling';
  priority: 'High' | 'Medium' | 'Low';
  dataField: string;
  uiElement: string;
  testValues: string[];
  steps: string[];
  selectors: string[];
  expectedResults: string[];
  confidence: number;
}

export class UniversalTestGenerator {
  
  // Generate universal test cases from discovered connections
  generateTests(connections: TestableConnections): UniversalTestCase[] {
    const tests: UniversalTestCase[] = [];

    // Generate filter tests
    connections.categoricalToFilters.forEach(connection => {
      tests.push(this.generateFilterTest(connection));
    });

    // Generate search tests
    connections.searchableToSearch.forEach(connection => {
      tests.push(this.generateSearchTest(connection));
    });

    // Generate numerical filter tests
    connections.numericalToFilters.forEach(connection => {
      tests.push(this.generateNumericalFilterTest(connection));
    });

    // Generate sort tests
    connections.sortableToSort.forEach(connection => {
      tests.push(this.generateSortTest(connection));
    });

    return tests;
  }

  // Generate universal filter test
  private generateFilterTest(connection: TestableConnection): UniversalTestCase {
    return {
      id: `filter_${connection.dataField}_${Date.now()}`,
      name: `${connection.dataField} Filter Test`,
      description: `Test that ${connection.dataField} filter works correctly and returns expected results`,
      type: 'filter_test',
      category: 'Search & Filter',
      priority: connection.confidence > 0.7 ? 'High' : 'Medium',
      dataField: connection.dataField,
      uiElement: connection.uiElement,
      testValues: connection.testValues || [],
      steps: [
        `Navigate to the page with ${connection.dataField} filter`,
        `Click on ${connection.dataField} filter element`,
        `Select test value: ${connection.testValues?.[0] || 'test_value'}`,
        `Verify filtered results are displayed`,
        `Check that all displayed records have ${connection.dataField} = selected value`,
        `Verify result count matches expected count`
      ],
      selectors: [
        connection.uiElement,
        '.results-container',
        '.filtered-results',
        '[data-testid="results"]'
      ],
      expectedResults: [
        `Filter element is clickable and responsive`,
        `Selected value is properly highlighted`,
        `Results are filtered correctly`,
        `All displayed records match the selected ${connection.dataField} value`,
        `Result count is accurate`,
        `No unrelated records are displayed`
      ],
      confidence: connection.confidence
    };
  }

  // Generate universal search test
  private generateSearchTest(connection: TestableConnection): UniversalTestCase {
    return {
      id: `search_${connection.dataField}_${Date.now()}`,
      name: `${connection.dataField} Search Test`,
      description: `Test that ${connection.dataField} search functionality works correctly`,
      type: 'search_test',
      category: 'Search & Filter',
      priority: connection.confidence > 0.7 ? 'High' : 'Medium',
      dataField: connection.dataField,
      uiElement: connection.uiElement,
      testValues: connection.testValues || [],
      steps: [
        `Navigate to the page with ${connection.dataField} search`,
        `Click on ${connection.dataField} search element`,
        `Enter search query: ${connection.testValues?.[0] || 'test_query'}`,
        `Press Enter or click search button`,
        `Verify search results are displayed`,
        `Check that results contain the search term`,
        `Verify search is case-insensitive if applicable`
      ],
      selectors: [
        connection.uiElement,
        '.search-results',
        '.results-container',
        '[data-testid="search-results"]'
      ],
      expectedResults: [
        `Search element accepts text input`,
        `Search query is processed correctly`,
        `Results are returned within reasonable time`,
        `All displayed results contain the search term`,
        `Search is case-insensitive`,
        `No results message is shown when no matches found`,
        `Search clears properly when cleared`
      ],
      confidence: connection.confidence
    };
  }

  // Generate universal numerical filter test
  private generateNumericalFilterTest(connection: TestableConnection): UniversalTestCase {
    return {
      id: `numerical_${connection.dataField}_${Date.now()}`,
      name: `${connection.dataField} Numerical Filter Test`,
      description: `Test that ${connection.dataField} numerical filter works correctly`,
      type: 'numerical_filter_test',
      category: 'Search & Filter',
      priority: 'Medium',
      dataField: connection.dataField,
      uiElement: connection.uiElement,
      testValues: connection.testValues || [],
      steps: [
        `Navigate to the page with ${connection.dataField} numerical filter`,
        `Interact with ${connection.dataField} filter element`,
        `Set filter to minimum value: ${connection.testValues?.[0] || 'min'}`,
        `Verify filtered results are displayed`,
        `Set filter to maximum value: ${connection.testValues?.[1] || 'max'}`,
        `Verify results are filtered correctly`,
        `Test range filtering if available`
      ],
      selectors: [
        connection.uiElement,
        '.filtered-results',
        '.results-container'
      ],
      expectedResults: [
        `Numerical filter accepts input correctly`,
        `Minimum value filtering works`,
        `Maximum value filtering works`,
        `Range filtering works if available`,
        `Results match the numerical criteria`,
        `Filter resets properly`
      ],
      confidence: connection.confidence
    };
  }

  // Generate universal sort test
  private generateSortTest(connection: TestableConnection): UniversalTestCase {
    return {
      id: `sort_${connection.dataField}_${Date.now()}`,
      name: `${connection.dataField} Sort Test`,
      description: `Test that ${connection.dataField} sorting functionality works correctly`,
      type: 'sort_test',
      category: 'Data Integrity',
      priority: 'Medium',
      dataField: connection.dataField,
      uiElement: connection.uiElement,
      testValues: connection.testValues || ['asc', 'desc'],
      steps: [
        `Navigate to the page with ${connection.dataField} sortable element`,
        `Click on ${connection.dataField} sort element`,
        `Verify ascending sort is applied`,
        `Click again to test descending sort`,
        `Verify descending sort is applied`,
        `Check that data is properly sorted`,
        `Verify sort indicators are displayed correctly`
      ],
      selectors: [
        connection.uiElement,
        '.sortable-header',
        '.sort-indicator',
        '.results-container'
      ],
      expectedResults: [
        `Sort element is clickable`,
        `Ascending sort works correctly`,
        `Descending sort works correctly`,
        `Data is properly ordered`,
        `Sort indicators show current sort direction`,
        `Sort state persists during navigation`,
        `Multiple column sorting works if available`
      ],
      confidence: connection.confidence
    };
  }
}