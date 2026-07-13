import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brandAmber: MantineColorsTuple = [
  '#fff8e1',
  '#ffecb3',
  '#ffe082',
  '#ffd54f',
  '#ffca28',
  '#ffc107',
  '#e8a800',
  '#c99400',
  '#a97e00',
  '#8a6800',
];

export const theme = createTheme({
  primaryColor: 'brandAmber',
  colors: {
    brandAmber,
  },
  primaryShade: { light: 5, dark: 5 },
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  headings: {
    fontWeight: '700',
  },
  components: {
    Card: {
      defaultProps: {
        radius: 'md',
      },
    },
  },
});
