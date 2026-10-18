// Code blocks use a base16 scheme (https://github.com/chriskempson/base16) built from the site's
// own Caret Neutral tokens, so code reads as a raised card without leaving the page's palette:
// base00 is the card (surface), base01 the header a step off it, base02 the hairline, base03-07
// the page's inks. The accents are one muted OKLCH lightness and chroma per mode (L .78 C .105 in
// dark, L .47 C .115 in light), at 6:1 or better on the card. Scopes map to base16 slots per the
// base16 styling guidelines, except that comments use base04, which stays readable in docs.
// The header, language chip and copy button are styled in src/styles/custom.css.
import { defineEcConfig, ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';

const neutralDark = {
  base00: '#1e1c17', // surface
  base01: '#282721', // hover
  base02: '#333129', // line
  base03: '#7d8086',
  base04: '#9ca0a7', // ink-3
  base05: '#bbc1c9', // ink-2
  base06: '#edf0f5', // ink
  base07: '#edf0f5',
  base08: '#f39d93', // red, hue 27
  base09: '#eca575', // orange, hue 55
  base0A: '#d6b265', // yellow, hue 85
  base0B: '#8cc98e', // green, hue 145
  base0C: '#57cccc', // cyan, hue 195
  base0D: '#83bdf8', // blue, hue 250
  base0E: '#c7a6ee', // violet, hue 305
  base0F: '#cc986e', // brown, hue 60
};
const neutralLight = {
  base00: '#fdfcfa', // surface
  base01: '#eeece8', // hover
  base02: '#dddbd5', // line
  base03: '#777a80',
  base04: '#5f6369', // ink-3
  base05: '#42464d', // ink-2
  base06: '#15181f', // ink
  base07: '#15181f',
  base08: '#903d36',
  base09: '#8a4603',
  base0A: '#785400',
  base0B: '#296b2e',
  base0C: '#006d6f',
  base0D: '#1c5d98',
  base0E: '#6a488e',
  base0F: '#865324',
};

/** A TextMate theme from a base16 scheme. */
const base16 = (name, type, s) =>
  new ExpressiveCodeTheme({
    name,
    type,
    colors: {
      'editor.background': s.base00,
      'editor.foreground': s.base05,
      'editor.selectionBackground': s.base02,
      'editor.lineHighlightBackground': s.base01,
      'editorLineNumber.foreground': s.base03,
      'editorLineNumber.activeForeground': s.base04,
      'editorGroup.border': s.base02,
      'editorGroupHeader.tabsBackground': s.base01,
      'editorGroupHeader.tabsBorder': s.base02,
      'tab.activeBackground': s.base01,
      'tab.activeForeground': s.base05,
      'terminal.background': s.base00,
      'terminal.foreground': s.base05,
      'titleBar.activeBackground': s.base01,
      'titleBar.activeForeground': s.base04,
      'titleBar.border': s.base02,
    },
    tokenColors: [
      { settings: { foreground: s.base05 } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: s.base04, fontStyle: 'italic' },
      },
      { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: s.base05 } },
      {
        scope: ['variable', 'variable.other', 'entity.name.tag', 'markup.deleted'],
        settings: { foreground: s.base08 },
      },
      {
        scope: ['variable.other.readwrite', 'variable.parameter', 'meta.definition.variable'],
        settings: { foreground: s.base05 },
      },
      {
        scope: [
          'constant.numeric',
          'constant.language',
          'constant.character',
          'keyword.other.unit',
          'entity.other.attribute-name',
          'variable.other.constant',
        ],
        settings: { foreground: s.base09 },
      },
      {
        scope: [
          'entity.name.type',
          'entity.name.class',
          'support.type',
          'support.class',
          'entity.other.inherited-class',
        ],
        settings: { foreground: s.base0A },
      },
      {
        scope: ['string', 'punctuation.definition.string', 'markup.inserted'],
        settings: { foreground: s.base0B },
      },
      {
        scope: ['support.function', 'string.regexp', 'constant.character.escape', 'support.constant'],
        settings: { foreground: s.base0C },
      },
      {
        scope: [
          'entity.name.function',
          'meta.function-call entity.name.function',
          'support.function.console',
          'meta.object-literal.key',
          'support.type.property-name',
          'markup.heading',
        ],
        settings: { foreground: s.base0D },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'keyword.operator.new',
          'variable.language',
        ],
        settings: { foreground: s.base0E },
      },
      {
        scope: ['invalid.deprecated', 'meta.embedded', 'punctuation.section.embedded'],
        settings: { foreground: s.base0F },
      },
      // Shell: the command in base0D, flags in base09, arguments as strings.
      {
        scope: ['entity.name.command', 'support.function.builtin.shell'],
        settings: { foreground: s.base0D },
      },
      {
        scope: ['source.shell constant.other.option', 'source.shell variable.parameter.option'],
        settings: { foreground: s.base09 },
      },
    ],
  });

export default defineEcConfig({
  themes: [
    base16('caret-neutral-dark', 'dark', neutralDark),
    base16('caret-neutral-light', 'light', neutralLight),
  ],
  plugins: [pluginLineNumbers()],
  defaultProps: { showLineNumbers: true },
  styleOverrides: {
    borderRadius: '12px',
    borderColor: ({ theme }) => theme.colors['editorGroup.border'],
    codeFontFamily: 'var(--cf-font-mono)',
    codeFontSize: '0.78125rem',
    codeLineHeight: '1.375rem',
    codePaddingBlock: '0.75rem',
    codePaddingInline: '1rem',
    uiFontFamily: 'var(--cf-font-ui)',
    uiFontSize: '0.8125rem',
    uiFontWeight: '550',
    focusBorder: 'var(--cf-focus)',
    frames: {
      frameBoxShadowCssValue: 'none',
      editorTabBarBackground: ({ theme }) => theme.colors['editorGroupHeader.tabsBackground'],
      editorTabBarBorderBottomColor: ({ theme }) => theme.colors['editorGroup.border'],
      terminalTitlebarBackground: ({ theme }) => theme.colors['titleBar.activeBackground'],
      terminalTitlebarForeground: ({ theme }) => theme.colors['titleBar.activeForeground'],
      terminalTitlebarBorderBottomColor: ({ theme }) => theme.colors['editorGroup.border'],
      terminalTitlebarDotsOpacity: '0',
      inlineButtonForeground: ({ theme }) => theme.colors['editor.foreground'],
      inlineButtonBorder: ({ theme }) => theme.colors['editorGroup.border'],
      tooltipSuccessBackground: 'var(--cf-ink)',
      tooltipSuccessForeground: 'var(--cf-on-ink)',
    },
  },
});
