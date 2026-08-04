import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RadioCardList, RadioCardOption } from '../RadioCardList';

function opts(n: number): RadioCardOption[] {
  return Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Project ${i}` }));
}

describe('RadioCardList', () => {
  it('shows no filter box for a short list', () => {
    const { queryByPlaceholderText } = render(
      <RadioCardList name='t' options={opts(3)} selected={null} onSelect={() => {}} emptyText='none' />,
    );
    expect(queryByPlaceholderText('Filter…')).toBeNull();
  });

  it('auto-enables the filter box past 8 options and narrows the list', () => {
    const { getByPlaceholderText, getByText, queryByText } = render(
      <RadioCardList name='t' options={opts(12)} selected={null} onSelect={() => {}} emptyText='none' />,
    );
    getByText('Project 11');
    fireEvent.change(getByPlaceholderText('Filter…'), { target: { value: 'Project 2' } });
    getByText('Project 2');
    expect(queryByText('Project 3')).toBeNull();
  });

  it('keeps the leadingOption pinned even when the filter matches nothing', () => {
    const { getByText, getByPlaceholderText } = render(
      <RadioCardList
        name='t' options={opts(12)} selected={null} onSelect={() => {}}
        leadingOption={{ id: 'all', label: 'All issues in this team' }} emptyText=''
      />,
    );
    fireEvent.change(getByPlaceholderText('Filter…'), { target: { value: 'zzzzz' } });
    getByText('All issues in this team');
  });
});
