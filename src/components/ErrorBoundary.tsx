'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
}

/** Contains a crash to one widget instead of blanking the whole page. */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''}:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
          <p className="text-gray-600 mb-3">This section hit an error and couldn&apos;t render.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 text-sm font-medium text-white bg-[#1E1E3F] rounded-lg hover:bg-[#2D2D5F] transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
