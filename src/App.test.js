import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the log in form when signed out', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
});
