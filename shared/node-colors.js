// A saved color is presentation only; it never determines a node's system.
export const NODE_COLORS = Object.freeze(['blue', 'teal', 'purple', 'amber', 'rose', 'slate']);
const theme = (fill, stroke, text) => Object.freeze({ fill, stroke, text });
const color = (name, lightFill, lightStroke, darkFill, darkStroke) => Object.freeze({
  name,
  light: theme(lightFill, lightStroke, '#121a2b'),
  dark: theme(darkFill, darkStroke, '#f1f1f1'),
});
export const NODE_COLOR_PALETTE = Object.freeze({
  blue: color('Blue', '#eaf2fb', '#2566a0', '#1d3045', '#87b9ed'),
  teal: color('Teal', '#e7f3f0', '#18746b', '#183631', '#7acbbd'),
  purple: color('Purple', '#f1ebf7', '#805491', '#342840', '#c6a9e2'),
  amber: color('Amber', '#fbf2df', '#94651f', '#3b301e', '#e6c480'),
  rose: color('Rose', '#f9eaf0', '#a6486f', '#3e2630', '#e9a5bf'),
  slate: color('Slate', '#edf0f4', '#66758a', '#2b3039', '#aebcce'),
});

export function nodeColorTokens(value, { dark = false } = {}) {
  return typeof value === 'string' && Object.hasOwn(NODE_COLOR_PALETTE, value)
    ? NODE_COLOR_PALETTE[value][dark ? 'dark' : 'light']
    : null;
}
