import React from 'react';

export default class RecoverableErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, nonce: 0 };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error);
      } catch {
        /* ignore */
      }
    }
  }

  handleRetry = () => {
    this.setState((s) => ({ hasError: false, nonce: s.nonce + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-4 border border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-300">
            Данные вкладки были повреждены в оффлайн-кэше. Кэш этой вкладки очищен, попробуйте открыть снова.
          </p>
          <button type="button" onClick={this.handleRetry} className="btn-primary mt-3 text-2xs">
            Повторить
          </button>
        </div>
      );
    }
    return (
      <React.Fragment key={this.state.nonce}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
