// Code blocks use a base16 scheme (https://github.com/chriskempson/base16), so code reads as its
// own surface against the page. Gruvbox suits the site: warm greys and a yellow that matches the
// amber accent. Scopes map to base16 slots per the base16 styling guidelines, with one change for
// docs: comments use base04 instead of base03, which is too faint to read in prose-heavy samples.
// The header, language chip and copy button are styled in src/styles/custom.css.
import { defineEcConfig, ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';

const gruvboxDark = {
  base00: '#282828',
  base01: '#3c3836',
  base02: '#504945',
  base03: '#665c54',
  base04: '#bdae93',
  base05: '#d5c4a1',
  base06: '#ebdbb2',
  base07: '#fbf1c7',
  base08: '#fb4934',
  base09: '#fe8019',
  base0A: '#fabd2f',
  base0B: '#b8bb26',
  base0C: '#8ec07c',
  base0D: '#83a598',
  base0E: '#d3869b',
  base0F: '#d65d0e',
};
const gruvboxLight = {
  base00: '#fbf1c7',
  base01: '#ebdbb2',
  base02: '#d5c4a1',
  base03: '#bdae93',
  base04: '#665c54',
  base05: '#504945',
  base06: '#3c3836',
  base07: '#282828',
  base08: '#9d0006',
  base09: '#af3a03',
  base0A: '#b57614',
  base0B: '#79740e',
  base0C: '#427b58',
  base0D: '#076678',
  base0E: '#8f3f71',
  base0F: '#d65d0e',
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
    base16('gruvbox-dark-medium', 'dark', gruvboxDark),
    base16('gruvbox-light-medium', 'light', gruvboxLight),
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
