import React from 'react';
import '@testing-library/jest-dom';

// Make React available globally for JSX
// @ts-expect-error - vitest types
global.React = React;

// Mock fetch globally
global.fetch = vi.fn();

// Clean up after each test
afterEach(() => {
  vi.restoreAllMocks();
});
