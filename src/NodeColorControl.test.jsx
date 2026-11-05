import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import NodeColorControl from './NodeColorControl.jsx';
import { NODE_COLORS, NODE_COLOR_PALETTE, nodeColorTokens } from '../shared/node-colors.js';

afterEach(cleanup);
it('offers named choices, applies a color, and resets to Automatic without persisting a sentinel', () => {
  const change = vi.fn();
  function Control() {
    const [color,setColor] = useState();
    return <NodeColorControl color={color} onChange={value => { change(value); setColor(value); }} />;
  }
  render(<Control />);
  expect(screen.getByRole('radio',{name:'Automatic'})).toBeChecked();
  expect(screen.getAllByRole('radio')).toHaveLength(7);
  fireEvent.click(screen.getByRole('radio',{name:'Rose'}));
  expect(change).toHaveBeenLastCalledWith('rose');
  expect(screen.getByRole('radio',{name:'Rose'})).toBeChecked();
  expect(screen.getByRole('radio',{name:'Automatic'})).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio',{name:'Automatic'}));
  expect(change).toHaveBeenLastCalledWith(undefined);
  expect(screen.getByRole('radio',{name:'Automatic'})).toBeChecked();
});

it('uses separate native radio groups when multiple node controls are mounted', () => {
  render(<><NodeColorControl color="blue" onChange={vi.fn()} /><NodeColorControl color="purple" onChange={vi.fn()} /></>);
  expect(screen.getAllByRole('radio',{name:'Automatic'})[0].name).not.toBe(screen.getAllByRole('radio',{name:'Automatic'})[1].name);
  expect(screen.getAllByRole('radio').filter(input=>input.checked).map(input=>input.value)).toEqual(['blue','purple']);
});

const luminance = hex => {
  const [r,g,b] = hex.slice(1).match(/../g).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
};
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);

it.each(NODE_COLORS)('%s keeps text and node boundaries readable in both themes', value => {
  for(const dark of [false,true]) {
    const colors = nodeColorTokens(value,{dark});
    expect(contrast(colors.text,colors.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.stroke,colors.fill)).toBeGreaterThanOrEqual(3);
    expect(colors).toEqual(NODE_COLOR_PALETTE[value][dark?'dark':'light']);
  }
});

it('does not turn arbitrary or prototype keys into export styles', () => {
  for(const value of [undefined,null,'automatic','__proto__','constructor','url(https://example.com)']) expect(nodeColorTokens(value)).toBeNull();
});
